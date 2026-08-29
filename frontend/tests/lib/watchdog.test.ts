import { test } from "node:test";
import { strict as assert } from "node:assert";

const wd = await import("../../src/lib/watchdog");

const HOUR = 3_600_000;
const CFG = { warnHours: 6, suspendHours: 24 };
const PROBE_CFG = { hotFraction: 0.98, minCoverage: 0.5 };

test("watchdog: config defaults + env overrides", () => {
  const def = wd.watchdogConfigFromEnv({});
  assert.equal(def.enabled, true);
  assert.equal(def.warnHours, 6);
  assert.equal(def.suspendHours, 24);
  assert.equal(def.capFraction, 0.9);
  assert.equal(def.sampleSeconds, 5);

  const custom = wd.watchdogConfigFromEnv({
    PODS_WATCHDOG_ENABLED: "0",
    PODS_WATCHDOG_WARN_HOURS: "2",
    PODS_WATCHDOG_SUSPEND_HOURS: "8",
    PODS_WATCHDOG_FALLBACK_CAP: "not-a-number",
  });
  assert.equal(custom.enabled, false);
  assert.equal(custom.warnHours, 2);
  assert.equal(custom.suspendHours, 8);
  assert.equal(custom.fallbackCapPercent, 350); // bad value → default
});

test("watchdog: hot threshold uses cap, falls back for unlimited pods", () => {
  const cfg = { capFraction: 0.9, fallbackCapPercent: 350 };
  assert.equal(wd.hotThresholdPercent(200, cfg), 180);
  assert.equal(wd.hotThresholdPercent(100, cfg), 90);
  assert.equal(wd.hotThresholdPercent(0, cfg), 315); // unlimited → fallback
});

test("watchdog: probe requires coverage and near-total hot fraction", () => {
  // Busy-wait loop: every sample hot.
  assert.equal(
    wd.probeIsPinned(
      { sampleCount: 360, hotCount: 360, expectedCount: 360 },
      PROBE_CFG,
    ),
    true,
  );
  // Real bursty work: 90% hot is not pinned.
  assert.equal(
    wd.probeIsPinned(
      { sampleCount: 360, hotCount: 324, expectedCount: 360 },
      PROBE_CFG,
    ),
    false,
  );
  // Sparse samples (pod just started / stopped mid-window): not evidence.
  assert.equal(
    wd.probeIsPinned(
      { sampleCount: 100, hotCount: 100, expectedCount: 360 },
      PROBE_CFG,
    ),
    false,
  );
  // No expected samples: never pinned.
  assert.equal(
    wd.probeIsPinned(
      { sampleCount: 0, hotCount: 0, expectedCount: 0 },
      PROBE_CFG,
    ),
    false,
  );
});

test("watchdog: cool pod with no state is a no-op", () => {
  const d = wd.nextWatchdogAction(null, false, Date.now(), CFG);
  assert.equal(d.action, "none");
  assert.equal(d.next, null);
});

test("watchdog: first hot probe starts tracking, no warn yet", () => {
  const now = Date.now();
  const d = wd.nextWatchdogAction(null, true, now, CFG);
  assert.equal(d.action, "track");
  assert.equal(d.next?.state, "ok");
  assert.equal(d.next?.pinnedSinceMs, now);
});

test("watchdog: warns only after warnHours of continuous pin", () => {
  const now = Date.now();
  const tracking = { state: "ok" as const, pinnedSinceMs: now - 5 * HOUR, warnedAtMs: null };
  const early = wd.nextWatchdogAction(tracking, true, now, CFG);
  assert.equal(early.action, "track");
  assert.equal(early.next?.pinnedSinceMs, tracking.pinnedSinceMs); // origin kept

  const later = wd.nextWatchdogAction(
    { ...tracking, pinnedSinceMs: now - 6 * HOUR },
    true,
    now,
    CFG,
  );
  assert.equal(later.action, "warn");
  assert.equal(later.next?.state, "warned");
  assert.equal(later.next?.warnedAtMs, now);
});

test("watchdog: suspends only from warned state after suspendHours", () => {
  const now = Date.now();
  // Warned, but only 12h pinned: keep tracking.
  const mid = wd.nextWatchdogAction(
    { state: "warned", pinnedSinceMs: now - 12 * HOUR, warnedAtMs: now - 6 * HOUR },
    true,
    now,
    CFG,
  );
  assert.equal(mid.action, "track");
  assert.equal(mid.next?.state, "warned"); // stays warned, no re-warn spam

  // Warned + 24h pinned: suspend.
  const late = wd.nextWatchdogAction(
    { state: "warned", pinnedSinceMs: now - 24 * HOUR, warnedAtMs: now - 18 * HOUR },
    true,
    now,
    CFG,
  );
  assert.equal(late.action, "suspend");

  // 24h pinned but never warned (e.g. state wiped): warn first, never
  // suspend without a warning having gone out.
  const unwarned = wd.nextWatchdogAction(
    { state: "ok", pinnedSinceMs: now - 30 * HOUR, warnedAtMs: null },
    true,
    now,
    CFG,
  );
  assert.equal(unwarned.action, "warn");
});

test("watchdog: one cool probe resets the ladder, even after a warning", () => {
  const now = Date.now();
  const d = wd.nextWatchdogAction(
    { state: "warned", pinnedSinceMs: now - 20 * HOUR, warnedAtMs: now - 14 * HOUR },
    false,
    now,
    CFG,
  );
  assert.equal(d.action, "reset");
  assert.equal(d.next, null);
});
