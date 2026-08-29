import "server-only";
import db, {
  type PodEconomyMode,
  type PodMeterState,
  type TierSlug,
} from "../db";
import { insertLedger } from "./ledger";
import { tierFromRam, type Tier } from "./pricing";
import { isPodFreeForUser } from "./cohort";
import { billingLog } from "./logger";

/**
 * Per-pod metering — the engine that turns "pod is running" into
 * "user owes cents".
 *
 * Why the math is the way it is:
 *
 *   Rate is stored as milli-cents per hour (integer, see pricing.ts).
 *   Time is in unix seconds (matches the rest of the codebase).
 *
 *   Per tick:
 *     owed_micro = round(rate_milli_per_hour * elapsed_seconds * 1000 / 3600)
 *                                                         ^^^^^^^^^^
 *                                       milli-cents → micro-cents
 *
 *   Carry (`sub_micro_cents`) accumulates the unpaid micro-cents from
 *   one tick to the next. When the carry plus this tick's accrual
 *   crosses 1_000_000 micro-cents (= 1 whole cent), we debit the
 *   ledger and subtract that out of the carry. Everything is integer.
 *
 * Why micro-cents and not milli-cents:
 *   - small ($0.025/hr = 2500 milli-cents/hr) accrues 41.67 milli-cents
 *     per minute. That doesn't fit in integer milli-cents.
 *   - At micro-cents: small accrues 41_667 micro-cents/min (one rounding
 *     of 0.5 micro-cents per tick).
 *   - Over a year of metering one pod, max drift = 0.5 micro-cents
 *     × 525_600 ticks = 262_800 micro-cents = $0.0026. Acceptable.
 *
 * Why the carry isn't just "cumulative owed":
 *   We want lifetime_spent (= sum of billing_entries.amount) to track to
 *   the actual whole-cent debits. Re-running the meter on a fresh DB
 *   with a year of history shouldn't drift from the existing balance.
 *   The carry is the *fractional* part of owed cents that hasn't been
 *   converted into a ledger row yet.
 */

/** Pure function — given a pod's current meter row and a `now`, return
 * what the next ledger entry should look like + the new carry. No DB
 * writes; the caller (meterPodTick) wraps in a transaction. Exported so
 * the unit tests can exercise the math in isolation. */
export function computeMeterDelta(args: {
  rateMilliCentsPerHour: number;
  /** unix seconds — what we last billed up to. */
  lastBilledAt: number;
  /** Current carry in micro-cents (= 10^-6 USD cents). */
  subMicroCents: number;
  nowSeconds: number;
}): {
  /** Whole cents to debit (always >= 0; the tick is a no-op if 0). */
  owedCents: number;
  /** New carry after this tick. Always in [0, 1_000_000). */
  newSubMicroCents: number;
  /** What to write into pod_meter_state.last_billed_at. Equals
   * nowSeconds for non-zero ticks; equals lastBilledAt unchanged for
   * zero-elapsed ticks (so the next tick still picks up the full
   * window). */
  newLastBilledAt: number;
  /** Seconds elapsed since lastBilledAt (clamped at 0). */
  elapsedSeconds: number;
} {
  const elapsedSeconds = Math.max(0, args.nowSeconds - args.lastBilledAt);
  if (elapsedSeconds === 0) {
    return {
      owedCents: 0,
      newSubMicroCents: args.subMicroCents,
      newLastBilledAt: args.lastBilledAt,
      elapsedSeconds: 0,
    };
  }
  // milli-cents-per-hour × seconds × (micro-cents/milli-cents) / (seconds/hour)
  //  = milli × s × 1000 / 3600 = (rate × s × 5) / 18  (kept as fp; round to int micro-cents)
  const owedMicro = Math.round(
    (args.rateMilliCentsPerHour * elapsedSeconds * 1000) / 3600,
  );
  const totalMicro = args.subMicroCents + owedMicro;
  const owedCents = Math.floor(totalMicro / 1_000_000);
  const newSubMicroCents = totalMicro - owedCents * 1_000_000;
  return {
    owedCents,
    newSubMicroCents,
    newLastBilledAt: args.nowSeconds,
    elapsedSeconds,
  };
}

/** Tick one pod. Wraps the ledger insert + meter-state update in a single
 * SQLite transaction so we never write a ledger row without advancing
 * `last_billed_at` (which would double-bill on the next tick). Idempotent
 * against a noop (zero elapsed / sub-cent only).
 *
 * Returns the ledger entry id when a debit fired, otherwise null. */
