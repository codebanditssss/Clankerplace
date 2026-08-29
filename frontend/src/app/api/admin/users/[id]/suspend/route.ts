// POST /api/admin/users/[id]/suspend
// Body: { reason: string }
// Sets users.suspended_at = now() + suspended_reason. Audit-logged with
// before/after JSON.

import { NextRequest, NextResponse } from "next/server";
import db, { type UserRow } from "@/lib/db";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
  scrubRow,
} from "@/lib/admin";

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
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "bad user id" }, { status: 400 });
  }
  if (userId === admin.id) {
    return NextResponse.json({ error: "cannot suspend yourself" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = body.reason?.trim();
  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }
  const before = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!before) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  db.prepare(
    `UPDATE users
        SET suspended_at = datetime('now'),
            suspended_reason = ?
      WHERE id = ?`,
  ).run(reason, userId);
  const after = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "user.suspend",
    targetType: "user",
    targetId: userId,
    before: scrubRow(before),
    after: scrubRow(after ?? {}),
    ...meta,
  });
  return NextResponse.json({ ok: true });
}
