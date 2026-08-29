import { NextResponse, type NextRequest } from "next/server";
import { getCreditBalance } from "@/lib/billing/credits";
import { getConfig } from "@/lib/billing/config";

export const runtime = "nodejs";

/**
 * Internal-only balance gate for the managed-AI gateway worker.
 *
 * The worker calls this before serving a Pods Managed inference so it can
 * hard-block once a user's credit wallet hits the floor. Protected by the
 * MANAGED_USAGE_TOKEN shared secret (same one the worker presents on the
 * usage callback). The worker has already verified the per-user HMAC token,
 * so it passes the resolved user_id here.
 *
 * Returns { allowed } where allowed = balance_cents > block_floor_cents.
 * Fails OPEN (allowed:true) only when metering is disabled, so toggling the
 * feature flag off instantly stops blocking.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-internal-token");
  const expected = process.env.MANAGED_USAGE_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "managed_usage_not_configured" }, { status: 503 });
  }
  if (!token || token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { user_id?: unknown };
  try {
    body = (await req.json()) as { user_id?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const userId = Number(body.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "invalid_user_id" }, { status: 400 });
  }

  // Feature off → never block (fail open).
  if (getConfig("feature.managed_billing_enabled") !== true) {
    return NextResponse.json({ allowed: true, metering: false });
  }

  const floor = getConfig("managed.block_floor_cents", { userId });
  const balance = getCreditBalance(userId).balance_cents;
  return NextResponse.json({
    allowed: balance > floor,
    metering: true,
    balance_cents: balance,
    floor_cents: floor,
  });
}
