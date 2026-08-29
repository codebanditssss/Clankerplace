// POST /api/admin/users/[id]/role
// Body: { role: 'user' | 'admin' | 'support' | 'finance' }
// Updates the user's role AND keeps is_admin in sync for backcompat.

import { NextRequest, NextResponse } from "next/server";
import db, { type UserRow } from "@/lib/db";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
  scrubRow,
} from "@/lib/admin";

const ROLES = new Set(["user", "admin", "support", "finance"]);

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
  if (userId === admin.id) {
    return NextResponse.json(
      { error: "you cannot change your own role" },
      { status: 400 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { role?: string };
  const role = (body.role ?? "").trim();
  if (!ROLES.has(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  const before = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!before) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const isAdmin = role === "admin" ? 1 : 0;
  db.prepare("UPDATE users SET role = ?, is_admin = ? WHERE id = ?").run(
    role,
    isAdmin,
    userId,
  );
  const after = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "user.promote_role",
    targetType: "user",
    targetId: userId,
    before: scrubRow(before),
    after: scrubRow(after ?? {}),
    ...meta,
  });
  return NextResponse.json({ ok: true });
}
