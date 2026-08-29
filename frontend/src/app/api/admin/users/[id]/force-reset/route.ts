// POST /api/admin/users/[id]/force-reset
// Triggers the existing password-reset flow for the target user. They
// receive an OTP email; they can use it from any device to set a new
// password. We DON'T pre-mark the user as needing-reset — they keep
// their current password until they actually complete the reset.

import { NextResponse } from "next/server";
import db, { type UserRow } from "@/lib/db";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
} from "@/lib/admin";
import { requestPasswordReset } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
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
  const user = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  // OAuth-only or wallet-only accounts don't have a password to reset.
  if (
    user.password_hash.startsWith("$oauth$") ||
    user.password_hash === "$wallet$solana"
  ) {
    return NextResponse.json(
      { error: "this account doesn't use a password (OAuth/wallet only)" },
      { status: 400 },
    );
  }
  await requestPasswordReset(user.email);
  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "user.force_password_reset",
    targetType: "user",
    targetId: userId,
    ...meta,
  });
  return NextResponse.json({ ok: true });
}
