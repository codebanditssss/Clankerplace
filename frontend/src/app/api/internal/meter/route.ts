import { NextResponse, type NextRequest } from "next/server";
import { runMeterTick } from "@/lib/billing/meter";
import { evaluateUser, runThresholdSweep } from "@/lib/billing/thresholds";
import { runStorageRollup } from "@/lib/billing/storage";
import { getConfig } from "@/lib/billing/config";

export const runtime = "nodejs";

/**
 * Internal-only endpoint hit by server.mjs's meter timer.
 *
 * One tick:
 *   1. runMeterTick(): walks running pods, debits owed cents per
 *      atomic ledger transaction.
 *   2. evaluateUser() for every user whose balance moved this tick —
 *      catches the user that crossed warn → grace → suspend boundaries
 *      right when the move happened (rather than waiting for the
 *      slower sweep).
 *   3. Once per N ticks (every 30 minutes), also runs the full
 *      thresholdSweep — catches users whose balance didn't change
 *      this tick but who *have* now been in 'grace' for 24h+ or
 *      'suspended' for 7d/30d.
 *
 * Protected by INTERNAL_METER_TOKEN (shared between server.mjs and
 * this route). Same concurrency guard as the reconcile route — a
 * long tick can't overlap the next.
 */

let running = false;
let tickCount = 0;
const SWEEP_EVERY_N_TICKS = 30;
// Track the last UTC day we ran the storage rollup so we only run it
// once per day even though the meter tick fires every 60s.
let lastStorageRollupDay = -1;

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-internal-token");
  const expected =
    process.env.INTERNAL_METER_TOKEN ?? process.env.INTERNAL_RECONCILE_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "meter_not_configured" },
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
    if (!getConfig("feature.usage_billing_enabled")) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "usage_billing_disabled",
      });
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const tickResults = runMeterTick(nowSeconds);

    // Per-affected-user threshold re-eval. Dedupe so we don't evaluate
    // the same user multiple times when they have several running pods.
    const affectedUsers = new Set<number>();
    for (const r of tickResults) {
      if (r.owed_cents > 0) affectedUsers.add(r.user_id);
    }
    for (const userId of affectedUsers) {
      try {
        await evaluateUser(userId, { nowSeconds });
      } catch (err) {
        console.error(
          `[meter] evaluateUser failed for ${userId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Periodic full sweep — catches grace/purge timeouts.
    tickCount = (tickCount + 1) % SWEEP_EVERY_N_TICKS;
    let sweepStats: Awaited<ReturnType<typeof runThresholdSweep>> | null = null;
    if (tickCount === 0) {
      try {
        sweepStats = await runThresholdSweep({ nowSeconds });
      } catch (err) {
        console.error(
          "[meter] runThresholdSweep failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Storage rollup once per UTC day. The first tick of a new day flips
    // the gate. If the app was restarted mid-day, lastStorageRollupDay
    // is -1 so the next tick runs the rollup — but runStorageRollup
    // itself is idempotent (a per-(pod, day) existence check inside),
    // so a same-day re-run is a no-op.
    const todayUtcDay = Math.floor(nowSeconds / 86400);
    let storageStats: ReturnType<typeof runStorageRollup> | null = null;
    if (todayUtcDay !== lastStorageRollupDay) {
      try {
        storageStats = runStorageRollup(nowSeconds);
        lastStorageRollupDay = todayUtcDay;
      } catch (err) {
        console.error(
          "[meter] runStorageRollup failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      pods_ticked: tickResults.length,
      pods_debited: tickResults.filter((r) => r.owed_cents > 0).length,
      total_owed_cents: tickResults.reduce((s, r) => s + r.owed_cents, 0),
      users_evaluated: affectedUsers.size,
      sweep: sweepStats,
      storage: storageStats,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meter] tick failed:", msg);
    return NextResponse.json(
      { error: "tick_failed", message: msg },
      { status: 500 },
    );
  } finally {
    running = false;
  }
}
