import { NextResponse } from "next/server";
import { getCurrentUser, getPelicanClientToken } from "@/lib/auth";

const PANEL_URL = process.env.PELICAN_URL ?? "";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const clientToken = getPelicanClientToken(user.id);
  if (!clientToken) {
    return NextResponse.json(
      { error: "no client token on file for this user" },
      { status: 500 },
    );
  }

  const res = await fetch(
    `${PANEL_URL}/api/client/servers/${encodeURIComponent(uuid)}/websocket`,
    {
      headers: {
        Authorization: `Bearer ${clientToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    return NextResponse.json(
      { error: `panel ${res.status}: ${txt.slice(0, 200)}` },
      { status: 502 },
    );
  }
  const data = (await res.json()) as {
    data: { token: string; socket: string };
  };
  return NextResponse.json({
    token: data.data.token,
    socket: data.data.socket,
  });
}
