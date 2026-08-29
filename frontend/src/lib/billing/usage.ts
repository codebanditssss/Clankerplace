import "server-only";
import db, { type LedgerReason } from "../db";

/**
 * Usage aggregation — read-only views over the credit_ledger for the
 * billing UI.
 *
 * Everything here is computed live (no materialized roll-up) because
 * SQLite + an indexed `credit_ledger(user_id, ts DESC)` will answer a
 * 30-day per-user windowed scan in tens of microseconds for any realistic
 * v1 user volume. We can move to a `daily_usage` materialized table when
 * a single user has > ~100k ledger entries.
 *
 * All amounts in cents, all timestamps in unix seconds.
 */

export type UsageRange = "7d" | "30d" | "all";

export type DailyBucket = {
  /** ISO date 'YYYY-MM-DD' in UTC. */
  date: string;
  /** Unix-seconds midnight UTC for that date. */
  ts: number;
  /** Sum of all positive ledger entries (topups + promos + manual). */
  credits_cents: number;
  /** Sum of |negative ledger entries|. */
  debits_cents: number;
  /** Breakdown by reason — every LedgerReason key, missing = 0. */
  by_reason: Partial<Record<LedgerReason, number>>;
};

export type PodUsageBucket = {
  pod_uuid_short: string;
  tier_slug: string | null;
  total_cents: number;
  hours_billed: number;
};

export type UsageReport = {
  range: UsageRange;
  from_ts: number;
  to_ts: number;
  total_credits_cents: number;
  total_debits_cents: number;
  daily: DailyBucket[];
  by_pod: PodUsageBucket[];
};

export function rangeToFromTs(range: UsageRange, nowSeconds: number): number {
  switch (range) {
    case "7d":
      return nowSeconds - 7 * 24 * 60 * 60;
    case "30d":
      return nowSeconds - 30 * 24 * 60 * 60;
    case "all":
      return 0;
  }
}

/** Generate the full date series in the range so the chart shows zeros
 * for days with no activity (instead of skipping them). */
function dateSeries(fromTs: number, toTs: number): DailyBucket[] {
  const out: DailyBucket[] = [];
  // Snap from to UTC midnight.
  const fromDay = Math.floor(fromTs / 86400) * 86400;
  for (let t = fromDay; t <= toTs; t += 86400) {
    out.push({
      date: isoDate(t),
      ts: t,
      credits_cents: 0,
      debits_cents: 0,
      by_reason: {},
    });
  }
  return out;
}

function isoDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function getUsage(
  userId: number,
  range: UsageRange,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): UsageReport {
  const fromTs = rangeToFromTs(range, nowSeconds);
  const toTs = nowSeconds;

  type Row = {
    day: number;
    reason: LedgerReason;
    sum_cents: number;
  };
  const rows = db
    .prepare<[number, number, number], Row>(
      `SELECT (ts / 86400) * 86400 AS day,
              reason,
              SUM(delta_cents)      AS sum_cents
         FROM credit_ledger
        WHERE user_id = ? AND ts >= ? AND ts <= ?
        GROUP BY day, reason
        ORDER BY day`,
    )
    .all(userId, fromTs, toTs);

  const series = dateSeries(fromTs, toTs);
  const byDay = new Map(series.map((b) => [b.ts, b]));
  let totalCredits = 0;
  let totalDebits = 0;
  for (const r of rows) {
    let bucket = byDay.get(r.day);
    if (!bucket) {
      // Pre-fromTs day (shouldn't happen due to WHERE clause, but be defensive).
      bucket = {
        date: isoDate(r.day),
        ts: r.day,
        credits_cents: 0,
        debits_cents: 0,
        by_reason: {},
      };
      byDay.set(r.day, bucket);
      series.push(bucket);
    }
    bucket.by_reason[r.reason] =
      (bucket.by_reason[r.reason] ?? 0) + r.sum_cents;
    if (r.sum_cents > 0) {
      bucket.credits_cents += r.sum_cents;
      totalCredits += r.sum_cents;
    } else {
      bucket.debits_cents += -r.sum_cents;
      totalDebits += -r.sum_cents;
    }
  }
  series.sort((a, b) => a.ts - b.ts);

  // Per-pod breakdown — pod_hour debits + storage debits aggregated
  // across the same range. Joins with pod_meter_state to expose tier_slug,
  // but pods that have since been deleted will have a NULL tier_slug.
  const podRows = db
    .prepare<
      [number, number, number],
      { pod_uuid_short: string; tier_slug: string | null; sum_cents: number; n_entries: number }
    >(
      `SELECT cl.ref_pod_uuid              AS pod_uuid_short,
              pms.tier_slug                AS tier_slug,
              SUM(cl.delta_cents)          AS sum_cents,
              COUNT(*)                     AS n_entries
         FROM credit_ledger cl
    LEFT JOIN pod_meter_state pms ON pms.pod_uuid_short = cl.ref_pod_uuid
        WHERE cl.user_id = ? AND cl.ts >= ? AND cl.ts <= ?
          AND cl.ref_pod_uuid IS NOT NULL
          AND cl.reason IN ('pod_hour', 'storage', 'egress')
        GROUP BY cl.ref_pod_uuid
        ORDER BY sum_cents ASC`,
    )
    .all(userId, fromTs, toTs);

  // hours_billed = sum of |debit| / per-hour rate. Doesn't include
  // storage (which is per-day), so this is an APPROXIMATION of actual
  // running hours — we don't store elapsed time per ledger row. Good
  // enough for the dashboard.
  const byPod: PodUsageBucket[] = podRows.map((p) => {
    const cents = Math.abs(p.sum_cents);
    return {
      pod_uuid_short: p.pod_uuid_short,
      tier_slug: p.tier_slug,
      total_cents: cents,
      // Approximate; UI displays this as "~Xh". Real exact hours would
      // need a separate `pod_session_log` table.
      hours_billed: p.n_entries, // 1 entry ≈ 1 minute tick; ~60 entries/hr
    };
  });

  return {
    range,
    from_ts: fromTs,
    to_ts: toTs,
    total_credits_cents: totalCredits,
    total_debits_cents: totalDebits,
    daily: series,
    by_pod: byPod,
  };
}

