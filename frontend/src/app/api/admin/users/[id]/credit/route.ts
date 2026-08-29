// POST /api/admin/users/[id]/credit
// Body: { amount_cents: number, reason: string }
// Inserts an admin_adjustment row into the Dodo AI-credit wallet. Capped at
// +/-$500 per single grant; larger movements should be split for now.

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { recordCreditAdjustment } from "@/lib/billing/credits";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

const MAX_GRANT_CENTS = 50_000; // $500

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    if (e instanceof NotAdminError) {
      return new NextResponse("not found", { status: 404 });
    }
    throw e;
  }

  const { id } = await ctx.params;
  const userId = parseInt(id, 10);
  const body = (await req.json().catch(() => ({}))) as {
    amount_cents?: number;
    reason?: string;
  };
  const amount = Math.trunc(body.amount_cents ?? 0);
  const reason = body.reason?.trim();
  if (!Number.isInteger(amount) || amount === 0) {
    return NextResponse.json(
      { error: "amount_cents must be a non-zero integer" },
      { status: 400 },
    );
  }
  if (Math.abs(amount) > MAX_GRANT_CENTS) {
    return NextResponse.json(
      {
        error: `single grant capped at $${MAX_GRANT_CENTS / 100}; split into multiple if you need more`,
      },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const user = db
    .prepare<[number], { id: number }>("SELECT id FROM users WHERE id = ?")
    .get(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let adjustment;
  try {
    adjustment = recordCreditAdjustment({
      userId,
      amountCents: amount,
      adminUserId: admin.id,
      reason,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "user.grant_credit",
    targetType: "user",
    targetId: userId,
    after: {
      credit_transaction_id: adjustment.transaction_id,
      delta_cents: amount,
      balance_cents: adjustment.balance_cents,
      reason,
    },
    ...meta,
  });

  return NextResponse.json({
    ok: true,
    credit_transaction_id: adjustment.transaction_id,
    balance_cents: adjustment.balance_cents,
  });
}
