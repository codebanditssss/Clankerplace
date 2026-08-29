// POST /api/admin/users/[id]/revoke-sessions
// Bumps users.session_min_iat to now() so every active session cookie
// for this user becomes invalid on its next request. Idempotent.

import { NextResponse } from "next/server";
import db from "@/lib/db";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
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
  const user = db
    .prepare<[number], { id: number }>("SELECT id FROM users WHERE id = ?")
    .get(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const ts = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE users SET session_min_iat = ? WHERE id = ?").run(ts, userId);
  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "user.revoke_sessions",
    targetType: "user",
    targetId: userId,
    after: { session_min_iat: ts },
    ...meta,
  });
  return NextResponse.json({ ok: true });
}
