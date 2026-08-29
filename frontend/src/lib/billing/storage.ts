import "server-only";
import db, { type PodMeterState } from "../db";
import { storageMilliCentsPerDay } from "./pricing";
import { insertLedger } from "./ledger";
import { billingLog } from "./logger";
import { getConfig } from "./config";
import { isPodFreeForUser } from "./cohort";

/**
 * Daily storage charge rollup. Runs once per UTC day.
 *
 * Pods in state `stopped` or `suspended` keep their bind-mount volume,
 * which is real cost on the Wings node. We bill $0.10/GB-month prorated
 * to a daily rate. The math is in pricing.ts:storageMilliCentsPerDay.
 *
 * Idempotency: each (pod, utc_day) is debited at most once. We enforce
 * this with the partial unique index `idx_storage_pod_day_uniq` on
 * credit_ledger created in db.ts. A second invocation for the same
 * (pod, day) raises SQLITE_CONSTRAINT and we swallow it.
 *
 * Why "once per day" and not "every tick at 1/1440 of the daily rate":
 * the ledger row count would explode (1440 rows/pod/day vs 1). The
 * dashboard is more readable with daily summary entries.
 */

export type StorageRollupResult = {
  pods_scanned: number;
  pods_charged: number;
  pods_skipped_zero: number;
  pods_skipped_duplicate: number;
  total_cents_charged: number;
};

/**
 * Run the storage rollup for the given UTC day (default: today). Each
 * eligible pod is debited at most once for that day.
 *
 * Returns counters for observability + the test suite.
 */
export function runStorageRollup(
  nowSeconds: number = Math.floor(Date.now() / 1000),
): StorageRollupResult {
  const utcDay = Math.floor(nowSeconds / 86400) * 86400;
  const stats: StorageRollupResult = {
    pods_scanned: 0,
    pods_charged: 0,
    pods_skipped_zero: 0,
    pods_skipped_duplicate: 0,
    total_cents_charged: 0,
  };

  // Feature flag — admin can disable storage billing entirely (e.g.
  // during early-access free-pod windows or a billing-system outage).
  if (!getConfig("feature.storage_billing_enabled")) {
    billingLog.info("storage.rollup_skipped_disabled", {});
    return stats;
  }

  const pods = db
    .prepare<[], PodMeterState>(
      `SELECT * FROM pod_meter_state
        WHERE state IN ('stopped', 'suspended')`,
    )
    .all();
  stats.pods_scanned = pods.length;

  const alreadyChargedStmt = db.prepare<
    [string, number, number],
    { c: number }
  >(
    `SELECT COUNT(*) AS c FROM credit_ledger
      WHERE ref_pod_uuid = ?
        AND reason = 'storage'
        AND ts >= ? AND ts < ?`,
  );

  // Wrap the whole rollup in a single transaction so a process crash
  // mid-loop either rolls back everything or commits everything.
  // Per-pod cost is tiny (microseconds) so the lock duration is fine.
  const runAll = db.transaction(() => {
    for (const pod of pods) {
      // If this is the user's claimed free pod, storage is also free
      // (the free slot covers the whole pod lifecycle including stopped
      // storage). Other pods owned by the same user pay storage even
      // when one of theirs is the free slot.
      if (isPodFreeForUser(pod.user_id, pod.pod_uuid_short)) {
        continue;
      }
      const milli = storageMilliCentsPerDay(pod.disk_mib);
      // Round up to whole cents (favors the house, avoids 0.003¢ rows).
      const cents = Math.ceil(milli / 1000);
      if (cents <= 0) {
        stats.pods_skipped_zero++;
        continue;
      }
      // Idempotency: have we already charged this pod for storage in
      // this UTC day window?
      const existing = alreadyChargedStmt.get(
        pod.pod_uuid_short,
        utcDay,
        utcDay + 86400,
      );
      if ((existing?.c ?? 0) > 0) {
        stats.pods_skipped_duplicate++;
        continue;
      }
      try {
        insertLedger({
          userId: pod.user_id,
          delta_cents: -cents,
          reason: "storage",
          ref_pod_uuid: pod.pod_uuid_short,
          note: `storage:${pod.disk_mib}mib for ${isoDate(utcDay)}`,
        });
        // Force `ts` to the utc_day midnight so the daily rollup SQL
        // (in usage.ts) groups it on the right day even if the rollup
        // runs at 23:59 UTC.
        db.prepare(
          `UPDATE credit_ledger SET ts = ? WHERE rowid = last_insert_rowid()`,
        ).run(utcDay);
        stats.pods_charged++;
        stats.total_cents_charged += cents;
      } catch (err) {
        billingLog.error("storage.rollup_insert_failed", {
          pod: pod.pod_uuid_short,
          user_id: pod.user_id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });
  runAll();

  billingLog.info("storage.rollup_completed", {
    utc_day: utcDay,
    ...stats,
  });
  return stats;
}

function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
