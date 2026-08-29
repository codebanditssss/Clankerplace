// GET /api/pods/[uuid]/webhooks/events?limit=20&path=/v1
//
// Tails the shared Caddy access log at /var/log/caddy/pods/access.log,
// filters by host (= the pod's auto-domain) and an optional path prefix,
// and returns the parsed JSON entries newest-first. Backs the
// "Webhook events" inspector under each connector card.
//
// We read only the trailing slice of the file (last LOOKBACK_BYTES) to
// keep this O(1) regardless of how busy other pods are.
import { NextRequest, NextResponse } from "next/server";
import { open } from "node:fs/promises";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import db, { type PodDomainRow } from "@/lib/db";
import { fullDomain } from "@/lib/domains";

export const dynamic = "force-dynamic";

const LOG_PATH = process.env.PODS_CADDY_ACCESS_LOG ?? "/var/log/caddy/pods/access.log";
// 1 MB tail is enough to capture thousands of events. Bumping this trades
// memory for history depth.
const LOOKBACK_BYTES = 1_000_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type CaddyAccessRow = {
  ts: number;
  request: {
    remote_ip?: string;
    method?: string;
    host?: string;
    uri?: string;
    proto?: string;
    headers?: Record<string, string[]>;
  };
  status: number;
  size: number;
  duration: number;
};

async function tailFile(path: string, bytes: number): Promise<string> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return "";
  }
  try {
    const stat = await handle.stat();
    const offset = Math.max(0, stat.size - bytes);
    const len = stat.size - offset;
    if (len <= 0) return "";
    const buf = Buffer.alloc(len);
    await handle.read(buf, 0, len, offset);
    return buf.toString("utf8");
  } finally {
    await handle.close();
  }
}

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

  // Domain the inspector filters by — we look up the pod's auto-domain
  // (every pod gets one on deploy). Without an auto-domain there's
  // nothing to inspect.
  const dom = db
    .prepare<[string], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE pod_uuid_short = ? AND kind = 'auto' LIMIT 1",
    )
    .get(uuid);
  if (!dom) {
    return NextResponse.json({
      host: null,
      events: [],
      warning: "this pod has no auto-domain — nothing to inspect",
    });
  }
  const host = fullDomain(dom.slug);

  const url = new URL(req.url);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)),
  );
  const pathPrefix = url.searchParams.get("path")?.trim() || null;

  let tail = "";
  try {
    tail = await tailFile(LOG_PATH, LOOKBACK_BYTES);
  } catch {
    /* missing log file is fine — return empty */
  }

  // Caddy's first written line may be partial when we sliced into the
  // middle of it; drop it. (Skip when we read from offset 0.)
  const lines = tail.split("\n").filter((l) => l.length > 0);
  if (tail.length === LOOKBACK_BYTES) lines.shift();

  const events: Array<{
    ts: number;
    method: string;
    path: string;
    status: number;
    size: number;
    duration_ms: number;
    remote_ip: string;
    user_agent: string;
    signature: string | null;
  }> = [];

  // Walk lines newest→oldest until we hit `limit` matches.
  for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
    let row: CaddyAccessRow;
    try {
      row = JSON.parse(lines[i]) as CaddyAccessRow;
    } catch {
      continue;
    }
    if (row?.request?.host !== host) continue;
    const uri = row.request.uri ?? "";
    if (pathPrefix && !uri.startsWith(pathPrefix)) continue;
    // Pull a webhook signature header if present — every major platform
    // uses a different name, so we surface the first one we recognise.
    const headers = row.request.headers ?? {};
    const sigHeader =
      headers["X-Hub-Signature-256"]?.[0] ??
      headers["X-Hub-Signature"]?.[0] ??
      headers["X-Telegram-Bot-Api-Secret-Token"]?.[0] ??
      headers["X-Twilio-Signature"]?.[0] ??
      headers["X-Slack-Signature"]?.[0] ??
      headers["X-Signature"]?.[0] ??
      headers["X-Line-Signature"]?.[0] ??
      headers["X-Webhook-Signature"]?.[0] ??
      headers["Stripe-Signature"]?.[0] ??
      null;
    events.push({
      ts: row.ts,
      method: row.request.method ?? "",
      path: uri,
      status: row.status,
      size: row.size ?? 0,
      duration_ms: Math.round((row.duration ?? 0) * 1000),
      remote_ip: row.request.remote_ip ?? "",
      user_agent: headers["User-Agent"]?.[0] ?? "",
      signature: sigHeader,
    });
  }

  return NextResponse.json({ host, events });
}
