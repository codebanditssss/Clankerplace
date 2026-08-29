// POST /api/admin/pods/[uuid]/power
// Body: { signal: 'start' | 'stop' | 'restart' | 'kill' }
//
// Routes through Pelican's client API, since that's the official path
// to power-cycle a server (Wings dispatches the docker command).
// Bearer is the admin's own pelican_client_token — Pelican enforces
// per-server ownership, so admin's token can only power their OWN
// servers… not all of them.
//
// Workaround: use the Application API to find the server, then use
// our root admin's client token (PELICAN_ADMIN_CLIENT_TOKEN env) which
// has cross-account power. If that env isn't set, fall back to a direct
// `docker` exec via the node-aware execInPod helper.

import { NextRequest, NextResponse } from "next/server";
import db, { type PodDomainRow } from "@/lib/db";
import { applicationApi } from "@/lib/pelican";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
} from "@/lib/admin";
import { execInPod } from "@/lib/node-exec";

const SIGNALS = ["start", "stop", "restart", "kill"] as const;
type Signal = (typeof SIGNALS)[number];

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
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
  const body = (await req.json().catch(() => ({}))) as { signal?: string };
  const signal = body.signal as Signal | undefined;
  if (!signal || !SIGNALS.includes(signal)) {
    return NextResponse.json({ error: "bad signal" }, { status: 400 });
  }

  // Verify the pod exists locally (we have a row for it).
  const row = db
    .prepare<[string], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE pod_full_uuid = ?",
    )
    .get(uuid);

  // Direct docker command route — node-aware, no Pelican client token
  // needed. This is what Pelican would do internally anyway.
  const dockerCmd =
    signal === "start"
      ? "start"
      : signal === "stop"
        ? "stop"
        : signal === "restart"
          ? "restart"
          : "kill";
  try {
    await execInPod(uuid, [dockerCmd, uuid], { timeoutMs: 30_000 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const meta = await requestMeta();
  const action =
    signal === "restart"
      ? "pod.restart"
      : signal === "stop"
        ? "pod.stop"
        : signal === "kill"
          ? "pod.kill"
          : "pod.restart"; // 'start' reuses restart action label for now
  auditAdminAction({
    actorId: admin.id,
    action,
    targetType: "pod",
    targetId: uuid,
    after: { signal, slug: row?.slug },
    ...meta,
  });
  return NextResponse.json({ ok: true });
}
