// GET /api/pods/[uuid]/allocation — returns the pod's primary public
// host:port allocation from Pelican. Used by the Minecraft dashboard
// card (and any future TCP pod type) to show "how to connect".
import { NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type AllocationAttrs = {
  id: number;
  ip: string;
  port: number;
  alias: string | null;
};

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
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

  // Fetch the server's allocations + the node's public address. Wings
  // binds allocations to 0.0.0.0; the user-facing IP is the node's FQDN.
  try {
    const data = await applicationApi<{
      attributes: ServerAttributes & {
        relationships?: {
          allocations?: { data?: Array<{ attributes: AllocationAttrs }> };
        };
      };
    }>(`/servers/${srv.id}?include=allocations`);
    const allocs =
      data.attributes.relationships?.allocations?.data
        ?.map((a) => a.attributes)
        .filter(Boolean) ?? [];
    const primary =
      allocs.find((a) => a.id === srv.allocation) ?? allocs[0] ?? null;

    // Public hostname — prefer the env-configured one over the raw IP
    // (which would be 0.0.0.0).
    const publicHost =
      process.env.PODS_PUBLIC_HOST ??
      process.env.APP_HOST ??
      new URL(process.env.PELICAN_URL ?? "https://localhost").hostname;

    return NextResponse.json({
      host: publicHost,
      port: primary?.port ?? null,
      ip: primary?.ip ?? null,
      alias: primary?.alias ?? null,
      connect: primary?.port ? `${publicHost}:${primary.port}` : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
