// CPU-pin watchdog — pure decision logic.
//
// A pod is "pinned" when ~every docker-stats sample in the probe window
// sits at/above a fraction of its CPU cap. Stuck busy-wait loops (an agent
// writing `while True: check()` with no sleep) look like a *flat* line at
// the cap for days; real work is bursty and dips between tasks.
//
// Escalation ladder (state persisted in pod_watchdog_state, driven by
// /api/internal/watchdog on a 15-min tick from server.mjs):
//
//   ok      --pinned >= warnHours-->    warn owner+admin  (state: warned)
//   warned  --pinned >= suspendHours--> suspend via Pelican + email
//   any     --one cool probe-->         reset to ok (row deleted)
//
// The reset-on-cool rule is what protects real users: a legit 8-hour
// render job that finishes (or an owner who kills the loop after the
// warning email) drops the state back to ok. Only loops that literally
// never stop reach the suspend step.
//
// Everything in this file is pure (no db/network) so it's unit-testable;
// the route does all IO.

export type WatchdogConfig = {
  enabled: boolean;
  /** Continuous pinned hours before the owner gets a warning email. */
  warnHours: number;
  /** Continuous pinned hours before the pod is suspended. */
  suspendHours: number;
  /** Fraction of the pod's CPU cap that counts as "hot" (0.9 = 90%). */
  capFraction: number;
  /** Cap assumed for pods with limits.cpu = 0 (unlimited), in percent. */
  fallbackCapPercent: number;
  /** Probe window per tick, in minutes. */
  probeMinutes: number;
  /** Fraction of probe samples that must be hot (busy loops are ~1.0). */
  hotFraction: number;
  /** Fraction of expected samples that must exist for a valid probe. */
  minCoverage: number;
  /** Background sampler cadence (server.mjs SAMPLE_INTERVAL_MS), seconds. */
  sampleSeconds: number;
};

export function watchdogConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): WatchdogConfig {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    enabled: env.PODS_WATCHDOG_ENABLED !== "0",
    warnHours: num("PODS_WATCHDOG_WARN_HOURS", 6),
    suspendHours: num("PODS_WATCHDOG_SUSPEND_HOURS", 24),
    capFraction: num("PODS_WATCHDOG_CPU_CAP_FRACTION", 0.9),
    fallbackCapPercent: num("PODS_WATCHDOG_FALLBACK_CAP", 350),
    probeMinutes: num("PODS_WATCHDOG_PROBE_MINUTES", 30),
    hotFraction: num("PODS_WATCHDOG_HOT_FRACTION", 0.98),
    minCoverage: num("PODS_WATCHDOG_MIN_COVERAGE", 0.5),
    sampleSeconds: num("PODS_WATCHDOG_SAMPLE_SECONDS", 5),
  };
}

/** The hot-CPU threshold (docker-stats percent) for a pod's cap. */
export function hotThresholdPercent(
  capPercent: number,
  cfg: Pick<WatchdogConfig, "capFraction" | "fallbackCapPercent">,
): number {
  const cap = capPercent > 0 ? capPercent : cfg.fallbackCapPercent;
  return cap * cfg.capFraction;
}

export type PinProbe = {
  /** Samples found in the probe window. */
  sampleCount: number;
  /** Samples at/above the hot threshold. */
  hotCount: number;
  /** Samples the window *should* contain at the sampler cadence. */
  expectedCount: number;
};

/** Whether a probe window shows the pod pinned at its cap. */
export function probeIsPinned(
  probe: PinProbe,
  cfg: Pick<WatchdogConfig, "hotFraction" | "minCoverage">,
): boolean {
  if (probe.expectedCount <= 0) return false;
  // Too few samples (pod stopped/just started/sampler gap) — not evidence.
  if (probe.sampleCount < probe.expectedCount * cfg.minCoverage) return false;
  return probe.hotCount / probe.sampleCount >= cfg.hotFraction;
}

export type WatchdogState = {
  state: "ok" | "warned";
  /** ms epoch of the first probe that found the pod pinned. */
  pinnedSinceMs: number;
  /** ms epoch the warning email went out (state = warned only). */
  warnedAtMs: number | null;
};

export type WatchdogDecision = {
  action: "none" | "track" | "warn" | "suspend" | "reset";
  next: WatchdogState | null;
};

/**
 * One tick of the per-pod state machine.
 *
 *  - `track`   — pinned, still under warnHours: persist/refresh the row.
 *  - `warn`    — crossed warnHours: send the warning, mark warned.
 *  - `suspend` — warned earlier AND total pinned time crossed suspendHours.
 *  - `reset`   — a cool probe with prior state: delete the row.
 *  - `none`    — cool and no prior state.
 */
export function nextWatchdogAction(
  prev: WatchdogState | null,
  pinnedNow: boolean,
  nowMs: number,
  cfg: Pick<WatchdogConfig, "warnHours" | "suspendHours">,
): WatchdogDecision {
  if (!pinnedNow) {
    return { action: prev ? "reset" : "none", next: null };
  }
  const pinnedSinceMs = prev?.pinnedSinceMs ?? nowMs;
  const pinnedForMs = nowMs - pinnedSinceMs;
  if (
    prev?.state === "warned" &&
    pinnedForMs >= cfg.suspendHours * 3_600_000
  ) {
    return { action: "suspend", next: null };
  }
  if (prev?.state !== "warned" && pinnedForMs >= cfg.warnHours * 3_600_000) {
    return {
      action: "warn",
      next: { state: "warned", pinnedSinceMs, warnedAtMs: nowMs },
    };
  }
  return {
    action: "track",
    next: {
      state: prev?.state ?? "ok",
      pinnedSinceMs,
      warnedAtMs: prev?.warnedAtMs ?? null,
    },
  };
}
