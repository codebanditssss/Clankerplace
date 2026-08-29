import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-thresh-free-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

await import("../../src/lib/db");
const thresholds = await import("../../src/lib/billing/thresholds");

type ThresholdSideEffect =
  import("../../src/lib/billing/thresholds").ThresholdSideEffect;

/**
 * Regression coverage for the "threshold engine doesn't know about
 * free pods" bug. A user with $0 balance who is in a cohort free-forever
 * tier should stay 'green' (no warn/suspend emails) since they aren't
 * burning anything.
 *
 * The fix: classify() now accepts a burnPerDayCents argument and
 * forces 'green' when burn==0 AND balance>=0.
 */

test("classify: $0 balance + zero burn → green (no warn email)", () => {
  const r = thresholds.classify({
    balanceCents: 0,
    burnPerDayCents: 0,
    state: null,
    nowSeconds: 1000,
  });
  assert.equal(r.threshold, "green");
  assert.equal(r.effects.length, 0);
  assert.equal(r.patch.warn_low_sent_at, undefined);
});

test("classify: $0.50 balance + zero burn → green, NOT warn", () => {
  // Without the fix this would fire warn since balance ≤ $1.
  const r = thresholds.classify({
    balanceCents: 50,
    burnPerDayCents: 0,
    state: null,
    nowSeconds: 1000,
  });
  assert.equal(r.threshold, "green");
  assert.deepEqual(r.effects, []);
});

test("classify: $0.50 balance + WITH burn → warn (existing behavior)", () => {
  // With actual burn, warn email fires as before.
  const r = thresholds.classify({
    balanceCents: 50,
    burnPerDayCents: 120, // 1 medium pod
    state: null,
    nowSeconds: 1000,
  });
  assert.equal(r.threshold, "warn");
  assert.deepEqual(r.effects, ["send_warn_low_email"]);
});

test("classify: $0 balance + zero burn → green even with stale suspend state", () => {
  // User was suspended earlier, has since deleted their paid pods and
  // only has free pods. They should be resumed + flags cleared.
  const r = thresholds.classify({
    balanceCents: 0,
    burnPerDayCents: 0,
    state: {
      user_id: 1,
      warn_low_sent_at: 500,
      grace_started_at: 600,
      suspended_at: 700,
      purge_warned_at: null,
      purged_at: null,
      updated_at: 700,
    },
    nowSeconds: 1000,
  });
  assert.equal(r.threshold, "green");
  // Resume effects fire.
  assert.ok(r.effects.includes("power_start_pods"));
  // Old flags cleared.
  assert.equal(r.patch.warn_low_sent_at, null);
  assert.equal(r.patch.grace_started_at, null);
  assert.equal(r.patch.suspended_at, null);
});

test("classify: negative balance still triggers grace even with zero burn", () => {
  // Edge case: user did spend (got refunded into negative?), so they
  // shouldn't sail through just because burn is currently zero. Grace
  // clock starts so admin can review.
  const r = thresholds.classify({
    balanceCents: -10,
    burnPerDayCents: 0,
    state: null,
    nowSeconds: 1000,
  });
  // -10 cents < 0 means the burn=0 short-circuit doesn't trigger.
  // Falls through to existing grace flow.
  assert.equal(r.threshold, "grace");
  assert.equal(r.patch.grace_started_at, 1000);
});

test("classify: omitting burnPerDayCents preserves old behavior", () => {
  // Backward compat: callers that haven't been updated still work as
  // before (burn defaults to +Infinity, so the zero-burn short-circuit
  // never fires).
  const r = thresholds.classify({
    balanceCents: 50,
    state: null,
    nowSeconds: 1000,
  });
  // Should fire warn just like before the fix.
  assert.equal(r.threshold, "warn");
  assert.deepEqual(r.effects, ["send_warn_low_email"]);
});

test("classify: purged user stays purged regardless of burn", () => {
  const r = thresholds.classify({
    balanceCents: 5000,
    burnPerDayCents: 0,
    state: {
      user_id: 1,
      warn_low_sent_at: null,
      grace_started_at: null,
      suspended_at: 100,
      purge_warned_at: 200,
      purged_at: 300,
      updated_at: 300,
    },
    nowSeconds: 99999,
  });
  assert.equal(r.threshold, "purge");
  assert.deepEqual(r.effects, []);
});

test("classify: side-effect recorder confirms no warn email when burn=0", async () => {
  const recorded: ThresholdSideEffect[] = [];
  const r = thresholds.classify({
    balanceCents: 25,
    burnPerDayCents: 0,
    state: null,
    nowSeconds: 1000,
  });
  // Simulate what evaluateUser would do — materialize effects.
  for (const kind of r.effects) {
    recorded.push({ kind } as ThresholdSideEffect);
  }
  assert.equal(recorded.length, 0, "no side effects when burn=0");
});
