import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-thresh-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const ledger = await import("../../src/lib/billing/ledger");
const thresholds = await import("../../src/lib/billing/thresholds");
const meter = await import("../../src/lib/billing/meter");
const config = await import("../../src/lib/billing/config");
type ThresholdSideEffect =
  import("../../src/lib/billing/thresholds").ThresholdSideEffect;

config.setConfig({
  key: "feature.auto_suspend_enabled",
  value: true,
  adminId: 0,
});

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (10, 't@thresh.test', 'x', 1010, datetime('now'))`,
).run();

function emptyState(): import("../../src/lib/db").UserBillingStateRow | null {
  return null;
}

// ---- Pure classify() coverage ----

test("classify: green when balance is comfortably above warn threshold", () => {
  const r = thresholds.classify({
    balanceCents: 5000,
    state: emptyState(),
    nowSeconds: 1000,
  });
  assert.equal(r.threshold, "green");
  assert.equal(r.effects.length, 0);
});

test("classify: warn fires once + only once on first crossing", () => {
  const r1 = thresholds.classify({
    balanceCents: 50,
    state: emptyState(),
    nowSeconds: 1000,
  });
  assert.equal(r1.threshold, "warn");
  assert.deepEqual(r1.effects, ["send_warn_low_email"]);
  assert.equal(r1.patch.warn_low_sent_at, 1000);

  // Second eval with the bookkeeping already saying we sent — no resend.
  const r2 = thresholds.classify({
    balanceCents: 50,
    state: {
      user_id: 10,
      warn_low_sent_at: 1000,
      grace_started_at: null,
      suspended_at: null,
      purge_warned_at: null,
      purged_at: null,
      updated_at: 1000,
    },
    nowSeconds: 2000,
  });
  assert.equal(r2.threshold, "warn");
  assert.equal(r2.effects.length, 0);
});

test("classify: warn flag clears on return to green so a future drop re-fires", () => {
  const r = thresholds.classify({
    balanceCents: 10000,
    state: {
      user_id: 10,
      warn_low_sent_at: 1000,
      grace_started_at: null,
      suspended_at: null,
      purge_warned_at: null,
      purged_at: null,
      updated_at: 1000,
    },
    nowSeconds: 2000,
  });
  assert.equal(r.threshold, "green");
  assert.equal(r.patch.warn_low_sent_at, null);
});

test("classify: grace starts the clock when balance crosses 0", () => {
  const r = thresholds.classify({
    balanceCents: -10,
    state: emptyState(),
    nowSeconds: 1000,
  });
  assert.equal(r.threshold, "grace");
  assert.equal(r.patch.grace_started_at, 1000);
  assert.equal(r.effects.length, 0);
});

test("classify: suspend fires when grace window expires", () => {
  const r = thresholds.classify({
    balanceCents: -10,
    state: {
      user_id: 10,
      warn_low_sent_at: null,
      grace_started_at: 1000,
      suspended_at: null,
      purge_warned_at: null,
      purged_at: null,
      updated_at: 1000,
    },
    nowSeconds: 1000 + 25 * 3600, // 25h later → past 24h window
  });
  assert.equal(r.threshold, "suspend");
  assert.ok(r.effects.includes("power_stop_pods"));
  assert.ok(r.effects.includes("send_suspend_email"));
});

test("classify: suspend fires immediately when balance crosses floor", () => {
  const r = thresholds.classify({
    balanceCents: -100,
    state: emptyState(),
    nowSeconds: 1000,
  });
  assert.equal(r.threshold, "suspend");
});

test("classify: purge_warn fires once after 7 days of suspension", () => {
  const r = thresholds.classify({
    balanceCents: -100,
    state: {
      user_id: 10,
      warn_low_sent_at: null,
      grace_started_at: 0,
      suspended_at: 1000,
      purge_warned_at: null,
      purged_at: null,
      updated_at: 1000,
    },
    nowSeconds: 1000 + 8 * 24 * 3600,
  });
  assert.equal(r.threshold, "warn2");
  assert.deepEqual(r.effects, ["send_purge_warn_email"]);
  assert.equal(r.patch.purge_warned_at, 1000 + 8 * 24 * 3600);
});

test("classify: purge fires at 30 days, marks purged terminal", () => {
  const r = thresholds.classify({
    balanceCents: -100,
    state: {
      user_id: 10,
      warn_low_sent_at: null,
      grace_started_at: 0,
      suspended_at: 1000,
      purge_warned_at: 8 * 24 * 3600,
      purged_at: null,
      updated_at: 1000,
    },
    nowSeconds: 1000 + 30 * 24 * 3600,
  });
  assert.equal(r.threshold, "purge");
  assert.ok(r.effects.includes("delete_pods"));
  assert.ok(r.effects.includes("send_purged_email"));
});

test("classify: purged is sticky — even a fresh balance keeps purged state", () => {
  const r = thresholds.classify({
    balanceCents: 10000,
    state: {
      user_id: 10,
      warn_low_sent_at: null,
      grace_started_at: null,
      suspended_at: 1000,
      purge_warned_at: 2000,
      purged_at: 3000,
      updated_at: 3000,
    },
    nowSeconds: 99999,
  });
  assert.equal(r.threshold, "purge");
  assert.equal(r.effects.length, 0);
});

test("classify: top-up while suspended fires resume + start", () => {
  const r = thresholds.classify({
    balanceCents: 5000,
    state: {
      user_id: 10,
      warn_low_sent_at: 500,
      grace_started_at: 600,
      suspended_at: 1000,
      purge_warned_at: null,
      purged_at: null,
      updated_at: 1000,
    },
    nowSeconds: 2000,
  });
  assert.equal(r.threshold, "green");
  assert.ok(r.effects.includes("power_start_pods"));
  assert.ok(r.effects.includes("send_resumed_email"));
  assert.equal(r.patch.suspended_at, null);
  assert.equal(r.patch.warn_low_sent_at, null);
  assert.equal(r.patch.grace_started_at, null);
});

// ---- evaluateUser integration test (DB + effect recorder) ----

test("evaluateUser: end-to-end suspend path with effect runner", async () => {
  // Set up: user 10 has a -100¢ balance and a running pod.
  ledger.insertLedger({
    userId: 10,
    delta_cents: -100,
    reason: "pod_hour",
    note: "test seed",
  });
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "tp1",
    pod_full_uuid: "full-tp1",
    user_id: 10,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "running",
  });
  const recorded: ThresholdSideEffect[] = [];
  const v = await thresholds.evaluateUser(10, {
    nowSeconds: 5000,
    effectRunner: async (e) => {
      recorded.push(e);
    },
  });
  assert.equal(v.threshold, "suspend");
  assert.ok(recorded.some((e) => e.kind === "power_stop_pods"));
  // The pod should now be in suspended state.
  const row = db
    .prepare(`SELECT state FROM pod_meter_state WHERE pod_uuid_short = ?`)
    .get("tp1") as { state: string };
  assert.equal(row.state, "suspended");
});

test("evaluateUser: top-up resumes the suspended pod", async () => {
  // user 10 currently at -100, pod 'tp1' suspended. Credit them.
  ledger.insertLedger({
    userId: 10,
    delta_cents: 500,
    reason: "manual_adjustment",
    note: "test top-up",
  });
  const recorded: ThresholdSideEffect[] = [];
  const v = await thresholds.evaluateUser(10, {
    nowSeconds: 6000,
    effectRunner: async (e) => {
      recorded.push(e);
    },
  });
  assert.equal(v.threshold, "green");
  assert.ok(recorded.some((e) => e.kind === "power_start_pods"));
  const row = db
    .prepare(`SELECT state FROM pod_meter_state WHERE pod_uuid_short = ?`)
    .get("tp1") as { state: string };
  assert.equal(row.state, "running");
});
