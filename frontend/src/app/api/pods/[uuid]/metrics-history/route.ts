// GET /api/pods/<uuid>/metrics-history?range=1m|5m|15m|1h|6h|24h
//
// Returns the recorded docker-stats samples for the pod, written by the
// background sampler in server.mjs (`pollMetrics` → `pod_metrics` table).
// The Stats tab calls this on mount + whenever the user changes the range
// picker, then layers live WS deltas on top.
//
// For ranges ≥ 15m we down-sample server-side by bucketing on timestamp:
// 24h × 5s sampling = 17,280 rows per pod, which is too many points to
// render meaningfully. Aggregating into ~300 buckets keeps the chart
// fast without losing the shape.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

type RangeKey = "1m" | "5m" | "15m" | "1h" | "6h" | "24h";

const RANGE_MS: Record<RangeKey, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

// Target buckets per chart. Pick this so even 24h fits in ~300 points
// (24h / 300 buckets = 4.8 min per bucket).
const TARGET_BUCKETS = 300;

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid: uuidShort } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuidShort, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rawRange = req.nextUrl.searchParams.get("range");
  const range: RangeKey =
    rawRange && rawRange in RANGE_MS ? (rawRange as RangeKey) : "5m";

  const now = Date.now();
  const since = now - RANGE_MS[range];

  // Bucket width chosen so we return ≤ TARGET_BUCKETS rows. For 1m/5m
  // (≤ 60 samples raw) we skip bucketing entirely so the live view has
  // 5-second resolution. For 15m+ we average per bucket so the wire
  // payload + render stay reasonable.
  const bucketMs = Math.max(
    5_000,
    Math.ceil(RANGE_MS[range] / TARGET_BUCKETS / 1000) * 1000,
  );

  type Row = {
    t: number;
    cpu: number | null;
    mem_mb: number | null;
    mem_pct: number | null;
    net_rx_mb: number | null;
    net_tx_mb: number | null;
  };

  let rows: Row[];
  if (RANGE_MS[range] <= 5 * 60_000) {
    rows = db
      .prepare(
        `SELECT ts AS t, cpu, mem_mb, mem_pct, net_rx_mb, net_tx_mb
           FROM pod_metrics
          WHERE uuid_short = ? AND ts >= ?
          ORDER BY ts ASC`,
      )
      .all(uuidShort, since) as Row[];
  } else {
    // Bucket aggregation. We use the *max* of net_rx/tx (which are
    // cumulative counters) so the per-second rate computed downstream
    // stays positive across the boundary.
    rows = db
      .prepare(
        `SELECT
            (ts / ?) * ? AS t,
            AVG(cpu) AS cpu,
            AVG(mem_mb) AS mem_mb,
            AVG(mem_pct) AS mem_pct,
            MAX(net_rx_mb) AS net_rx_mb,
            MAX(net_tx_mb) AS net_tx_mb
           FROM pod_metrics
          WHERE uuid_short = ? AND ts >= ?
          GROUP BY (ts / ?)
          ORDER BY t ASC`,
      )
      .all(bucketMs, bucketMs, uuidShort, since, bucketMs) as Row[];
  }

  return NextResponse.json({
    range,
    since,
    bucketMs: RANGE_MS[range] <= 5 * 60_000 ? null : bucketMs,
    samples: rows,
  });
}
