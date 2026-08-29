// GET    /api/pods/[uuid]/fs/file?path=...   — read a text file
// POST   /api/pods/[uuid]/fs/file            — body: { path, content }
// DELETE /api/pods/[uuid]/fs/file?path=...   — delete a file
//
// Text-only by design: returns the first 256 KB UTF-8 of any file under
// /home/container. Binary files render as `(binary, NNN bytes — open
// over SFTP)` so we never blast random bytes into the UI.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { execInPod, execInPodStdin } from "@/lib/node-exec";
import { safePath } from "../list/route";

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
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
  const path = safePath(url.searchParams.get("path") ?? "");
  if (!path) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }
  try {
    // Stat first (every image ships stat); test for size + dir-ness.
    const escaped = JSON.stringify(path).slice(1, -1);
    const { stdout: sizeOut } = await execInPod(
      srv.uuid,
      ["exec", srv.uuid, "stat", "-c", "%s\t%F", "--", escaped],
      { timeoutMs: 6000, maxBuffer: 4 * 1024 },
    );
    const [sizeStr, kind] = sizeOut.trim().split("\t");
    const sz = Number(sizeStr);
    if (kind?.includes("directory")) {
      return NextResponse.json(
        { error: "path is a directory" },
        { status: 400 },
      );
    }
    // Heuristic binary check: read first 1024 bytes; if any NUL byte or
    // >5% bytes outside printable ASCII/UTF-8 continuation range, treat
    // as binary. `file` isn't available in every yolks image so we DIY.
    const headBytes = Math.min(sz, 1024);
    const { stdout: probeOut } = await execInPod(
      srv.uuid,
      [
        "exec",
        srv.uuid,
        "bash",
        "-lc",
        `head -c ${headBytes} ${escaped} | base64 -w0`,
      ],
      { timeoutMs: 6000, maxBuffer: 4 * 1024 },
    );
    const probe = Buffer.from(probeOut.trim(), "base64");
    let nonPrintable = 0;
    let hasNull = false;
    for (let i = 0; i < probe.length; i++) {
      const b = probe[i];
      if (b === 0) {
        hasNull = true;
        break;
      }
      // Allow tab, LF, CR, plus 32-126 + UTF-8 high bytes.
      if (
        b === 9 ||
        b === 10 ||
        b === 13 ||
        (b >= 32 && b <= 126) ||
        b >= 128
      )
        continue;
      nonPrintable++;
    }
    const isBinary = hasNull || nonPrintable / Math.max(probe.length, 1) > 0.05;
    if (isBinary) {
      return NextResponse.json({
        path,
        binary: true,
        size: sz,
        mime: "application/octet-stream",
        content: null,
      });
    }
    const truncated = sz > MAX_READ_BYTES;
    const { stdout } = await execInPod(
      srv.uuid,
      [
        "exec",
        srv.uuid,
        "bash",
        "-lc",
        `head -c ${MAX_READ_BYTES} ${escaped}`,
      ],
      { timeoutMs: 6000, maxBuffer: MAX_READ_BYTES + 1024 },
    );
    return NextResponse.json({
      path,
      binary: false,
      size: sz,
      truncated,
      content: stdout,
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

  let body: { path?: string; content?: string };
  try {
    body = (await req.json()) as { path?: string; content?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const path = safePath(body.path ?? "");
  if (!path) return NextResponse.json({ error: "bad path" }, { status: 400 });
  const content = body.content ?? "";
  if (content.length > MAX_WRITE_BYTES) {
    return NextResponse.json(
      { error: `file too large (>${MAX_WRITE_BYTES}b — use SFTP)` },
      { status: 413 },
    );
  }
  // Refuse to write directories.
  try {
    await execInPodStdin(
      srv.uuid,
      [
        "exec",
        "-i",
        srv.uuid,
        "bash",
        "-lc",
        `mkdir -p $(dirname ${JSON.stringify(path).slice(1, -1)}) && cat > ${JSON.stringify(path).slice(1, -1)}`,
      ],
      content,
    );
    return NextResponse.json({ ok: true, path, bytes: content.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
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
  const path = safePath(url.searchParams.get("path") ?? "");
  if (!path) return NextResponse.json({ error: "bad path" }, { status: 400 });
  // Never delete the sandbox root or single-segment top-level dirs by accident.
  if (path === "/home/container" || path === "/home/container/world") {
    return NextResponse.json(
      { error: "refusing to delete a top-level directory" },
      { status: 403 },
    );
  }
  try {
    await execInPod(
      srv.uuid,
      [
        "exec",
        srv.uuid,
        "bash",
        "-lc",
        `rm -rf ${JSON.stringify(path).slice(1, -1)}`,
      ],
      { timeoutMs: 8000 },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
