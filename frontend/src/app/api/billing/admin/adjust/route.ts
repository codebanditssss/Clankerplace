import { NextResponse, type NextRequest } from "next/server";
import { adjustBalance, AdminError, requireAdmin, reevaluateThresholds } from "@/lib/billing/admin";
import {
  isValidIdempotencyKey,
  lookupIdempotent,
  storeIdempotent,
} from "@/lib/billing/idempotency";
import { billingLog } from "@/lib/billing/logger";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

type AdjustResponse = {
  ok: true;
  new_balance_cents: number;
  ledger_id: number;
};

/**
 * POST /api/billing/admin/adjust
 * Body: { user_id: number, delta_cents: number, note: string }
 *
 * Manually credits or debits a user's balance. Used to:
 *   - apply the $5 signup credit by hand (before promo-code redemption
 *     ships in a future phase)
 *   - issue goodwill credits after support tickets
 *   - claw back fraudulent invoice credits that the auto-flow caught too
 *     late
 *
 * Audited: every adjustment lands as reason='manual_adjustment' with the
 * admin's user id baked into the note. Idempotency is the caller's job
 * — replays will produce duplicate ledger rows. (We rely on the audit
 * note + recon job to spot dupes.)
 *
 * After the adjust, we re-evaluate the user's thresholds so a top-up
 * fires the resume hook in the same request.
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
  // Defense-in-depth: even with admin credentials, cap rapid-fire
  // adjustments. A compromised admin session can do at most ~10
  // adjustments/minute before getting throttled — gives ops time to
  // notice anomalous logs and revoke.
  const rl = rateLimit(`admin.adjust:${admin.id}`, { rate: 10 / 60, burst: 3 });
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
  const deltaCents = (body as { delta_cents?: unknown }).delta_cents;
  const note = (body as { note?: unknown }).note;
  if (typeof userId !== "number" || !Number.isInteger(userId)) {
    return NextResponse.json({ error: "user_id_required_int" }, { status: 400 });
  }
  if (typeof deltaCents !== "number" || !Number.isInteger(deltaCents)) {
    return NextResponse.json({ error: "delta_cents_required_int" }, { status: 400 });
  }
  if (typeof note !== "string") {
    return NextResponse.json({ error: "note_required" }, { status: 400 });
  }

  // Idempotency-Key (optional but recommended). Scope is per-target so
  // accidental reuse across different users surfaces as a key collision
  // rather than silently returning the wrong user's prior response.
  const idemKey = req.headers.get("idempotency-key");
  const idemScope = `admin.adjust:${userId}`;
  if (idemKey != null) {
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "bad_idempotency_key", message: "8-128 ASCII printable chars" },
        { status: 400 },
      );
    }
    const replay = lookupIdempotent<AdjustResponse>({
      key: idemKey,
      scope: idemScope,
    });
    if (replay) {
      billingLog.info("admin.adjust.idempotency_replay", {
        admin_id: admin.id,
        user_id: userId,
        key: idemKey,
        original_created_at: replay.created_at,
      });
      return NextResponse.json(replay.response, { status: replay.status });
    }
  }

  try {
    const result = adjustBalance({
      admin,
      targetUserId: userId,
      deltaCents,
      note,
    });
    // Re-evaluate so the user's pods resume immediately on a top-up.
    await reevaluateThresholds(userId);
    const responseBody: AdjustResponse = {
      ok: true,
      new_balance_cents: result.newBalanceCents,
      ledger_id: result.ledgerId,
    };
    if (idemKey != null) {
      storeIdempotent({
        key: idemKey,
        scope: idemScope,
        response: responseBody,
        status: 200,
      });
    }
    billingLog.info("admin.adjust.applied", {
      admin_id: admin.id,
      user_id: userId,
      delta_cents: deltaCents,
      new_balance_cents: result.newBalanceCents,
      ledger_id: result.ledgerId,
    });
    return NextResponse.json(responseBody);
  } catch (err) {
    if (err instanceof AdminError) {
      // 4xx errors aren't cached — caller should fix input and retry.
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 400 },
      );
    }
    throw err;
  }
}
