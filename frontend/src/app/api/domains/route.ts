// GET  /api/domains            — list domains the current user owns (cross-pod)
// POST /api/domains            — create a domain for one of the user's pods
//
// Body for POST: { pod_uuid: string, port?: number, slug?: string }
//   - pod_uuid: short or full UUID
//   - port:    1-65535, defaults to 8080
//   - slug:    optional; auto-generated if missing
//
// On create: insert DB row → call sudo helper to write Caddy include +
// reload Caddy. On Caddy failure we roll back the DB row.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import db, { type PodDomainRow } from "@/lib/db";
import {
  DOMAIN_ROOT,
  SLUG_RE,
  fullDomain,
  generateUniqueSlug,
  getContainerIp,
  addCaddyDomain,
  addCaddyDomainMulti,
  removeCaddyDomain,
} from "@/lib/domains";

export const dynamic = "force-dynamic";

const DEFAULT_PORT = 8080;

async function getServerByShort(uuidShort: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuidShort)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const rows = db
    .prepare<[number], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(user.id);

  return NextResponse.json({
    domain_root: DOMAIN_ROOT,
    domains: rows.map((r) => ({
      ...r,
      url: `https://${fullDomain(r.slug)}`,
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: { pod_uuid?: string; port?: number; slug?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const podUuidIn = (body.pod_uuid ?? "").trim();
  if (!podUuidIn) {
    return NextResponse.json({ error: "pod_uuid required" }, { status: 400 });
  }
  const uuidShort = podUuidIn.slice(0, 8);
  const srv = await getServerByShort(uuidShort, user.pelicanUserId);
  if (!srv)
    return NextResponse.json({ error: "pod not found" }, { status: 404 });
  if (srv.container.installed !== 1) {
    return NextResponse.json({ error: "pod still installing" }, { status: 409 });
  }

  const port = body.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: "port must be 1-65535" }, { status: 400 });
  }

  // Pick a slug — caller's or generated. Retry on collision.
  let slug: string | null = null;
  if (body.slug) {
    const candidate = body.slug.trim().toLowerCase();
    if (!SLUG_RE.test(candidate)) {
      return NextResponse.json(
        { error: "slug must match ^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$" },
        { status: 400 },
      );
    }
    slug = candidate;
  } else {
    try {
      slug = generateUniqueSlug(
        (c) =>
          db.prepare("SELECT 1 FROM pod_domains WHERE slug = ?").get(c) !==
          undefined,
      );
    } catch {
      return NextResponse.json(
        { error: "failed to allocate a unique slug — try again" },
        { status: 503 },
      );
    }
  }

  // One-domain-per-port-per-pod.
  const taken = db
    .prepare<[string, number], { slug: string }>(
      "SELECT slug FROM pod_domains WHERE pod_uuid_short = ? AND port = ?",
    )
    .get(uuidShort, port);
  if (taken) {
    return NextResponse.json(
      {
        error: `port ${port} on this pod already maps to ${taken.slug}.${DOMAIN_ROOT} — remove that mapping or pick a different port`,
      },
      { status: 409 },
    );
  }

  const containerIp = await getContainerIp(srv.uuid);
  if (!containerIp) {
    return NextResponse.json(
      { error: "could not resolve container IP — is the pod running?" },
      { status: 409 },
    );
  }

  // DB insert first. If Caddy fails after, we delete the row + report.
  let insertedId: number;
  try {
    const r = db
      .prepare(
        `INSERT INTO pod_domains
         (slug, pod_uuid_short, pod_full_uuid, port, user_id, container_ip, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        slug,
        uuidShort,
        srv.uuid,
        port,
        user.id,
        containerIp,
        body.slug ? "manual" : "manual",
      );
    insertedId = Number(r.lastInsertRowid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "slug already taken" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  try {
    // User-added domains stay single-port — the user picked the port
    // explicitly. The path-routed multi-include is reserved for the
    // auto-domain created on deploy.
    await addCaddyDomain(slug, srv.uuid, containerIp, port);
  } catch (err) {
    db.prepare("DELETE FROM pod_domains WHERE id = ?").run(insertedId);
    return NextResponse.json(
      {
        error: `Caddy refused mapping: ${err instanceof Error ? err.message : err}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: insertedId,
    slug,
    url: `https://${fullDomain(slug)}`,
    pod_uuid_short: uuidShort,
    port,
  });
}

// Helper exported for the per-pod route + the auto-on-deploy path.
// Insert + Caddy sync in one call. Returns the inserted row.
export async function createDomainForPod(opts: {
  podShort: string;
  podFullUuid: string;
  port: number;
  userId: number;
  kind?: "auto" | "manual";
  slug?: string;
  /**
   * For auto-domains only: when true, reverse-proxy the subdomain root
   * straight to `port` (single-port include) instead of the Hermes
   * path-routed multi-include. Non-Hermes HTTP pods (n8n → :5678,
   * code-sandbox → :8080) are single web apps and need this, otherwise
   * their root lands on Hermes's hardcoded :8080 target and 404s.
   */
  autoSinglePort?: boolean;
}) {
  const { podShort, podFullUuid, port, userId, kind = "manual" } = opts;

  // Skip-if-exists for the auto-domain on-deploy path. Because the
  // auto-domain doesn't bind to a specific port (it path-routes to all
  // Hermes webhook ports), we look it up by (pod, kind=auto) instead of
  // (pod, port). Manual domains stay port-keyed to preserve the
  // one-port-per-pod UNIQUE invariant.
  const existing =
    kind === "auto"
      ? db
          .prepare<[string], PodDomainRow>(
            "SELECT * FROM pod_domains WHERE pod_uuid_short = ? AND kind = 'auto' LIMIT 1",
          )
          .get(podShort)
      : db
          .prepare<[string, number], PodDomainRow>(
            "SELECT * FROM pod_domains WHERE pod_uuid_short = ? AND port = ?",
          )
          .get(podShort, port);
  if (existing) {
    return {
      id: existing.id,
      slug: existing.slug,
      ip: existing.container_ip,
      port: existing.port,
    };
  }

  let slug: string | null = opts.slug ?? null;
  if (!slug) {
    slug = generateUniqueSlug(
      (c) =>
        db.prepare("SELECT 1 FROM pod_domains WHERE slug = ?").get(c) !==
        undefined,
    );
  }
  const ip = await getContainerIp(podFullUuid);
  if (!ip) throw new Error("container IP unresolved");
  const r = db
    .prepare(
      `INSERT INTO pod_domains
       (slug, pod_uuid_short, pod_full_uuid, port, user_id, container_ip, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(slug, podShort, podFullUuid, port, userId, ip, kind);
  try {
    if (kind === "auto" && !opts.autoSinglePort) {
      // Hermes auto-domains get the path-routed include covering every
      // Hermes webhook port. The stored `port` column is informational
      // only — Caddy fans out by path, not by a single backend port.
      await addCaddyDomainMulti(slug, podFullUuid, ip);
    } else {
      // Single-port: manual domains AND non-Hermes auto-domains. The
      // subdomain root reverse-proxies straight to `port`.
      await addCaddyDomain(slug, podFullUuid, ip, port);
    }
  } catch (err) {
    db.prepare("DELETE FROM pod_domains WHERE id = ?").run(r.lastInsertRowid);
    throw err;
  }
  return { id: Number(r.lastInsertRowid), slug, ip, port };
}

// Delete-and-uninstall — exported for the [slug] DELETE route.
export async function destroyDomain(slug: string): Promise<void> {
  await removeCaddyDomain(slug);
  db.prepare("DELETE FROM pod_domains WHERE slug = ?").run(slug);
}
