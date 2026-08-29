// POST /api/admin/users/[id]/unsuspend

import { NextResponse } from "next/server";
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
  const before = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!before) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  db.prepare(
    `UPDATE users
        SET suspended_at = NULL,
            suspended_reason = NULL
      WHERE id = ?`,
  ).run(userId);
  const after = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "user.unsuspend",
    targetType: "user",
    targetId: userId,
    before: scrubRow(before),
    after: scrubRow(after ?? {}),
    ...meta,
  });
  return NextResponse.json({ ok: true });
}
