// POST /api/admin/users/[id]/migrate-wallet
// Support recovery for legacy wallet-only users who already signed out after
// wallet sign-in was retired. Converts the local account to email/password
// auth with an unknown random password, then sends the normal reset OTP.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import db, { type UserRow } from "@/lib/db";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
} from "@/lib/admin";
import { isWalletSyntheticEmail, requestPasswordReset } from "@/lib/auth";
import { normalizeEmail, validateEmail } from "@/lib/validation";

export const dynamic = "force-dynamic";

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
  let body: { email?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const emailRaw = typeof body.email === "string" ? body.email : "";
  const emailErr = validateEmail(emailRaw);
  if (emailErr) return NextResponse.json({ error: emailErr }, { status: 400 });
  const email = normalizeEmail(emailRaw);
  if (isWalletSyntheticEmail(email)) {
    return NextResponse.json(
      { error: "enter a deliverable email address" },
      { status: 400 },
    );
  }

  const user = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  if (user.password_hash !== "$wallet$solana" || !isWalletSyntheticEmail(user.email)) {
    return NextResponse.json(
      { error: "user is not a legacy wallet-only account" },
      { status: 400 },
    );
  }

  const existing = db
    .prepare<[string, number], UserRow>(
      "SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?",
    )
    .get(email, userId);
  if (existing) {
    return NextResponse.json({ error: "email already registered" }, { status: 409 });
  }

  const randomPassword = randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(randomPassword, 10);
  const updated = db.transaction(() => {
    const info = db.prepare(
      `UPDATE users
          SET email = ?,
              password_hash = ?,
              email_verified_at = datetime('now')
        WHERE id = ?
          AND password_hash = '$wallet$solana'`,
    ).run(email, passwordHash, userId);
    db.prepare(
      "DELETE FROM account_email_login_migrations WHERE user_id = ?",
    ).run(userId);
    return info;
  })();
  if (updated.changes !== 1) {
    return NextResponse.json({ error: "account migration failed" }, { status: 409 });
  }

  await requestPasswordReset(email);
  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "user.migrate_legacy_wallet",
    targetType: "user",
    targetId: userId,
    before: { email: user.email, auth: "wallet" },
    after: { email, auth: "email_password_reset_sent" },
    ...meta,
  });

  return NextResponse.json({ ok: true });
}
