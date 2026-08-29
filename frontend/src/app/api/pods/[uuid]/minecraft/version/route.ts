// GET  /api/pods/[uuid]/minecraft/version   — current MC version + full
//                                              upstream version list
// POST /api/pods/[uuid]/minecraft/version   — switch to { version: "1.21.x" }
//
// Switching triggers a Pelican server reinstall, which re-runs the
// Paper egg's install script with the new MINECRAFT_VERSION env. The
// jar is re-downloaded from Paper's Fill API. Player worlds + plugins
// in /home/container survive — Pelican only re-runs the install
// step, it doesn't wipe the volume.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { listPaperVersions } from "@/lib/minecraft";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
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

  let versions: string[] = [];
  try {
    versions = await listPaperVersions();
  } catch (err) {
    console.warn(
      `[minecraft/version] paper API failed: ${err instanceof Error ? err.message : err}`,
    );
  }
  return NextResponse.json({
    current: srv.container.environment.MINECRAFT_VERSION ?? "latest",
    versions,
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

  let body: { version?: string };
  try {
    body = (await req.json()) as { version?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const version = (body.version ?? "").trim();
  if (!/^(latest|\d+(\.\d+){1,3}(-[a-z0-9]+)?)$/.test(version)) {
    return NextResponse.json(
      { error: `bad version: ${version}` },
      { status: 400 },
    );
  }

  // Update the env var via Pelican's startup PATCH endpoint.
  try {
    const newEnv: Record<string, string> = {
      ...srv.container.environment,
      MINECRAFT_VERSION: version,
    };
    await applicationApi(`/servers/${srv.id}/startup`, {
      method: "PATCH",
      body: {
        startup: srv.container.startup_command,
        environment: newEnv,
        egg: srv.egg,
        image: srv.container.image,
        skip_scripts: false,
      },
    });
    // Trigger reinstall — re-runs the install script with the new
    // MINECRAFT_VERSION, which re-downloads the matching Paper jar.
    await applicationApi(`/servers/${srv.id}/reinstall`, { method: "POST" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, switching_to: version });
}
