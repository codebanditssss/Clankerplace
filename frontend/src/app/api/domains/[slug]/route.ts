// DELETE /api/domains/<slug> — remove a domain mapping (owner-only).
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import db, { type PodDomainRow } from "@/lib/db";
import { removeCaddyDomain } from "@/lib/domains";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const row = db
    .prepare<[string], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE slug = ?",
    )
    .get(slug);
  if (!row)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.user_id !== user.id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    await removeCaddyDomain(slug);
  } catch (err) {
    // Caddy reload failed — leave the DB row in place so the user can
    // retry. Surface the error rather than silently swallowing.
    return NextResponse.json(
      {
        error: `Caddy reload failed: ${err instanceof Error ? err.message : err}`,
      },
      { status: 502 },
    );
  }
  db.prepare("DELETE FROM pod_domains WHERE slug = ?").run(slug);
  return NextResponse.json({ ok: true });
}
