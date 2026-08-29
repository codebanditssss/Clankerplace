import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { execInPod } from "@/lib/node-exec";
import { CONNECTOR_BY_SLUG } from "@/lib/connectors";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

async function dockerExec(
  uuid: string,
  cmd: string[],
  timeoutMs = 8000,
): Promise<string> {
  // node-exec routes to the pod's actual Wings node over the tailnet.
  const { stdout } = await execInPod(uuid, ["exec", uuid, ...cmd], {
    timeoutMs,
    maxBuffer: 1024 * 256,
  });
  return stdout;
}

async function writeEnv(uuid: string, updates: Record<string, string | null>) {
  const current = await dockerExec(uuid, [
    "bash",
    "-lc",
    "cat /home/container/.hermes/.env 2>/dev/null || true",
  ]);
  const map = new Map<string, string>();
  for (const line of current.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    map.set(t.slice(0, eq), t.slice(eq + 1));
  }
  for (const [k, v] of Object.entries(updates)) {
    if (v == null) map.delete(k);
    else map.set(k, v);
  }
  const lines = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`);
  const body = lines.join("\n") + "\n";
  const escaped = body.replace(/'/g, `'\\''`);
  await dockerExec(uuid, [
    "bash",
    "-lc",
    `mkdir -p /home/container/.hermes && printf '%s' '${escaped}' > /home/container/.hermes/.env && chmod 600 /home/container/.hermes/.env`,
  ]);
}

async function restartGateway(uuid: string) {
  // The pod runs a supervisor (`pods-ml-pod-init.sh`) which respawns
  // `hermes gateway run` automatically. We just kill the current gateway
  // process and let the supervisor restart it with the fresh env. Use
  // `pod-gateway` if it exists (newer pods), otherwise fall back to a raw
  // pkill (older pods get the supervisor hot-patched separately).
  await dockerExec(
    uuid,
    [
      "bash",
      "-lc",
      "rm -f /home/container/.hermes/.supervisor-disabled 2>/dev/null; " +
        "pod-gateway restart || true",
    ],
    12000,
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string; platform: string }> },
) {
  const { uuid, platform } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const spec = CONNECTOR_BY_SLUG[platform];
  if (!spec || spec.kind !== "token") {
    return NextResponse.json(
      {
        error: spec
          ? `connector ${platform} (kind=${spec.kind}) cannot be configured via the form — open the pod terminal`
          : "unknown platform",
      },
      { status: 400 },
    );
  }
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1) {
    return NextResponse.json({ error: "pod still installing" }, { status: 409 });
  }

  let body: { fields?: Record<string, string> };
  try {
    body = (await req.json()) as { fields?: Record<string, string> };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const fields = body.fields ?? {};
  const missing = (spec.fields ?? [])
    .filter((f) => !f.optional)
    .filter((f) => !(fields[f.env]?.trim()))
    .map((f) => f.env);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `missing required fields: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  // Build update map: every env var the connector knows about. Empty
  // optional fields get cleared so reconfigure can blank them out.
  const updates: Record<string, string | null> = {};
  for (const f of spec.fields ?? []) {
    const v = fields[f.env]?.trim() ?? "";
    updates[f.env] = v.length > 0 ? v : null;
  }
  // Webhook-mode connectors accept the auto-populated `*_URL` value
  // injected by the client (computed from the pod's auto-domain). The
  // form payload may set it via the spec.webhookUrlEnv slot.
  if (spec.webhookUrlEnv) {
    const url = fields[spec.webhookUrlEnv]?.trim();
    if (url) updates[spec.webhookUrlEnv] = url;
  }
  // Apply the connector's static env values (enable flags, port pins,
  // path pins). These must NOT be user-overridable, so they're applied
  // after the user-field copy and stomp any conflicting entry.
  if (spec.staticEnv) {
    for (const [k, v] of Object.entries(spec.staticEnv)) {
      updates[k] = v;
    }
  }

  try {
    await writeEnv(srv.uuid, updates);
    await restartGateway(srv.uuid);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ uuid: string; platform: string }> },
) {
  const { uuid, platform } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const spec = CONNECTOR_BY_SLUG[platform];
  if (!spec) return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const updates: Record<string, string | null> = {};
    for (const k of spec.env) updates[k] = null;
    if (spec.staticEnv) {
      for (const k of Object.keys(spec.staticEnv)) updates[k] = null;
    }
    await writeEnv(srv.uuid, updates);
    await restartGateway(srv.uuid);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