export function tickPod(
  pod: Pick<
    PodMeterState,
    | "pod_uuid_short"
    | "user_id"
    | "rate_milli_cents_per_hour"
    | "last_billed_at"
    | "sub_micro_cents"
    | "tier_slug"
  >,
  nowSeconds: number,
): number | null {
  // Is THIS pod the user's claimed free slot? Skip the debit entirely
  // BUT still advance last_billed_at so if the slot is released later
  // (pod deleted, or cohort pricing disabled), we don't back-bill the
  // entire skipped period as one giant catch-up. Per-pod check, not
  // per-user — a founding user's 2nd pod is PAYG even though their
  // 1st pod is free.
  if (isPodFreeForUser(pod.user_id, pod.pod_uuid_short)) {
    db.prepare(
      `UPDATE pod_meter_state SET last_billed_at = ?, updated_at = ? WHERE pod_uuid_short = ?`,
    ).run(nowSeconds, nowSeconds, pod.pod_uuid_short);
    return null;
  }

  const delta = computeMeterDelta({
    rateMilliCentsPerHour: pod.rate_milli_cents_per_hour,
    lastBilledAt: pod.last_billed_at,
    subMicroCents: pod.sub_micro_cents,
    nowSeconds,
  });
  if (delta.elapsedSeconds === 0) return null;

  const writeAll = db.transaction(() => {
    let ledgerId: number | null = null;
    if (delta.owedCents > 0) {
      const row = insertLedger({
        userId: pod.user_id,
        delta_cents: -delta.owedCents,
        reason: "pod_hour",
        ref_pod_uuid: pod.pod_uuid_short,
        note: `${pod.tier_slug} pod, ${formatElapsed(delta.elapsedSeconds)}`,
      });
      ledgerId = row.id;
    }
    db.prepare(
      `UPDATE pod_meter_state
          SET last_billed_at  = ?,
              sub_micro_cents = ?,
              updated_at      = ?
        WHERE pod_uuid_short  = ?`,
    ).run(
      delta.newLastBilledAt,
      delta.newSubMicroCents,
      nowSeconds,
      pod.pod_uuid_short,
    );
    return ledgerId;
  });
  return writeAll();
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = seconds / 60;
  if (m < 60) return `${m.toFixed(1)}min`;
  const h = m / 60;
  return `${h.toFixed(2)}h`;
}

/** Run the meter against every running pod. Returns one entry per pod
 * touched (whether a debit fired or not) so the caller can also kick the
 * thresholds engine for affected user_ids. Wrapped in try/catch per pod
 * so one bad row doesn't poison the rest of the tick. */
export type TickResult = {
  pod_uuid_short: string;
  user_id: number;
  owed_cents: number;
  ledger_id: number | null;
  error?: string;
};

