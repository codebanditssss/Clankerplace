// GET /api/pods/[uuid]/fs/list?path=/home/container/...
//
// Returns directory entries for the requested path. Paths are
// normalised + sandboxed to /home/container — anything outside (or
// containing .. traversal) gets 400. Hidden files (dotfiles) are
// included so users can edit .env, .mcrcon, etc.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { execInPod } from "@/lib/node-exec";

const SANDBOX_ROOT = "/home/container";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export function safePath(input: string): string | null {
  let p = (input ?? "").trim();
  if (!p) p = SANDBOX_ROOT;
  // Normalise — no .., no double slashes.
  const parts = p.split("/").filter((s) => s.length > 0 && s !== ".");
  for (const seg of parts) {
    if (seg === "..") return null;
  }
  const norm = "/" + parts.join("/");
  if (norm !== SANDBOX_ROOT && !norm.startsWith(SANDBOX_ROOT + "/")) return null;
  return norm;
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
  const path = safePath(url.searchParams.get("path") ?? SANDBOX_ROOT);
  if (!path) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }

  // Use stat-format printf so we get name + type + size + mtime + perms
  // in one parseable line per entry. Hidden = -name -A.
  try {
    // Routes through node-exec so pods on remote Wings nodes are reached
    // over the Tailscale tailnet (the Next.js process only has a local
    // docker daemon for node-1 pods).
    const { stdout } = await execInPod(
      srv.uuid,
      [
        "exec",
        srv.uuid,
        "bash",
        "-lc",
        `cd ${JSON.stringify(path).slice(1, -1)} 2>/dev/null || exit 0; ls -A1 . 2>/dev/null | while read n; do stat -c "%n\t%F\t%s\t%Y\t%a" -- "$n" 2>/dev/null; done`,
      ],
      { timeoutMs: 8000, maxBuffer: 1024 * 1024 },
    );
    const entries = stdout
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => {
        const [name, type, size, mtime, mode] = l.split("\t");
        return {
          name,
          type: type.includes("directory")
            ? ("dir" as const)
            : type.includes("symbolic link")
              ? ("link" as const)
              : ("file" as const),
          size: Number(size),
          mtime: Number(mtime),
          mode: mode,
        };
      })
      .sort((a, b) => {
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (a.type !== "dir" && b.type === "dir") return 1;
        return a.name.localeCompare(b.name);
      });
    const parent =
      path === SANDBOX_ROOT
        ? null
        : path.slice(0, path.lastIndexOf("/")) || SANDBOX_ROOT;
    return NextResponse.json({ path, parent, entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
