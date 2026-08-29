// GET  /api/pods/[uuid]/persona  → { persona, managed }
// PUT  /api/pods/[uuid]/persona  body { persona }
//
// SOUL.md is purely the user's persona (tone/voice). AGENTS.md is
// platform-owned operating notes — derived from current pod state.
// The Persona tab shows the AGENTS.md preview read-only so the user
// can see what the platform tells the agent without being able to
// edit it through this surface.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import db from "@/lib/db";
import type { PodDomainRow } from "@/lib/db";
import {
  buildAgentsMd,
  composePersona,
  readPersona,
  writePersona,
} from "@/lib/persona";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

function emailAddressFor(podShort: string): string | null {
  const row = db
    .prepare(
      "SELECT slug FROM pod_domains WHERE pod_uuid_short = ? AND kind = 'auto' LIMIT 1",
    )
    .get(podShort) as Pick<PodDomainRow, "slug"> | undefined;
  if (!row) return null;
  const domain = process.env.EMAIL_DOMAIN ?? "inbox.bigcat.pw";
  return `${row.slug}@${domain}`;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });

  const persona = await readPersona(srv.uuid);
  const managed = buildAgentsMd(emailAddressFor(uuid));
  return NextResponse.json({ persona, managed });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { persona?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const persona = typeof body.persona === "string" ? body.persona : "";
  if (persona.length > 32 * 1024) {
    return NextResponse.json(
      { error: "persona too long (max 32 KB)" },
      { status: 413 },
    );
  }

  try {
    await writePersona(srv.uuid, composePersona(persona));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, persona });
}
