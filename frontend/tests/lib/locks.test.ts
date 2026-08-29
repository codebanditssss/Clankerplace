import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-locks-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const locks = await import("../../src/lib/billing/locks");

test("locks: same key serializes; different keys are concurrent", async () => {
  let inFlight = 0;
  let maxConcurrent = 0;
  const order: string[] = [];

  async function critical(key: string, id: string, ms: number) {
    await locks.withLock(key, async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      order.push(`enter:${id}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`exit:${id}`);
      inFlight--;
    });
  }

  await Promise.all([
    critical("user:1", "a", 20),
    critical("user:1", "b", 20),
    critical("user:1", "c", 20),
    critical("user:2", "d", 20), // different key → parallel with the user:1 chain
  ]);

  // user:1 chain must NOT overlap with itself.
  for (let i = 0; i < order.length; i++) {
    if (!order[i].startsWith("enter:")) continue;
    const who = order[i].split(":")[1];
    if (who === "d") continue;
    // Find matching exit
    const exitIdx = order.indexOf(`exit:${who}`, i + 1);
    assert.ok(exitIdx > 0, `no exit for ${who}`);
    // Everything between enter and exit must be for "d" only
    for (let j = i + 1; j < exitIdx; j++) {
      if (order[j].startsWith("enter:")) {
        const inner = order[j].split(":")[1];
        assert.equal(inner, "d", `user:1 lock should not overlap, but ${inner} entered during ${who}`);
      }
    }
  }
});

test("locks: release-on-throw — exception in critical section frees lock", async () => {
  locks.__internal.clear();
  let secondRan = false;
  try {
    await locks.withLock("user:99", async () => {
      throw new Error("boom");
    });
  } catch {
    // expected
  }
  await locks.withLock("user:99", async () => {
    secondRan = true;
  });
  assert.equal(secondRan, true);
  assert.equal(locks.__internal.isHeld("user:99"), false);
});

test("locks: __internal exposes held + waiter counts", async () => {
  locks.__internal.clear();
  let release: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  const first = locks.withLock("user:42", async () => {
    await blocked;
  });
  // Yield to the microtask queue so the first lock is established.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(locks.__internal.isHeld("user:42"), true);
  const second = locks.withLock("user:42", async () => undefined);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(locks.__internal.waiterCount("user:42"), 1);
  release!();
  await first;
  await second;
  assert.equal(locks.__internal.isHeld("user:42"), false);
});
