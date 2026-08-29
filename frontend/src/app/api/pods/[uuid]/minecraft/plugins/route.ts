// GET    /api/pods/[uuid]/minecraft/plugins?q=…&mcv=…  — search Modrinth
//                                                         (or list installed
//                                                         if no q + ?installed=1)
// POST   /api/pods/[uuid]/minecraft/plugins  — install { project_id, version_id }
// DELETE /api/pods/[uuid]/minecraft/plugins?file=foo.jar
//
// Plugin JARs are downloaded from Modrinth's CDN by the pod itself
// (curl from inside the container) so the frontend never streams the
// binary. Installed plugins live in /home/container/plugins/*.jar.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { execInPod } from "@/lib/node-exec";
import {
  fetchModrinthVersions,
  pickPrimaryFile,
  searchModrinthPlugins,
} from "@/lib/minecraft";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

async function dockerExec(uuid: string, cmd: string[], timeoutMs = 30000) {
  // node-exec routes to the pod's actual Wings node over the tailnet.
  const { stdout } = await execInPod(uuid, ["exec", uuid, ...cmd], {
    timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const installed = url.searchParams.get("installed") === "1";

  if (installed) {
    // List JARs in /home/container/plugins. Returns just filenames —
    // matching them back to Modrinth projects would need an index we
    // don't keep.
    try {
      const out = await dockerExec(srv.uuid, [
        "bash",
        "-lc",
        "ls -1 /home/container/plugins/*.jar 2>/dev/null | xargs -I{} basename {} || true",
      ]);
      const jars = out
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return NextResponse.json({ installed: jars });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  }

  const q = url.searchParams.get("q") ?? "";
  const mcv = url.searchParams.get("mcv") ?? undefined;
  try {
    const data = await searchModrinthPlugins({
      query: q,
      minecraftVersion: mcv,
      limit: 24,
    });
    return NextResponse.json(data);
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

  let body: { project_id?: string; version_id?: string; mcv?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const projectId = body.project_id?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }

  // Resolve a download URL. If the caller specified a version_id we use
  // that exact build; otherwise we pick the latest version that matches
  // the pod's current MC version.
  let download: { url: string; filename: string } | null = null;
  try {
    const versions = await fetchModrinthVersions(projectId, body.mcv);
    let version = versions[0];
    if (body.version_id) {
      version = versions.find((v) => v.id === body.version_id) ?? version;
    }
    if (!version) {
      return NextResponse.json(
        {
          error: `no compatible version found for project ${projectId}${body.mcv ? ` on MC ${body.mcv}` : ""}`,
        },
        { status: 404 },
      );
    }
    const file = pickPrimaryFile(version);
    if (!file) {
      return NextResponse.json(
        { error: "version has no downloadable file" },
        { status: 500 },
      );
    }
    // Sanitise filename — only allow [A-Za-z0-9._-]
    const safe = file.filename.replace(/[^A-Za-z0-9._-]/g, "_");
    download = { url: file.url, filename: safe };
  } catch (err) {
    return NextResponse.json(
      {
        error: `modrinth lookup failed: ${err instanceof Error ? err.message : err}`,
      },
      { status: 502 },
    );
  }

  // Pod-side download. Modrinth CDN URLs are HTTPS + open.
  try {
    await dockerExec(
      srv.uuid,
      [
        "bash",
        "-lc",
        `mkdir -p /home/container/plugins && curl -fsSL --max-time 120 ${JSON.stringify(download.url)} -o /home/container/plugins/${JSON.stringify(download.filename).slice(1, -1)} && ls -la /home/container/plugins/${JSON.stringify(download.filename).slice(1, -1)}`,
      ],
      120000,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `download failed in pod: ${err instanceof Error ? err.message : err}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, file: download.filename });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const file = (url.searchParams.get("file") ?? "").trim();
  // Allow only basename, no slashes, no traversal.
  if (!/^[A-Za-z0-9._-]+\.jar$/.test(file)) {
    return NextResponse.json({ error: "bad file param" }, { status: 400 });
  }
  try {
    await dockerExec(srv.uuid, [
      "bash",
      "-lc",
      `rm -f /home/container/plugins/${file}`,
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
