import { NextResponse } from "next/server";
import { AdminError, requireAdmin, runReconciliation } from "@/lib/billing/admin";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/billing/admin/reconcile
 *
 * Runs the drift check across every user with a ledger row. Returns
 * the list of users where the reported balance disagrees with the
 * sum of their ledger entries — with the single-table append-only
 * pattern this should always be 0 rows. Anything non-empty is a bug
 * to investigate.
 *
 * Also surfaces ledger rows with NULL user_id / delta_cents — those
 * indicate a write that bypassed insertLedger() (which guards the
 * invariants). Should also always be 0.
 *
 * Designed to run on a daily cron from outside the app (e.g. systemd
 * timer hitting this endpoint with the admin session cookie of a
 * dedicated reconciliation account). Cheap enough to also surface as
 * a "run now" button in a future admin UI.
 */
export async function GET() {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof AdminError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.code === "unauthorized" ? 401 : 403 },
      );
    }
    throw err;
  }
  // Reconciliation is read-only but expensive; cap to once-per-second
  // per admin so a buggy refresh loop doesn't pin the DB.
  const rl = rateLimit(`admin.reconcile:${admin.id}`, {
    rate: 60 / 60,
    burst: 3,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }
  const result = runReconciliation();
  // Drift means a billing-correctness bug; 500-ish severity. We return
  // 200 anyway so the report is readable; the *count* in the body is
  // the actionable signal for an alerting cron.
  return NextResponse.json({
    ok: true,
    users_checked: result.users_checked,
    drift_count: result.drift.length,
    drift: result.drift,
    malformed_count: result.malformed.length,
    malformed: result.malformed,
  });
}
