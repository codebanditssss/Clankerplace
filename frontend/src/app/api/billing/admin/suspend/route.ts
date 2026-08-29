import { NextResponse, type NextRequest } from "next/server";
import { AdminError, requireAdmin } from "@/lib/billing/admin";
import {
  evaluateUser,
  type EffectRunner,
  type ThresholdSideEffect,
} from "@/lib/billing/thresholds";
import { suspendUserPodsInDb, resumeUserPodsInDb } from "@/lib/billing/meter";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/billing/admin/suspend
 * Body: { user_id: number, action: "suspend" | "resume" }
 *
 * Manual override of the threshold engine for ops scenarios — e.g.
 * a user paid out-of-band and you want their pods running NOW
 * without waiting for the next threshold sweep, or you need to
 * suspend a user for ToS violation regardless of balance.
 *
 * Suspend: flips every running pod to 'suspended' AND issues the
 * Pelican-side suspend so panel access is gated too.
 * Resume:  reverses the same flip + unsuspends in Pelican.
 *
 * Does NOT touch user_billing_state.suspended_at — that field tracks
 * the *balance-driven* suspension; an admin-driven one is a separate
 * concept. (If we needed to track this for audit, we'd add a
 * `manually_suspended_at` column. Deferring until there's a real
 * operational ask.)
 */
export async function POST(req: NextRequest) {
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
  const rl = rateLimit(`admin.suspend:${admin.id}`, {
    rate: 10 / 60,
    burst: 3,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const userId = (body as { user_id?: unknown }).user_id;
  const action = (body as { action?: unknown }).action;
  if (typeof userId !== "number" || !Number.isInteger(userId)) {
    return NextResponse.json({ error: "user_id_required_int" }, { status: 400 });
  }
  if (action !== "suspend" && action !== "resume") {
    return NextResponse.json(
      { error: "action_must_be_suspend_or_resume" },
      { status: 400 },
    );
  }

  // We bypass the classify() pure function here because admins are
  // overriding the balance signal. Direct DB flip + direct Pelican
  // call.
  if (action === "suspend") {
    const pods = suspendUserPodsInDb(userId);
    for (const podShort of pods) {
      await pelicanPower(podShort, "suspend").catch((err) => {
        console.warn(
          `[admin-suspend] pelican suspend failed for ${podShort}: ${String(err)}`,
        );
      });
    }
    return NextResponse.json({ ok: true, action, pods_affected: pods });
  }
  const pods = resumeUserPodsInDb(userId);
  for (const podShort of pods) {
    await pelicanPower(podShort, "unsuspend").catch((err) => {
      console.warn(
        `[admin-suspend] pelican unsuspend failed for ${podShort}: ${String(err)}`,
      );
    });
  }
  // Run the threshold engine so the user-side state row is consistent
  // with the new reality (e.g. clear warn_low_sent_at if the user
  // happens to be above warn threshold).
  void recordResume(userId);
  return NextResponse.json({ ok: true, action, pods_affected: pods });
}

async function pelicanPower(
  podShort: string,
  signal: "suspend" | "unsuspend",
): Promise<void> {
  const found = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(podShort)}`);
  const srv = found.data?.[0]?.attributes;
  if (!srv) return;
  await applicationApi(`/servers/${srv.id}/${signal}`, { method: "POST" });
}

async function recordResume(userId: number): Promise<void> {
  // Use a no-op runner — pods are already started above; we only want
  // the bookkeeping side of evaluateUser to fire.
  const swallow: EffectRunner = async (_e: ThresholdSideEffect) => undefined;
  await evaluateUser(userId, { effectRunner: swallow });
}
