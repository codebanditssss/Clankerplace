// GET /api/pods/[uuid]/skills/inspect?category=X&name=Y
//
// Returns the raw SKILL.md body of an installed skill. Used by the
// inspect drawer so users can preview what they have without dropping
// into the console.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { readInstalledSkillBody } from "@/lib/hermes-skills";

const SAFE = /^[a-zA-Z0-9._-]+$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== user.pelicanUserId)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const category = (url.searchParams.get("category") ?? "").trim();
  const name = (url.searchParams.get("name") ?? "").trim();
  if (!SAFE.test(category) || !SAFE.test(name)) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }
  const body = await readInstalledSkillBody(s.uuid, category, name);
  if (body === null)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ body });
}
