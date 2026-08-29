// GET  /api/pods/<uuid>/domains  — list the domains attached to this pod
// POST /api/pods/<uuid>/domains  — add a new domain to this pod
//
// Same shape as the cross-pod /api/domains POST but scoped to a single
// pod's UUID (which is also the URL param — so the caller can't attach
// a domain to someone else's pod even if they alias the body).
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import db, { type PodDomainRow } from "@/lib/db";
import { DOMAIN_ROOT, SLUG_RE, fullDomain } from "@/lib/domains";
import { createDomainForPod } from "../../../domains/route";

const DEFAULT_PORT = 8080;

async function getServer(uuidShort: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuidShort)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = db
    .prepare<[string, number], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE pod_uuid_short = ? AND user_id = ? ORDER BY created_at",
    )
    .all(uuid, user.id);
  return NextResponse.json({
    domain_root: DOMAIN_ROOT,
    domains: rows.map((r) => ({ ...r, url: `https://${fullDomain(r.slug)}` })),
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1) {
    return NextResponse.json({ error: "pod still installing" }, { status: 409 });
  }

  let body: { port?: number; slug?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const port = body.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: "port must be 1-65535" }, { status: 400 });
  }
  if (body.slug && !SLUG_RE.test(body.slug.trim().toLowerCase())) {
    return NextResponse.json({ error: "slug shape invalid" }, { status: 400 });
  }

  // One-domain-per-port-per-pod. Reject explicitly here so the UI
  // can show a clear "this port already has a domain" message
  // instead of a generic 502 with SQLite UNIQUE-constraint text.
  const existing = db
    .prepare<[string, number], { slug: string }>(
      "SELECT slug FROM pod_domains WHERE pod_uuid_short = ? AND port = ?",
    )
    .get(uuid, port);
  if (existing) {
    return NextResponse.json(
      {
        error: `port ${port} on this pod is already mapped to ${existing.slug}.${DOMAIN_ROOT} — delete that one first or pick a different port`,
      },
      { status: 409 },
    );
  }

  try {
    const out = await createDomainForPod({
      podShort: uuid,
      podFullUuid: srv.uuid,
      port,
      userId: user.id,
      kind: "manual",
      slug: body.slug?.trim().toLowerCase(),
    });
    return NextResponse.json({
      ok: true,
      ...out,
      url: `https://${fullDomain(out.slug)}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
