import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-usage-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const usage = await import("../../src/lib/billing/usage");
const meter = await import("../../src/lib/billing/meter");
const ledger = await import("../../src/lib/billing/ledger");
const config = await import("../../src/lib/billing/config");

// Disable cohort pricing for usage tests — getCurrentBurnPerDayCents
// returns 0 for free-forever cohort users, and we want the burn-rate
// assertions to test the raw "all pods bill" math. Cohort behavior is
// exercised in tests/lib/cohort.test.ts.
config.setConfig({
  key: "feature.cohort_pricing_enabled",
  value: false,
  adminId: 0,
});

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (50, 'u@usage.test', 'x', 5050, datetime('now'))`,
).run();

// Seed a ledger we can roll up.
const DAY = 86400;
// fixed reference "now" so the test is deterministic regardless of wall clock
const NOW = 1_700_000_000;

// Day 0 (NOW): one topup, one pod_hour debit
ledger.insertLedger({ userId: 50, delta_cents: 5000, reason: "invoice_credit", ref_invoice_id: "inv-u1", note: "test topup" });
db.prepare(`UPDATE credit_ledger SET ts = ? WHERE ref_invoice_id = ?`).run(NOW, "inv-u1");
ledger.insertLedger({ userId: 50, delta_cents: -10, reason: "pod_hour", ref_pod_uuid: "podU1" });
db.prepare(`UPDATE credit_ledger SET ts = ? WHERE ref_pod_uuid = ? AND reason = 'pod_hour'`).run(NOW, "podU1");

// Day -3: another pod_hour debit
ledger.insertLedger({ userId: 50, delta_cents: -7, reason: "pod_hour", ref_pod_uuid: "podU2", note: "day-3" });
db.prepare(`UPDATE credit_ledger SET ts = ? WHERE note = 'day-3'`).run(NOW - 3 * DAY);

// Day -15: storage debit
ledger.insertLedger({ userId: 50, delta_cents: -1, reason: "storage", ref_pod_uuid: "podU1", note: "day-15-storage" });
db.prepare(`UPDATE credit_ledger SET ts = ? WHERE note = 'day-15-storage'`).run(NOW - 15 * DAY);

test("usage: range 7d only includes last 7 days", () => {
  const r = usage.getUsage(50, "7d", NOW);
  // Topup + pod_hour (day 0) + pod_hour (day -3) = 5000 credits, 17 debits
  assert.equal(r.total_credits_cents, 5000);
  assert.equal(r.total_debits_cents, 17);
});

test("usage: range 30d includes the day-15 storage entry", () => {
  const r = usage.getUsage(50, "30d", NOW);
  assert.equal(r.total_debits_cents, 18); // 10 + 7 + 1
  assert.equal(r.total_credits_cents, 5000);
});

test("usage: daily series fills zero days between entries", () => {
  const r = usage.getUsage(50, "30d", NOW);
  // Day -15 has 1¢ storage, day -3 has 7¢ pod_hour, day 0 has both
  const nonZeroDays = r.daily.filter(
    (d) => d.credits_cents > 0 || d.debits_cents > 0,
  );
  assert.equal(nonZeroDays.length, 3);
  // The series itself spans 30+ days
  assert.ok(r.daily.length >= 30);
});

test("usage: by_pod aggregates per pod across the window", () => {
  const r = usage.getUsage(50, "30d", NOW);
  const podU1 = r.by_pod.find((p) => p.pod_uuid_short === "podU1");
  const podU2 = r.by_pod.find((p) => p.pod_uuid_short === "podU2");
  assert.ok(podU1, "podU1 should appear");
  assert.ok(podU2, "podU2 should appear");
  // podU1: 10 (pod_hour) + 1 (storage) = 11¢
  assert.equal(podU1!.total_cents, 11);
  assert.equal(podU2!.total_cents, 7);
});

test("usage: CSV is well-formed (header + one row per day)", () => {
  const r = usage.getUsage(50, "7d", NOW);
  const csv = usage.dailyCsv(r);
  const lines = csv.split("\n");
  assert.ok(lines[0].startsWith("date,credits_cents,"));
  assert.equal(lines.length, r.daily.length + 1);
});

test("usage: range='all' includes everything since the epoch", () => {
  const r = usage.getUsage(50, "all", NOW);
  assert.equal(r.from_ts, 0);
  assert.equal(r.total_debits_cents, 18);
});

// ---- burn/runway ----

test("usage: getCurrentBurnPerDayCents sums running rates × 24/1000", () => {
  // No running pods initially
  assert.equal(usage.getCurrentBurnPerDayCents(50), 0);
  // Add a medium running pod
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "podRun",
    pod_full_uuid: "full-podRun",
    user_id: 50,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "running",
  });
  // 5000 milli/hr × 24 / 1000 = 120 cents/day
  assert.equal(usage.getCurrentBurnPerDayCents(50), 120);
  // Stopped pod doesn't add to burn
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "podStop",
    pod_full_uuid: "full-podStop",
    user_id: 50,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "stopped",
  });
  assert.equal(usage.getCurrentBurnPerDayCents(50), 120);
  // A running FuelBorn pod belongs to the separate FUEL economy.
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "podFuel",
    pod_full_uuid: "full-podFuel",
    user_id: 50,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "running",
    economyMode: "fuelborn",
  });
  assert.equal(usage.getCurrentBurnPerDayCents(50), 120);
});

test("usage: runwayDays = balance / burn, Infinity when burn=0", () => {
  assert.equal(usage.runwayDays(1000, 100), 10);
  assert.equal(usage.runwayDays(1000, 0), Number.POSITIVE_INFINITY);
  assert.equal(usage.runwayDays(0, 100), 0);
  // Negative balance is allowed (grace state) — runway is negative,
  // which the UI interprets as "past due."
  assert.equal(usage.runwayDays(-100, 100), -1);
});
