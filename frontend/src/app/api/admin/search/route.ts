// Global search for the admin Cmd+K palette. One trip — returns the
// top matches across users (by email) and pods (by uuid or slug). Each
// kind is capped at 6 to keep the list scannable.

import { NextRequest, NextResponse } from "next/server";
import { NotAdminError, requireAdmin } from "@/lib/admin";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

type UserHit = {
  kind: "user";
  id: number;
  email: string;
  suspended_at: string | null;
};
type PodHit = {
  kind: "pod";
  uuid: string;
  slug: string | null;
  owner_email: string | null;
};
type Hit = UserHit | PodHit;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof NotAdminError) {
      return new NextResponse("not found", { status: 404 });
    }
    throw e;
  }
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const like = `%${q}%`;

  const users = db
    .prepare<[string, number], UserHit>(
      `SELECT 'user' AS kind, id, email, suspended_at
         FROM users
        WHERE LOWER(email) LIKE LOWER(?)
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(like, 6);

  const pods = db
    .prepare<[string, string, string, number], PodHit>(
      `SELECT 'pod' AS kind,
              p.pod_full_uuid AS uuid,
              p.slug AS slug,
              u.email AS owner_email
         FROM pod_domains p
         LEFT JOIN users u ON u.id = p.user_id
        WHERE p.pod_full_uuid LIKE ?
           OR p.pod_uuid_short LIKE ?
           OR p.slug LIKE ?
        ORDER BY p.id DESC
        LIMIT ?`,
    )
    .all(like, like, like, 6);

  const hits: Hit[] = [...users, ...pods];
  return NextResponse.json({ hits });
}
