import { NextResponse, type NextRequest } from "next/server";
import { reconcilePelicanOnce } from "@/lib/billing/reconcile-pelican";

export const runtime = "nodejs";

/**
 * Internal-only endpoint hit by server.mjs's pelican-reconcile timer
 * every 5 minutes. Cross-checks our pod_meter_state against the Pelican
 * Application API and corrects drift (dropped webhooks, admin-side
 * deletes, resource resizes, legacy pods).
 *
 * Same token + concurrency-guard pattern as /api/internal/reconcile and
 * /api/internal/meter.
 */
let running = false;

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-internal-token");
  const expected =
    process.env.INTERNAL_METER_TOKEN ?? process.env.INTERNAL_RECONCILE_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "not_configured" },
      { status: 503 },
    );
  }
  if (!token || token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (running) {
    return NextResponse.json({ skipped: true, reason: "already_running" });
  }
  running = true;
  try {
    const stats = await reconcilePelicanOnce();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[reconcile-pelican] tick failed:", msg);
    return NextResponse.json(
      { error: "tick_failed", message: msg },
      { status: 500 },
    );
  } finally {
    running = false;
  }
}
