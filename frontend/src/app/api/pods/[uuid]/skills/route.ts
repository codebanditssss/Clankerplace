// GET    /api/pods/[uuid]/skills            → installed skills
// POST   /api/pods/[uuid]/skills            { identifier } → install
// DELETE /api/pods/[uuid]/skills?name=…     → uninstall
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import {
  CustomSkillConflictError,
  CustomSkillValidationError,
  createCustomSkill,
  installSkill,
  listInstalled,
  uninstallSkill,
} from "@/lib/hermes-skills";

async function authPod(uuid: string) {
  const user = await getCurrentUser();
  if (!user) return { err: "not signed in", status: 401 as const };
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== user.pelicanUserId)
    return { err: "not found", status: 404 as const };
  return { srv: s };
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const a = await authPod(uuid);
  if ("err" in a) return NextResponse.json({ error: a.err }, { status: a.status });
  const skills = await listInstalled(a.srv.uuid);
  return NextResponse.json({ skills });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const a = await authPod(uuid);
  if ("err" in a) return NextResponse.json({ error: a.err }, { status: a.status });
  let body: {
    identifier?: unknown;
    custom?: {
      name?: unknown;
      description?: unknown;
      instructions?: unknown;
      tags?: unknown;
    };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (body.custom && typeof body.custom === "object") {
    const tags = Array.isArray(body.custom.tags)
      ? body.custom.tags
          .map((tag) => (typeof tag === "string" ? tag : ""))
          .filter(Boolean)
      : [];
    try {
      await createCustomSkill(a.srv.uuid, {
        name: typeof body.custom.name === "string" ? body.custom.name : "",
        description:
          typeof body.custom.description === "string"
            ? body.custom.description
            : "",
        instructions:
          typeof body.custom.instructions === "string"
            ? body.custom.instructions
            : "",
        tags,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof CustomSkillValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof CustomSkillConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.warn(
        `[skills/custom] create failed for ${uuid}: ${err instanceof Error ? err.message : err}`,
      );
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  const identifier =
    typeof body.identifier === "string" ? body.identifier.trim() : "";
  if (!identifier || identifier.length > 256) {
    return NextResponse.json({ error: "missing or bad identifier" }, { status: 400 });
  }
  try {
    const r = await installSkill(a.srv.uuid, identifier);
    return NextResponse.json({ ok: true, output: r.output });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const a = await authPod(uuid);
  if ("err" in a) return NextResponse.json({ error: a.err }, { status: a.status });
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim();
  if (!name || name.length > 256 || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    return NextResponse.json({ error: "bad name" }, { status: 400 });
  }
  try {
    const r = await uninstallSkill(a.srv.uuid, name);
    return NextResponse.json({ ok: true, output: r.output });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
