import "server-only";
import db, { type PodMeterState } from "../db";
import { applicationApi, type ServerAttributes } from "../pelican";
import {
  setMeterStateState,
  upsertMeterStateFromPelican,
} from "./meter";
import { billingLog } from "./logger";
import { getConfig } from "./config";

/**
 * Periodic cross-check between `pod_meter_state` and Pelican. Catches:
 *
 *   - Dropped Pelican webhooks (a power change happened but our DB
 *     didn't hear about it).
 *   - Pods deleted from the Pelican admin panel without going through
 *     our DELETE /api/pods/[uuid] route → we still think they're
 *     running and bill for them.
 *   - Pods that exist in Pelican but never landed in our meter (e.g.
 *     legacy pods created before metering shipped).
 *   - Resource resizes (memory/disk/cpu changed via the Pelican panel)
 *     → rate stays in sync.
 *
 * Run on a 5-minute timer from server.mjs over the same loopback
 * pattern as the meter + reconciler.
 *
 * Resource-cost: one Pelican `GET /servers?per_page=200` call. At <200
 * pods this is one HTTP round-trip; above 200 we paginate. The
 * comparison loop is O(pods) and runs entirely in JS.
 */

export type PelicanReconcileResult = {
  pelican_pods_seen: number;
  meter_pods_seen: number;
  state_corrections: number;
  rate_corrections: number;
  backfilled: number;
  deleted_in_meter: number;
  errors: number;
};

type PelicanServerListItem = { attributes: ServerAttributes };

async function fetchAllPelicanServers(): Promise<ServerAttributes[]> {
  const out: ServerAttributes[] = [];
  let page = 1;
  for (let i = 0; i < 100; i++) {
    type Resp = {
      data: PelicanServerListItem[];
      meta?: { pagination?: { current_page: number; total_pages: number } };
    };
    const r = await applicationApi<Resp>(`/servers?per_page=200&page=${page}`);
    for (const s of r.data) out.push(s.attributes);
    const pg = r.meta?.pagination;
    if (!pg || pg.current_page >= pg.total_pages) break;
    page++;
  }
  return out;
}

function pelicanPowerToMeterState(
  status: string | null,
): PodMeterState["state"] | null {
  // Pelican's `status` field comes from the panel's view of the
  // container. We map it to our meter states. Unknown values return
  // null and the caller leaves the meter alone.
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "running" || s === "starting") return "running";
  if (s === "offline" || s === "stopped" || s === "stopping") return "stopped";
  if (s === "installing") return "provisioning";
  return null;
}

export async function reconcilePelicanOnce(): Promise<PelicanReconcileResult> {
  const stats: PelicanReconcileResult = {
    pelican_pods_seen: 0,
    meter_pods_seen: 0,
    state_corrections: 0,
    rate_corrections: 0,
    backfilled: 0,
    deleted_in_meter: 0,
    errors: 0,
  };

  if (!getConfig("feature.pelican_reconcile_enabled")) {
    billingLog.info("reconcile.pelican.skipped_disabled", {});
    return stats;
  }

  let pelicanServers: ServerAttributes[];
  try {
    pelicanServers = await fetchAllPelicanServers();
  } catch (err) {
    billingLog.error("reconcile.pelican.fetch_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    stats.errors++;
    return stats;
  }
  stats.pelican_pods_seen = pelicanServers.length;

  // Index Pelican pods by uuid_short for O(1) lookup.
  const pelicanByShort = new Map(
    pelicanServers.map((s) => [s.identifier, s]),
  );

  // Walk our meter rows, except 'deleted' (terminal — no work to do).
  const meterRows = db
    .prepare<[], PodMeterState>(
      `SELECT * FROM pod_meter_state WHERE state != 'deleted'`,
    )
    .all();
  stats.meter_pods_seen = meterRows.length;

  for (const m of meterRows) {
    const p = pelicanByShort.get(m.pod_uuid_short);
    if (!p) {
      // Pelican doesn't know about this pod anymore → admin deleted it
      // outside our flow. Flip to deleted so we stop billing.
      try {
        setMeterStateState(m.pod_uuid_short, "deleted");
        stats.deleted_in_meter++;
        billingLog.info("reconcile.pelican.deleted_orphan", {
          pod: m.pod_uuid_short,
        });
      } catch (err) {
        stats.errors++;
        billingLog.error("reconcile.pelican.delete_failed", {
          pod: m.pod_uuid_short,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }
    // State drift?
    const want = pelicanPowerToMeterState(p.status);
    if (want != null && want !== m.state) {
      // Special case: we say 'suspended' (balance-driven) but Pelican
      // says 'stopped'. Don't auto-flip 'suspended' → 'running' via
      // reconcile — the thresholds engine owns 'suspended' state.
      if (m.state === "suspended") {
        // Leave suspended alone; threshold engine will resume on top-up.
      } else {
        try {
          setMeterStateState(m.pod_uuid_short, want, {
            // Adopt the now() so we don't bill for the drift window
            // (could be hours if a webhook was missed).
            advanceLastBilledTo: Math.floor(Date.now() / 1000),
          });
          stats.state_corrections++;
          billingLog.info("reconcile.pelican.state_corrected", {
            pod: m.pod_uuid_short,
            from: m.state,
            to: want,
            pelican_status: p.status,
          });
        } catch (err) {
          stats.errors++;
        }
      }
    }
    // Rate drift? (Admin resized RAM in the panel.)
    if (
      p.limits.memory !== m.ram_mib ||
      p.limits.disk !== m.disk_mib ||
      p.limits.cpu !== m.cpu_percent
    ) {
      try {
        upsertMeterStateFromPelican({
          pod_uuid_short: m.pod_uuid_short,
          pod_full_uuid: m.pod_full_uuid,
          user_id: m.user_id,
          ramMib: p.limits.memory,
          diskMib: p.limits.disk,
          cpuPercent: p.limits.cpu,
          // Don't change state on a rate-only update.
          initialState: m.state,
        });
        stats.rate_corrections++;
        billingLog.info("reconcile.pelican.rate_corrected", {
          pod: m.pod_uuid_short,
          ram_was: m.ram_mib,
          ram_now: p.limits.memory,
        });
      } catch (err) {
        stats.errors++;
      }
    }
    pelicanByShort.delete(m.pod_uuid_short);
  }

  // Pelican knows about pods we don't — backfill the meter rows so we
  // start billing for legacy pods.
  for (const p of pelicanByShort.values()) {
    const owner = db
      .prepare<[number], { id: number }>(
        `SELECT id FROM users WHERE pelican_user_id = ?`,
      )
      .get(p.user);
    if (!owner) {
      // No local user for this Pelican user — likely a panel-admin
      // pod or something we don't own. Skip.
      continue;
    }
    try {
      const initialState =
        pelicanPowerToMeterState(p.status) ?? "stopped";
      upsertMeterStateFromPelican({
        pod_uuid_short: p.identifier,
        pod_full_uuid: p.uuid,
        user_id: owner.id,
        ramMib: p.limits.memory,
        diskMib: p.limits.disk,
        cpuPercent: p.limits.cpu,
        initialState,
      });
      stats.backfilled++;
      billingLog.info("reconcile.pelican.backfilled", {
        pod: p.identifier,
        user_id: owner.id,
        state: initialState,
      });
    } catch (err) {
      stats.errors++;
      billingLog.error("reconcile.pelican.backfill_failed", {
        pod: p.identifier,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  billingLog.info("reconcile.pelican.completed", { ...stats });
  return stats;
}
