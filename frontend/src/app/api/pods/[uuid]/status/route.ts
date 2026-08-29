import { NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  try {
    const data = await applicationApi<{
      data: Array<{ attributes: ServerAttributes }>;
    }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
    const server = data.data?.[0]?.attributes;
    if (!server || server.user !== user.pelicanUserId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({
      installed: server.container.installed === 1,
      status: server.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
