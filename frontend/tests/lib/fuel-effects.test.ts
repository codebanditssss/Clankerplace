import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "fuelborn-effects-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const meter = await import("../../src/lib/billing/meter");
const ledger = await import("../../src/lib/fuelborn/ledger");
const lifecycle = await import("../../src/lib/fuelborn/lifecycle");
const effects = await import("../../src/lib/fuelborn/effects-worker");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (401, 'effects@fuelborn.test', 'x', 9401, datetime('now'))`,
).run();

meter.upsertMeterStateFromPelican({
  pod_uuid_short: "effect01",
  pod_full_uuid: "full-effect01",
  user_id: 401,
  ramMib: 4096,
  diskMib: 20000,
  cpuPercent: 200,
  initialState: "running",
  economyMode: "fuelborn",
});
ledger.createAgent({
  id: "effect-agent",
  podUuidShort: "effect01",
  userId: 401,
  name: "Relay",
  ownerWallet: "0x5555555555555555555555555555555555555555",
  chainId: 10143,
  contractAddress: "0x6666666666666666666666666666666666666666",
  tokenId: "12",
  nowSeconds: 100,
});
lifecycle.configureFuelMeter({
  agentId: "effect-agent",
  burnRateMicroFuelPerSecond: 1_000,
  nowSeconds: 100,
});
ledger.appendFuelEntry({
  agentId: "effect-agent",
  deltaMicroFuel: 1_000,
  reason: "adjustment",
  nowSeconds: 100,
});
lifecycle.runFuelTick(101);

test("lifecycle worker retries a failed Pelican effect", async () => {
  const first = await effects.runLifecycleEffects({
    powerPod: async () => {
      throw new Error("panel unavailable");
    },
    nowSeconds: 102,
  });

  assert.deepEqual(first, { scanned: 1, completed: 0, failed: 1 });
  const pending = lifecycle.listPendingLifecycleEffects();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attempts, 1);
  assert.equal(pending[0].last_error, "panel unavailable");

  const calls: Array<{ podUuidShort: string; action: string }> = [];
  const retry = await effects.runLifecycleEffects({
    powerPod: async (podUuidShort, action) => {
      calls.push({ podUuidShort, action });
    },
    nowSeconds: 103,
  });

  assert.deepEqual(retry, { scanned: 1, completed: 1, failed: 0 });
  assert.deepEqual(calls, [{ podUuidShort: "effect01", action: "stop" }]);
  assert.equal(lifecycle.listPendingLifecycleEffects().length, 0);
  const completed = db
    .prepare(
      `SELECT status, attempts, last_error, completed_at
         FROM fuel_lifecycle_effects WHERE effect_key = ?`,
    )
    .get("death:effect-agent:0") as {
    status: string;
    attempts: number;
    last_error: string | null;
    completed_at: number | null;
  };
  assert.deepEqual(completed, {
    status: "completed",
    attempts: 2,
    last_error: null,
    completed_at: 103,
  });
});

test("revival becomes running only after Pelican start succeeds", async () => {
  lifecycle.fundAgent({
    agentId: "effect-agent",
    deltaMicroFuel: 5_000,
    chainEvent: {
      chainId: 10143,
      contractAddress: "0x6666666666666666666666666666666666666666",
      txHash: `0x${"c".repeat(64)}`,
      logIndex: 1,
    },
    nowSeconds: 110,
  });
  assert.equal(meter.getMeterState("effect01")?.state, "provisioning");

  await effects.runLifecycleEffects({
    powerPod: async (_podUuidShort, action) => {
      assert.equal(action, "start");
    },
    nowSeconds: 115,
  });

  assert.equal(meter.getMeterState("effect01")?.state, "running");
  const [tick] = lifecycle.runFuelTick(116);
  assert.equal(tick.burned_micro_fuel, 1_000);
});
