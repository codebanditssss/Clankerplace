import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-idem-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const idem = await import("../../src/lib/billing/idempotency");

test("idempotency: store + lookup round-trip", () => {
  idem.storeIdempotent({
    key: "key-aaaaaaaa",
    scope: "admin.adjust:1",
    response: { ok: true, ledger_id: 7 },
    status: 200,
  });
  const r = idem.lookupIdempotent<{ ok: boolean; ledger_id: number }>({
    key: "key-aaaaaaaa",
    scope: "admin.adjust:1",
  });
  assert.ok(r);
  assert.equal(r!.status, 200);
  assert.equal(r!.response.ledger_id, 7);
});

test("idempotency: lookup with wrong scope returns null", () => {
  const r = idem.lookupIdempotent({
    key: "key-aaaaaaaa",
    scope: "admin.adjust:2", // different scope
  });
  assert.equal(r, null);
});

test("idempotency: missing key returns null", () => {
  const r = idem.lookupIdempotent({
    key: "missing-key",
    scope: "admin.adjust:1",
  });
  assert.equal(r, null);
});

test("idempotency: isValidIdempotencyKey rejects bad shapes", () => {
  assert.equal(idem.isValidIdempotencyKey(""), false);
  assert.equal(idem.isValidIdempotencyKey("short"), false);
  assert.equal(idem.isValidIdempotencyKey("a".repeat(129)), false);
  assert.equal(idem.isValidIdempotencyKey("good-key-1234567"), true);
  // Non-ASCII rejected
  assert.equal(idem.isValidIdempotencyKey("keyÿ12345678"), false);
  // Control chars rejected
  assert.equal(idem.isValidIdempotencyKey("key\x01abcdef12"), false);
});

test("idempotency: pruneExpired deletes only expired rows", () => {
  // Insert one fresh + one already-expired (by faking a past timestamp).
  idem.storeIdempotent({
    key: "fresh-key-zz",
    scope: "test",
    response: {},
    status: 200,
  });
  db.prepare(
    `INSERT INTO idempotency_keys (key, scope, response_json, status_code, created_at, expires_at)
     VALUES ('old-key-zzzz', 'test', '{}', 200, 0, 1)`,
  ).run();
  const pruned = idem.pruneExpiredIdempotency(Math.floor(Date.now() / 1000));
  assert.ok(pruned >= 1, "should prune the expired row");
  // Fresh key survives
  assert.ok(
    idem.lookupIdempotent({ key: "fresh-key-zz", scope: "test" }) != null,
  );
});
