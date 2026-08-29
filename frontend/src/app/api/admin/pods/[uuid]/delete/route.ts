// POST /api/admin/pods/[uuid]/delete
//
// Tears down a pod:
//   1. Remove all Caddy includes (both nodes via removeCaddyDomain)
//   2. DELETE the Pelican server (force-delete if a graceful delete fails)
//   3. Delete pod_domains row(s)
//   4. Wipe pod_meter_state if present
//
// Pod-side data (volumes etc) goes when Pelican wipes the container.

import { NextResponse } from "next/server";
import db, { type PodDomainRow } from "@/lib/db";
import { applicationApi, PelicanApiError } from "@/lib/pelican";
import { removeCaddyDomain } from "@/lib/domains";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
  scrubRow,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

type ServerRef = { id: number; uuid: string };

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ uuid: string }> },
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
  const { uuid } = await ctx.params;
  const podDomains = db
    .prepare<[string], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE pod_full_uuid = ?",
    )
    .all(uuid);

  // Look up Pelican server id for the deletion call.
  let pelican: ServerRef | null = null;
  try {
    const r = await applicationApi<{
      data: { attributes: ServerRef }[];
    }>(`/servers?filter[uuid]=${encodeURIComponent(uuid)}&per_page=1`);
    pelican = r.data[0]?.attributes ?? null;
  } catch (err) {
    console.warn("[admin] pelican lookup before delete failed", err);
  }

  // 1. Caddy first — slugs hold cross-node state, easier to roll forward.
  for (const d of podDomains) {
    try {
      await removeCaddyDomain(d.slug);
    } catch (err) {
      console.warn(`[admin] caddy remove failed for ${d.slug}`, err);
    }
  }

  // 2. Pelican delete — try graceful first, then force.
  if (pelican) {
    try {
      await applicationApi(`/servers/${pelican.id}`, { method: "DELETE" });
    } catch (err) {
      if (err instanceof PelicanApiError && err.status >= 400) {
        try {
          await applicationApi(`/servers/${pelican.id}/force`, {
            method: "DELETE",
          });
        } catch (err2) {
          console.warn("[admin] pelican force-delete failed", err2);
        }
      }
    }
  }

  // 3. Local cleanup.
  for (const d of podDomains) {
    db.prepare("DELETE FROM pod_domains WHERE id = ?").run(d.id);
  }
  try {
    db.prepare("DELETE FROM pod_meter_state WHERE pod_full_uuid = ?").run(uuid);
  } catch {
    // table may not be present on legacy DBs
  }

  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "pod.delete",
    targetType: "pod",
    targetId: uuid,
    before: podDomains.map(scrubRow),
    after: { pelican_id: pelican?.id ?? null },
    ...meta,
  });
  return NextResponse.json({ ok: true });
}
