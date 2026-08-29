// Readers for /admin/pods. We blend two sources:
//   - pod_domains (local source of truth for slug, owner, IP, custom
//     domain, kind=auto/manual, created_at)
//   - Pelican /servers list (Wings status, egg id, node id, container
//     installed flag, suspended flag)
//
// Joined by pod_full_uuid (Pelican's `uuid`) — short uuid prefix joins
// also work because the first 8 chars of uuid_short equal uuid[0..7].
//
// Pelican is the slower side (~50-200ms HTTP), so we fetch it once and
// cache for the request lifetime via React's request-scoped cache —
// `unstable_cache` isn't needed at our scale.

import "server-only";
import db, { type PodDomainRow } from "@/lib/db";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";

export type AdminPodListItem = {
  // local
  id: number;
  slug: string;
  pod_full_uuid: string;
  pod_uuid_short: string;
  port: number;
  kind: "auto" | "manual";
  user_id: number;
  user_email: string | null;
  container_ip: string | null;
  created_at: string;
  // pelican-side
  pelican_id: number | null;
  pelican_name: string | null;
  pelican_node: number | null;
  pelican_egg: number | null;
  pelican_image: string | null;
  pelican_installed: boolean;
  pelican_suspended: boolean;
};

async function listPelicanServers(): Promise<Map<string, ServerAttributes>> {
  // Pelican accepts per_page up to a few hundred.
  const data = await applicationApi<{
    data: { attributes: ServerAttributes }[];
  }>(`/servers?per_page=500`);
  const m = new Map<string, ServerAttributes>();
  for (const s of data.data) {
    m.set(s.attributes.uuid, s.attributes);
  }
  return m;
}

export async function listAdminPods(opts: {
  q?: string;
  node?: number;
  kind?: "all" | "auto" | "manual";
  page?: number;
  pageSize?: number;
}): Promise<{ rows: AdminPodListItem[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;

  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (opts.q) {
    filters.push(
      "(p.slug LIKE ? OR p.pod_full_uuid LIKE ? OR p.pod_uuid_short LIKE ? OR LOWER(u.email) LIKE LOWER(?))",
    );
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  if (opts.kind && opts.kind !== "all") {
    filters.push("p.kind = ?");
    params.push(opts.kind);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const rows = db
    .prepare<unknown[], PodDomainRow & { user_email: string | null }>(
      `SELECT p.*, u.email AS user_email
         FROM pod_domains p
         LEFT JOIN users u ON u.id = p.user_id
         ${where}
         ORDER BY p.id DESC
         LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset);

  const totalRow = db
    .prepare<unknown[], { c: number }>(
      `SELECT COUNT(*) c FROM pod_domains p LEFT JOIN users u ON u.id = p.user_id ${where}`,
    )
    .get(...params);

  let pelican: Map<string, ServerAttributes>;
  try {
    pelican = await listPelicanServers();
  } catch (err) {
    console.warn("[admin-pods] pelican unavailable", err);
    pelican = new Map();
  }

  const merged: AdminPodListItem[] = rows
    .map((p) => {
      const pel = pelican.get(p.pod_full_uuid);
      return {
        id: p.id,
        slug: p.slug,
        pod_full_uuid: p.pod_full_uuid,
        pod_uuid_short: p.pod_uuid_short,
        port: p.port,
        kind: p.kind,
        user_id: p.user_id,
        user_email: p.user_email,
        container_ip: p.container_ip,
        created_at: p.created_at,
        pelican_id: pel?.id ?? null,
        pelican_name: pel?.name ?? null,
        pelican_node: pel?.node ?? null,
        pelican_egg: pel?.egg ?? null,
        pelican_image: pel?.container.image ?? null,
        pelican_installed: pel?.container.installed === 1,
        pelican_suspended: !!pel?.suspended,
      };
    })
    .filter((p) => {
      if (opts.node != null && p.pelican_node !== opts.node) return false;
      return true;
    });

  return { rows: merged, total: totalRow?.c ?? 0 };
}

export async function getAdminPodDetail(podFullUuid: string): Promise<{
  domain: (PodDomainRow & { user_email: string | null }) | null;
  pelican: ServerAttributes | null;
} | null> {
  const domain = db
    .prepare<[string], PodDomainRow & { user_email: string | null }>(
      `SELECT p.*, u.email AS user_email
         FROM pod_domains p
         LEFT JOIN users u ON u.id = p.user_id
        WHERE p.pod_full_uuid = ?
        LIMIT 1`,
    )
    .get(podFullUuid);
  let pelican: ServerAttributes | null = null;
  try {
    const r = await applicationApi<{
      data: { attributes: ServerAttributes }[];
    }>(`/servers?filter[uuid]=${encodeURIComponent(podFullUuid)}&per_page=1`);
    pelican = r.data[0]?.attributes ?? null;
  } catch {
    // ignore — show local-only view
  }
  if (!domain && !pelican) return null;
  return { domain: domain ?? null, pelican };
}
