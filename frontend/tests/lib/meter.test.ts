import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-meter-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const meter = await import("../../src/lib/billing/meter");
const ledger = await import("../../src/lib/billing/ledger");
const config = await import("../../src/lib/billing/config");

// Meter tests verify the debit math in isolation. With cohort pricing
// ON (the default), user.id 1 = founding cohort = free forever, so the
// tests would see zero debits. Disable for this suite — the cohort
// skip is exercised separately in tests/lib/cohort.test.ts.
config.setConfig({
  key: "feature.cohort_pricing_enabled",
  value: false,
  adminId: 0,
});

// ---- Test fixtures ----

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (1, 'a@meter.test', 'x', 901, datetime('now'))`,
).run();

function insertPod(args: {
  pod: string;
  user_id: number;
  rate_milli: number;
  last_billed_at: number;
  sub_micro?: number;
  state?: string;
}): void {
  db.prepare(
    `INSERT INTO pod_meter_state (
       pod_uuid_short, pod_full_uuid, user_id, tier_slug,
       rate_milli_cents_per_hour, ram_mib, disk_mib, cpu_percent,
       state, last_billed_at, sub_micro_cents, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 4096, 20000, 200, ?, ?, ?, 0, 0)`,
  ).run(
    args.pod,
    `full-${args.pod}`,
    args.user_id,
    "medium",
    args.rate_milli,
    args.state ?? "running",
    args.last_billed_at,
    args.sub_micro ?? 0,
  );
}

// ---- Pure-math tests on computeMeterDelta ----

test("meter: nano rate (1200 milli/hr) × 60s = 20_000 micro-cents exact", () => {
  // 1200 × 60 × 1000 / 3600 = 20000 micro-cents = 0.02¢
  const r = meter.computeMeterDelta({
    rateMilliCentsPerHour: 1200,
    lastBilledAt: 0,
    subMicroCents: 0,
    nowSeconds: 60,
  });
  assert.equal(r.owedCents, 0);
  assert.equal(r.newSubMicroCents, 20_000);
  assert.equal(r.elapsedSeconds, 60);
});

test("meter: small rate (2500) per tick accrues 41_667 micro-cents (rounded)", () => {
  const r = meter.computeMeterDelta({
    rateMilliCentsPerHour: 2500,
    lastBilledAt: 0,
    subMicroCents: 0,
    nowSeconds: 60,
  });
  // exact: 2500 × 60 × 1000 / 3600 = 41_666.666... → 41_667 after round
  assert.equal(r.newSubMicroCents, 41_667);
  assert.equal(r.owedCents, 0);
});

test("meter: zero elapsed is a no-op (no carry change, no debit)", () => {
  const r = meter.computeMeterDelta({
    rateMilliCentsPerHour: 5000,
    lastBilledAt: 100,
    subMicroCents: 999_999,
    nowSeconds: 100,
  });
  assert.equal(r.owedCents, 0);
  assert.equal(r.newSubMicroCents, 999_999);
  assert.equal(r.newLastBilledAt, 100);
  assert.equal(r.elapsedSeconds, 0);
});

test("meter: carry rolls over correctly when crossing 1¢", () => {
  // medium rate: 5000 milli/hr → 83_333 micro-cents per 60s tick
  // Start at carry = 950_000 (= 0.95¢). After tick: 1_033_333 → 1¢ owed,
  // carry becomes 33_333.
  const r = meter.computeMeterDelta({
    rateMilliCentsPerHour: 5000,
    lastBilledAt: 0,
    subMicroCents: 950_000,
    nowSeconds: 60,
  });
  assert.equal(r.owedCents, 1);
  assert.equal(r.newSubMicroCents, 33_333);
});

test("meter: long elapsed produces multi-cent debit", () => {
  // medium pod, 12 hours elapsed → 5000 × 12 / 1000 = 60¢
  const r = meter.computeMeterDelta({
    rateMilliCentsPerHour: 5000,
    lastBilledAt: 0,
    subMicroCents: 0,
    nowSeconds: 12 * 3600,
  });
  assert.equal(r.owedCents, 60);
  assert.equal(r.newSubMicroCents, 0);
});

// ---- Drift accumulation test: small over 1 week ----

test("meter: small pod over 10080 ticks (one week, per-minute) accrues correct cents", () => {
  // Pure simulation — no DB. Each tick adds 41_667 micro-cents (one
  // round-off micro-cent over the "true" 41_666.667). Over 10_080
  // ticks: ~10 micro-cents drift → still < 1 cent of "owed" cents
  // total drift, but well within the audit tolerance.
  //
  // The point is: the simulated lifetime_spent matches the
  // analytically-true value to within rounding bound.
  let carry = 0;
  let spent = 0;
  for (let t = 0; t < 10_080; t++) {
    const r = meter.computeMeterDelta({
      rateMilliCentsPerHour: 2500,
      lastBilledAt: t * 60,
      subMicroCents: carry,
      nowSeconds: (t + 1) * 60,
    });
    spent += r.owedCents;
    carry = r.newSubMicroCents;
  }
  // analytical: 2500 milli/hr × 168 hr = 420_000 milli-cents = 420 cents
  // = $4.20. (1 week of $0.025/hr.)
  //
  // Drift bound: each Math.round() can drift the carry by at most 0.5
  // micro-cents per tick. Over 10_080 ticks that's bounded at 5040
  // micro-cents = 0.005¢. We accept up to 0.01¢ (10_000 micro-cents)
  // total drift between the simulated lifetime-spent + carry vs the
  // analytical exact value, which is far below the cent-level audit
  // resolution we care about.
  const analytical_cents = 420;
  const sim = spent + carry / 1_000_000;
  const drift_cents = Math.abs(sim - analytical_cents);
  assert.ok(
    drift_cents < 0.01,
    `analytical=${analytical_cents}, sim=${sim} (${spent} cents + ${carry} micro carry), drift=${drift_cents}`,
  );
});

// ---- DB-backed tickPod tests ----

test("meter: tickPod debits ledger AND advances last_billed_at atomically", () => {
  insertPod({ pod: "podA", user_id: 1, rate_milli: 5000, last_billed_at: 0 });
  // 1 hour later, medium = 5¢ owed
  const lid = meter.tickPod(
    {
      pod_uuid_short: "podA",
      user_id: 1,
      rate_milli_cents_per_hour: 5000,
      last_billed_at: 0,
      sub_micro_cents: 0,
      tier_slug: "medium",
    },
    3600,
  );
  assert.ok(lid != null);
  assert.equal(ledger.getBalanceCents(1), -5);
  const row = db
    .prepare(`SELECT last_billed_at FROM pod_meter_state WHERE pod_uuid_short = ?`)
    .get("podA") as { last_billed_at: number };
  assert.equal(row.last_billed_at, 3600);
});

test("meter: tickPod with no elapsed returns null and writes nothing", () => {
  insertPod({ pod: "podB", user_id: 1, rate_milli: 5000, last_billed_at: 999 });
  const balanceBefore = ledger.getBalanceCents(1);
  const lid = meter.tickPod(
    {
      pod_uuid_short: "podB",
      user_id: 1,
      rate_milli_cents_per_hour: 5000,
      last_billed_at: 999,
      sub_micro_cents: 0,
      tier_slug: "medium",
    },
    999,
  );
  assert.equal(lid, null);
  assert.equal(ledger.getBalanceCents(1), balanceBefore);
});

test("meter: runMeterTick skips stopped/deleted pods", () => {
  // Wipe and reset
  db.prepare(`DELETE FROM pod_meter_state`).run();
  insertPod({ pod: "run", user_id: 1, rate_milli: 5000, last_billed_at: 0, state: "running" });
  insertPod({ pod: "stop", user_id: 1, rate_milli: 5000, last_billed_at: 0, state: "stopped" });
  insertPod({ pod: "del", user_id: 1, rate_milli: 5000, last_billed_at: 0, state: "deleted" });
  const results = meter.runMeterTick(3600);
  assert.equal(results.length, 1);
  assert.equal(results[0].pod_uuid_short, "run");
});

test("meter: upsertMeterStateFromPelican picks the right tier from RAM", () => {
  const t = meter.upsertMeterStateFromPelican({
    pod_uuid_short: "tierP",
    pod_full_uuid: "full-tierP",
    user_id: 1,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
  });
  assert.equal(t.slug, "medium");
  assert.equal(t.rateMilliCentsPerHour, 5000);
  const row = db
    .prepare(`SELECT tier_slug, rate_milli_cents_per_hour FROM pod_meter_state WHERE pod_uuid_short = ?`)
    .get("tierP") as { tier_slug: string; rate_milli_cents_per_hour: number };
  assert.equal(row.tier_slug, "medium");
  assert.equal(row.rate_milli_cents_per_hour, 5000);
});

test("meter: upsertMeterStateFromPelican on re-deploy keeps last_billed_at & carry", () => {
  // Fresh row
  db.prepare(`DELETE FROM pod_meter_state WHERE pod_uuid_short = ?`).run(
    "keep",
  );
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "keep",
    pod_full_uuid: "full-keep",
    user_id: 1,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "running",
  });
  db.prepare(
    `UPDATE pod_meter_state SET last_billed_at = ?, sub_micro_cents = ? WHERE pod_uuid_short = ?`,
  ).run(5000, 777, "keep");
  // Now redeploy at a higher tier
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "keep",
    pod_full_uuid: "full-keep",
    user_id: 1,
    ramMib: 8 * 1024, // → large
    diskMib: 40000,
    cpuPercent: 400,
  });
  const row = db
    .prepare(
      `SELECT tier_slug, rate_milli_cents_per_hour, last_billed_at, sub_micro_cents FROM pod_meter_state WHERE pod_uuid_short = ?`,
    )
    .get("keep") as {
    tier_slug: string;
    rate_milli_cents_per_hour: number;
    last_billed_at: number;
    sub_micro_cents: number;
  };
  assert.equal(row.tier_slug, "large");
  assert.equal(row.rate_milli_cents_per_hour, 10000);
  assert.equal(row.last_billed_at, 5000, "must not clobber owed-time mark");
  assert.equal(row.sub_micro_cents, 777, "must not clobber carry");
});