/** Compute current daily burn (cents/day) from running pods.
 *
 * Excludes the user's claimed free pod (if any). For founding /
 * paid-unlocked users with a single pod that pod is free → burn is 0.
 * Their 2nd, 3rd, … pods still contribute to burn. PAYG users always
 * count every running pod. */
export function getCurrentBurnPerDayCents(userId: number): number {
  // Lazy-import to avoid a hard circular dep (cohort.ts → db → usage).
  // The cycle isn't real but the lazy require keeps load-order obvious.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getFreePodUuid, isUserCohortEligible } =
    require("./cohort") as typeof import("./cohort");
  const freeSlot = isUserCohortEligible(userId) ? getFreePodUuid(userId) : null;
  const row = freeSlot
    ? db
        .prepare<[number, string], { s: number | null }>(
          `SELECT SUM(rate_milli_cents_per_hour) AS s
             FROM pod_meter_state
            WHERE user_id = ? AND state = 'running'
              AND economy_mode = 'legacy'
              AND pod_uuid_short <> ?`,
        )
        .get(userId, freeSlot)
    : db
        .prepare<[number], { s: number | null }>(
          `SELECT SUM(rate_milli_cents_per_hour) AS s
             FROM pod_meter_state
            WHERE user_id = ? AND state = 'running'
              AND economy_mode = 'legacy'`,
        )
        .get(userId);
  const sumMilli = row?.s ?? 0;
  // milli-cents/hr × 24 / 1000 = cents/day
  return Math.floor((sumMilli * 24) / 1000);
}

/** Days of runway given current balance and current burn. Returns
 * Infinity when burn is 0 (no running pods); the UI renders that as
 * an em-dash. */
export function runwayDays(
  balanceCents: number,
  burnPerDayCents: number,
): number {
  if (burnPerDayCents <= 0) return Number.POSITIVE_INFINITY;
  return balanceCents / burnPerDayCents;
}

/** Lightweight CSV export of the daily series. Cheap to render
 * client-side, but we serve from the API so the download includes the
 * server's view (e.g. for support-ticket attachment). */
export function dailyCsv(report: UsageReport): string {
  const lines = [
    "date,credits_cents,debits_cents,topup_cents,pod_hour_cents,storage_cents,egress_cents,refund_cents,promo_cents,manual_adjust_cents,referral_cents",
  ];
  for (const d of report.daily) {
    lines.push(
      [
        d.date,
        d.credits_cents,
        d.debits_cents,
        d.by_reason.invoice_credit ?? 0,
        -(d.by_reason.pod_hour ?? 0),
        -(d.by_reason.storage ?? 0),
        -(d.by_reason.egress ?? 0),
        -(d.by_reason.refund ?? 0),
        d.by_reason.promo ?? 0,
        d.by_reason.manual_adjustment ?? 0,
        d.by_reason.referral ?? 0,
      ].join(","),
    );
  }
  return lines.join("\n");
}