export function runMeterTick(nowSeconds: number = unixNow()): TickResult[] {
  const pods = db
    .prepare<[], PodMeterState>(
      `SELECT * FROM pod_meter_state
        WHERE state = 'running' AND economy_mode = 'legacy'`,
    )
    .all();
  const results: TickResult[] = [];
  for (const pod of pods) {
    try {
      const delta = computeMeterDelta({
        rateMilliCentsPerHour: pod.rate_milli_cents_per_hour,
        lastBilledAt: pod.last_billed_at,
        subMicroCents: pod.sub_micro_cents,
        nowSeconds,
      });
      const ledgerId = tickPod(pod, nowSeconds);
      results.push({
        pod_uuid_short: pod.pod_uuid_short,
        user_id: pod.user_id,
        owed_cents: delta.owedCents,
        ledger_id: ledgerId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[meter] tickPod failed for ${pod.pod_uuid_short}:`, msg);
      results.push({
        pod_uuid_short: pod.pod_uuid_short,
        user_id: pod.user_id,
        owed_cents: 0,
        ledger_id: null,
        error: msg,
      });
    }
  }
  return results;
}

// ---- pod_meter_state CRUD helpers (used by deploy/power/delete handlers) ----

export function upsertMeterStateFromPelican(args: {
  pod_uuid_short: string;
  pod_full_uuid: string;
  user_id: number;
  /** Pelican limits.memory in MiB. */
  ramMib: number;
  /** Pelican limits.disk in MiB. */
  diskMib: number;
  /** Pelican limits.cpu (percent-of-a-core; 100 = 1 vCPU). */
  cpuPercent: number;
  /** Initial state to write. Deploy uses 'provisioning'; the install-
   * complete callback (or first running observation) flips to 'running'. */
  initialState?: PodMeterState["state"];
  /** Billing/lifecycle authority. Existing callers remain legacy. */
  economyMode?: PodEconomyMode;
}): Tier {
  const tier = tierFromRam(args.ramMib);
  const now = unixNow();
  const existing = db
    .prepare<[string], PodMeterState>(
      `SELECT * FROM pod_meter_state WHERE pod_uuid_short = ?`,
    )
    .get(args.pod_uuid_short);
  if (existing) {
    // Pod redeploy or state-recovery — refresh static fields but DON'T
    // clobber last_billed_at / sub_micro_cents (would forfeit owed time).
    db.prepare(
      `UPDATE pod_meter_state
          SET pod_full_uuid = ?,
              user_id = ?,
              tier_slug = ?,
              rate_milli_cents_per_hour = ?,
              ram_mib = ?, disk_mib = ?, cpu_percent = ?,
              economy_mode = ?,
              updated_at = ?
        WHERE pod_uuid_short = ?`,
    ).run(
      args.pod_full_uuid,
      args.user_id,
      tier.slug,
      tier.rateMilliCentsPerHour,
      args.ramMib,
      args.diskMib,
      args.cpuPercent,
      args.economyMode ?? existing.economy_mode,
      now,
      args.pod_uuid_short,
    );
    return tier;
  }
  db.prepare(
    `INSERT INTO pod_meter_state (
       pod_uuid_short, pod_full_uuid, user_id, tier_slug,
       rate_milli_cents_per_hour, ram_mib, disk_mib, cpu_percent,
       economy_mode, state, last_billed_at, sub_micro_cents, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    args.pod_uuid_short,
    args.pod_full_uuid,
    args.user_id,
    tier.slug,
    tier.rateMilliCentsPerHour,
    args.ramMib,
    args.diskMib,
    args.cpuPercent,
    args.economyMode ?? "legacy",
    args.initialState ?? "provisioning",
    now,
    now,
    now,
  );
  return tier;
}

/** Transition a pod's meter state. The caller passes the desired state
 * and `restart` semantics: if the pod is restarting, last_billed_at is
 * advanced to `nowSeconds` so the container being briefly down isn't
 * billed (and conversely, the first second of the new run isn't already-
 * accrued). For pure stop/start/delete, last_billed_at is left alone so
 * any owed time from before is still settled on the next tick. */
export function setMeterStateState(
  podUuidShort: string,
  state: PodMeterState["state"],
  opts: { advanceLastBilledTo?: number } = {},
): void {
  const now = unixNow();
  if (opts.advanceLastBilledTo != null) {
    db.prepare(
      `UPDATE pod_meter_state
          SET state = ?, last_billed_at = ?, updated_at = ?
        WHERE pod_uuid_short = ?`,
    ).run(state, opts.advanceLastBilledTo, now, podUuidShort);
  } else {
    db.prepare(
      `UPDATE pod_meter_state SET state = ?, updated_at = ? WHERE pod_uuid_short = ?`,
    ).run(state, now, podUuidShort);
  }
}

export function getMeterState(
  podUuidShort: string,
): PodMeterState | null {
  return (
    db
      .prepare<[string], PodMeterState>(
        `SELECT * FROM pod_meter_state WHERE pod_uuid_short = ?`,
      )
      .get(podUuidShort) ?? null
  );
}

/** Used by the threshold engine on suspend: bulk-flip a user's running
 * pods to 'suspended'. The actual Pelican `power stop` call is the
 * caller's responsibility — this only mutates the DB. */
export function suspendUserPodsInDb(userId: number): string[] {
  const rows = db
    .prepare<[number], { pod_uuid_short: string }>(
      `SELECT pod_uuid_short FROM pod_meter_state
        WHERE user_id = ? AND state = 'running' AND economy_mode = 'legacy'`,
    )
    .all(userId);
  for (const r of rows) {
    setMeterStateState(r.pod_uuid_short, "suspended");
  }
  return rows.map((r) => r.pod_uuid_short);
}

/** Mirror of suspendUserPodsInDb for the resume path. Returns the pods
 * that flipped — the caller power-starts them via Pelican. */
export function resumeUserPodsInDb(userId: number): string[] {
  const rows = db
    .prepare<[number], { pod_uuid_short: string }>(
      `SELECT pod_uuid_short FROM pod_meter_state
        WHERE user_id = ? AND state = 'suspended' AND economy_mode = 'legacy'`,
    )
    .all(userId);
  for (const r of rows) {
    // last_billed_at must advance to NOW or the next tick will bill for
    // the entire suspension window.
    setMeterStateState(r.pod_uuid_short, "running", {
      advanceLastBilledTo: unixNow(),
    });
  }
  return rows.map((r) => r.pod_uuid_short);
}

/** Used by the daily storage charge job — list pods that are stopped or
 * suspended (and thus accruing storage rather than per-hour). */
export function listStorageBillablePods(): PodMeterState[] {
  return db
    .prepare<[], PodMeterState>(
      `SELECT * FROM pod_meter_state
        WHERE state IN ('stopped', 'suspended') AND economy_mode = 'legacy'`,
    )
    .all();
}

export function listMeterStatesForUser(userId: number): PodMeterState[] {
  return db
    .prepare<[number], PodMeterState>(
      `SELECT * FROM pod_meter_state WHERE user_id = ? AND state != 'deleted'
        ORDER BY created_at DESC`,
    )
    .all(userId);
}

export function tierSlugForPod(podUuidShort: string): TierSlug | null {
  const row = db
    .prepare<[string], { tier_slug: TierSlug }>(
      `SELECT tier_slug FROM pod_meter_state WHERE pod_uuid_short = ?`,
    )
    .get(podUuidShort);
  return row?.tier_slug ?? null;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
