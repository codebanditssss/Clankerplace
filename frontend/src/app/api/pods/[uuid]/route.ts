// DELETE /api/pods/<uuid>
//
// Permanently deletes the pod: the running container, its bind-mounted
// volume at /srv/pods/wings/volumes/<full-uuid>/, the Pelican server
// record, and the allocation slot. No recovery — make sure the UI
// gates this with a "type the pod name to confirm" dialog.
//
// Uses the Application API (admin) because the Client API doesn't
// expose `DELETE /servers/<id>` for ordinary users; only the admin
// path can force-purge a server and its volume.
import { NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import db, { type PodDomainRow } from "@/lib/db";
import { removeCaddyDomain } from "@/lib/domains";
import { setMeterStateState } from "@/lib/billing/meter";
import { releaseFreePodSlot } from "@/lib/billing/cohort";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Billing: mark the meter row deleted FIRST so a concurrent meter tick
  // can't bill for the seconds between the Pelican DELETE and our own
  // bookkeeping update. (The tick only debits 'running' rows; once we
  // flip to 'deleted' nothing further accrues.)
  try {
    setMeterStateState(uuid, "deleted");
  } catch (err) {
    console.warn(
      `[delete] meter-state update failed for ${uuid}: ${err instanceof Error ? err.message : err}`,
    );
  }

  try {
    // force=true so Wings tears down even if the container is in a
    // weird state (e.g. starting/stopping). Without force, a stuck
    // pod can refuse deletion.
    await applicationApi(`/servers/${srv.id}?force=true`, {
      method: "DELETE",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Free the cohort slot if this was the user's claimed free pod, so
  // their next deploy can pick up the free seat again. No-op for PAYG
  // pods or for pods that weren't the claimed one. Idempotent.
  try {
    releaseFreePodSlot(user.id, uuid);
  } catch (err) {
    console.warn(
      `[delete] cohort slot release failed for ${uuid}: ${err instanceof Error ? err.message : err}`,
    );
  }

  // Best-effort: tear down every domain that pointed at this pod. Caddy
  // would otherwise keep serving a 502 forever; the Caddy include file
  // would also reference a stale container IP. Errors here don't fail
  // the request — the pod is already gone.
  const slugs = (
    db
      .prepare<[string], Pick<PodDomainRow, "slug">>(
        "SELECT slug FROM pod_domains WHERE pod_uuid_short = ?",
      )
      .all(uuid) as Pick<PodDomainRow, "slug">[]
  ).map((r) => r.slug);
  for (const slug of slugs) {
    try {
      await removeCaddyDomain(slug);
    } catch {}
    try {
      db.prepare("DELETE FROM pod_domains WHERE slug = ?").run(slug);
    } catch {}
  }

  return NextResponse.json({ ok: true });
}
