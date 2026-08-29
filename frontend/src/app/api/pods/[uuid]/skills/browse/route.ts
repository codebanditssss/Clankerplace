// GET /api/pods/[uuid]/skills/browse?q=&source=&page=&pageSize=
//
// Reads pre-resolved index-cache JSON Hermes already produced for us
// and applies text + source filters in memory. Sub-100ms typical.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { readRegistry, refreshRegistry } from "@/lib/hermes-skills";

type BrowseSkill = Awaited<ReturnType<typeof readRegistry>>[number];

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
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const a = await authPod(uuid);
  if ("err" in a) return NextResponse.json({ error: a.err }, { status: a.status });
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const source = (url.searchParams.get("source") ?? "all").trim().toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20),
  );

  let all = await readRegistry(a.srv.uuid);
  // Fresh pods don't have an index cache until something walks browse —
  // the egg install doesn't seed it. Lazy-trigger one refresh so first
  // visit to the tab Just Works. Bounded by hermes' own ~25s budget.
  if (all.length === 0) {
    try {
      await refreshRegistry(a.srv.uuid);
      all = await readRegistry(a.srv.uuid);
    } catch (err) {
      console.warn(
        `[skills/browse] refresh failed for ${uuid}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  const filtered = all.filter((s) => {
    if (source !== "all" && s.source.toLowerCase() !== source) return false;
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.identifier.toLowerCase().includes(q) ||
      (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  });
  // With a query, rank by text relevance first. Without one, keep the
  // directory feel: high-install trusted skills first, then alphabetical.
  filtered.sort((a, b) => {
    if (q) {
      const ar = relevanceScore(a, q);
      const br = relevanceScore(b, q);
      if (ar !== br) return br - ar;
    }
    const trust = trustSort(b.trust) - trustSort(a.trust);
    if (trust !== 0) return trust;
    const ai = a.installs ?? 0;
    const bi = b.installs ?? 0;
    if (ai !== bi) return bi - ai;
    return a.name.localeCompare(b.name);
  });
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  const sources = Array.from(new Set(all.map((s) => s.source))).sort();
  return NextResponse.json({ items, total, page, pageSize, sources });
}

function relevanceScore(skill: BrowseSkill, query: string): number {
  const tokens = query.split(/\s+/).filter(Boolean);
  let score = 0;
  const name = skill.name.toLowerCase();
  const id = skill.identifier.toLowerCase();
  const description = skill.description.toLowerCase();
  const tags = (skill.tags ?? []).map((tag) => tag.toLowerCase());
  const source = skill.source.toLowerCase();

  for (const token of tokens) {
    if (name === token || id === token) score += 120;
    if (name.startsWith(token) || id.startsWith(token)) score += 80;
    if (name.includes(token)) score += 50;
    if (id.includes(token)) score += 35;
    if (tags.some((tag) => tag === token)) score += 30;
    if (tags.some((tag) => tag.includes(token))) score += 18;
    if (source.includes(token)) score += 10;
    if (description.includes(token)) score += 8;
  }

  return score;
}

function trustSort(trust: BrowseSkill["trust"]): number {
  return { official: 3, trusted: 2, community: 1, unknown: 0 }[trust];
}
