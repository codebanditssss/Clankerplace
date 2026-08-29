// POST /api/admin/users/[id]/resend-verification
// Sends a fresh OTP to a user who hasn't completed signup yet (or to a
// user we want to re-verify). For already-verified users the call is a
// no-op with a 400 — verification only applies pre-account.

import { NextResponse } from "next/server";
import db, { type UserRow } from "@/lib/db";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
} from "@/lib/admin";
import { resendSignupOtp } from "@/lib/auth";

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
  const r = await resendSignupOtp(user.email);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "user.resend_verification",
    targetType: "user",
    targetId: userId,
    ...meta,
  });
  return NextResponse.json({ ok: true });
}
