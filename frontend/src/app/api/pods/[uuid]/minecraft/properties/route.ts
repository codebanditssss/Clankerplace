// GET  /api/pods/[uuid]/minecraft/properties  — read + parse server.properties
// POST /api/pods/[uuid]/minecraft/properties  — body: { changes: {key:value} }
//                                               merges into the existing file
//
// Persists to /home/container/server.properties via docker exec. The
// reverse side normalises booleans + numbers to strings.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { execInPod, execInPodStdin } from "@/lib/node-exec";
import { parseProps, serialiseProps } from "@/lib/minecraft-properties";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

async function dockerCat(uuid: string, path: string): Promise<string> {
  // node-exec routes to the pod's actual Wings node over the tailnet.
  const { stdout } = await execInPod(
    uuid,
    [
      "exec",
      uuid,
      "bash",
      "-lc",
      `cat ${JSON.stringify(path).slice(1, -1)} 2>/dev/null || true`,
    ],
    { timeoutMs: 8000, maxBuffer: 1024 * 1024 },
  );
  return stdout;
}

async function dockerWriteFile(
  uuid: string,
  path: string,
  body: string,
): Promise<void> {
  await execInPodStdin(
    uuid,
    [
      "exec",
      "-i",
      uuid,
      "bash",
      "-lc",
      `cat > ${JSON.stringify(path).slice(1, -1)} && chmod 644 ${JSON.stringify(path).slice(1, -1)}`,
    ],
    body,
  );
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
  try {
    const raw = await dockerCat(srv.uuid, "/home/container/server.properties");
    return NextResponse.json({
      raw,
      props: parseProps(raw),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
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
  let body: { changes?: Record<string, string> };
  try {
    body = (await req.json()) as { changes?: Record<string, string> };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const changes = body.changes ?? {};
  // Validate keys: server.properties allows [a-z0-9_\-\.] in keys.
  for (const k of Object.keys(changes)) {
    if (!/^[a-z0-9_\-\.]{1,64}$/i.test(k)) {
      return NextResponse.json(
        { error: `bad property key: ${k}` },
        { status: 400 },
      );
    }
    // Values must not contain newlines or carriage returns.
    if (/[\r\n]/.test(changes[k] ?? "")) {
      return NextResponse.json(
        { error: `value for ${k} contains newline` },
        { status: 400 },
      );
    }
  }
  try {
    const prev = await dockerCat(srv.uuid, "/home/container/server.properties");
    const existing = parseProps(prev);
    const merged: Record<string, string> = { ...existing, ...changes };
    const next = serialiseProps(merged, prev);
    await dockerWriteFile(srv.uuid, "/home/container/server.properties", next);
    return NextResponse.json({
      ok: true,
      changed: Object.keys(changes).length,
      restart_required: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
