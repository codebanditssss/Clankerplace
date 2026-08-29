import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-storage-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const storage = await import("../../src/lib/billing/storage");
const meter = await import("../../src/lib/billing/meter");
const ledger = await import("../../src/lib/billing/ledger");
const config = await import("../../src/lib/billing/config");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (90, 's@storage.test', 'x', 9090, datetime('now'))`,
).run();

// Storage tests need cohort pricing OFF — otherwise founding/paid
// users get free storage and the rollup correctly skips them. We
// test the rollup math here; the cohort skip is in cohort.test.ts.
config.setConfig({
  key: "feature.cohort_pricing_enabled",
  value: false,
  adminId: 0,
});
config.setConfig({
  key: "feature.storage_billing_enabled",
  value: true,
  adminId: 0,
});

const DAY = 86400;
const NOW = 1_700_000_000;

test("storage: rolls up stopped pods at the daily rate", () => {
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "podS1",
    pod_full_uuid: "full-podS1",
    user_id: 90,
    ramMib: 4096,
    diskMib: 20 * 1024, // 20 GB
    cpuPercent: 200,
    initialState: "stopped",
  });
  // Default config: 10 cents/GB-month.
  // 20 GB × 10 × 1000 / 30 = 6667 milli-cents/day → ceil(6667/1000) = 7 cents
  // 7 cents × 30 days ≈ $2.10/mo (spec is $2/mo; ceil rounding adds 10¢).
  const stats = storage.runStorageRollup(NOW);
  assert.equal(stats.pods_charged, 1);
  assert.equal(stats.total_cents_charged, 7);
  assert.equal(ledger.getBalanceCents(90), -7);
});

test("storage: skips running pods", () => {
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "podRun",
    pod_full_uuid: "full-podRun",
    user_id: 90,
    ramMib: 4096,
    diskMib: 20 * 1024,
    cpuPercent: 200,
    initialState: "running",
  });
  const before = ledger.getBalanceCents(90);
  const stats = storage.runStorageRollup(NOW + DAY);
  // Only podS1 (stopped) gets billed, not podRun.
  assert.equal(stats.pods_charged, 1);
  assert.equal(stats.total_cents_charged, 7);
  assert.equal(ledger.getBalanceCents(90), before - 7);
});

test("storage: same-day re-run is a no-op (idempotent)", () => {
  const balanceBefore = ledger.getBalanceCents(90);
  const stats = storage.runStorageRollup(NOW);
  assert.equal(stats.pods_charged, 0);
  assert.equal(stats.pods_skipped_duplicate, 1); // podS1 already billed for day 0
  assert.equal(ledger.getBalanceCents(90), balanceBefore);
});

test("storage: suspended pods are billed (same as stopped)", () => {
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "podSus",
    pod_full_uuid: "full-podSus",
    user_id: 90,
    ramMib: 4096,
    diskMib: 20 * 1024,
    cpuPercent: 200,
    initialState: "suspended",
  });
  const before = ledger.getBalanceCents(90);
  // Use day 5 to avoid colliding with the day-0/day-1 history
  const stats = storage.runStorageRollup(NOW + 5 * DAY);
  // podSus + podS1 for this NEW day → both 7¢ → 14¢ total
  assert.equal(stats.pods_charged, 2);
  assert.equal(ledger.getBalanceCents(90), before - 14);
});

test("storage: skipped_zero for absurdly small disk", () => {
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "podTiny",
    pod_full_uuid: "full-podTiny",
    user_id: 90,
    ramMib: 1024,
    diskMib: 0, // pathological: zero disk
    cpuPercent: 50,
    initialState: "stopped",
  });
  const stats = storage.runStorageRollup(NOW + 10 * DAY);
  assert.ok(stats.pods_skipped_zero >= 1);
});

test("storage: feature flag off → entire rollup skipped", () => {
  config.setConfig({
    key: "feature.storage_billing_enabled",
    value: false,
    adminId: 0,
  });
  const before = ledger.getBalanceCents(90);
  const stats = storage.runStorageRollup(NOW + 20 * DAY);
  assert.equal(stats.pods_charged, 0);
  assert.equal(stats.pods_scanned, 0);
  assert.equal(ledger.getBalanceCents(90), before);
  // Restore for downstream tests.
  config.setConfig({
    key: "feature.storage_billing_enabled",
    value: true,
    adminId: 0,
  });
});

test("storage: FuelBorn pods are never charged by the legacy rollup", () => {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
     VALUES (91, 'fuel@storage.test', 'x', 9091, datetime('now'))`,
  ).run();
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "fuelStorage",
    pod_full_uuid: "full-fuelStorage",
    user_id: 91,
    ramMib: 4096,
    diskMib: 20 * 1024,
    cpuPercent: 200,
    initialState: "stopped",
    economyMode: "fuelborn",
  });

  storage.runStorageRollup(NOW + 30 * DAY);

  assert.equal(ledger.getBalanceCents(91), 0);
});
