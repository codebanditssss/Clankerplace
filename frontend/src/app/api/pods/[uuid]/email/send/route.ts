// POST /api/pods/[uuid]/email/send
//
// Outbound mail proxy. The pod (running Hermes) calls this with a
// shared bearer secret + a recipient — we look up the pod's slug,
// pin the From: to `<slug>@inbox.bigcat.pw` (so the agent can't spoof
// arbitrary senders), rate-limit, then forward to Resend's /emails.
//
// Auth model: this endpoint is called FROM the pod, not from the
// FuelBorn dashboard. The pod authenticates with a per-pod outbound
// token we set in its env at deploy time (POD_EMAIL_TOKEN). The
// frontend dashboard's UI uses the SAME endpoint with the user's
// session cookie — both flows resolve the pod by uuid and check that
// the caller owns the pod (or has the right outbound token).
import { NextRequest, NextResponse } from "next/server";
import db, { type PodDomainRow, type PodEmailRow } from "@/lib/db";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail, podAddressFor, EMAIL_DOMAIN } from "@/lib/resend";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Per-pod outbound rate limit. Cheap in-memory sliding window — fine
// for a single Next.js process. We track `(pod_uuid_short, hourWindow)`
// → count. Resets when the process restarts (acceptable for a
// best-effort cap).
const HOURLY_LIMIT = 100;
const rateBuckets = new Map<string, { window: number; count: number }>();
function bumpAndCheck(podShort: string): {
  ok: boolean;
  remaining: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / 3600);
  const key = `${podShort}:${window}`;
  const cur = rateBuckets.get(key) ?? { window, count: 0 };
  if (cur.count >= HOURLY_LIMIT) {
    return { ok: false, remaining: 0 };
  }
  cur.count += 1;
  rateBuckets.set(key, cur);
  // Garbage collect old windows lazily.
  for (const [k, v] of rateBuckets) {
    if (v.window < window - 1) rateBuckets.delete(k);
  }
  return { ok: true, remaining: HOURLY_LIMIT - cur.count };
}

async function authorize(
  req: NextRequest,
  uuid: string,
): Promise<{ srv: ServerAttributes; slug: string } | { error: string; status: number }> {
  // First resolve the server attribs (we need its full uuid for env reads anyway).
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const srv = data.data?.[0]?.attributes;
  if (!srv) return { error: "not found", status: 404 };

  // Path A: pod-side bearer token. The token lives in our SQLite (set
  // when we provisioned the auto-domain at deploy time) AND is mirrored
  // into the pod's ~/.hermes/.env so the agent has it in process env.
  // We compare bearer against the SQLite copy — never Pelican's view,
  // because Pelican silently drops env vars not declared in the egg.
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const tok = auth.slice(7).trim();
    const dom = db
      .prepare<[string], PodDomainRow>(
        "SELECT * FROM pod_domains WHERE pod_uuid_short = ? AND kind = 'auto' LIMIT 1",
      )
      .get(uuid);
    if (!dom) return { error: "no auto-domain for this pod", status: 409 };
    if (dom.pod_email_token && tok === dom.pod_email_token) {
      return { srv, slug: dom.slug };
    }
  }

  // Path B: dashboard user session. Must own the pod via Pelican user_id.
  const user = await getCurrentUser();
  if (!user) return { error: "not signed in", status: 401 };
  if (srv.user !== user.pelicanUserId) return { error: "not yours", status: 403 };
  const dom = db
    .prepare<[string], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE pod_uuid_short = ? AND kind = 'auto' LIMIT 1",
    )
    .get(uuid);
  if (!dom) return { error: "no auto-domain for this pod", status: 409 };
  return { srv, slug: dom.slug };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const auth = await authorize(req, uuid);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { srv, slug } = auth;

  let body: {
    to?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
    in_reply_to?: string;
    references?: string[];
    attachments?: Array<{ filename: string; content: string; contentType?: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.to || (!body.text && !body.html)) {
    return NextResponse.json(
      { error: "to + (text or html) required" },
      { status: 400 },
    );
  }

  // Rate limit before we hit Resend (saves quota on abusive loops).
  const limit = bumpAndCheck(srv.identifier);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `rate limit: ${HOURLY_LIMIT}/hr/pod` },
      { status: 429 },
    );
  }

  const from = podAddressFor(slug);
  let resendId: string | null = null;
  let errorMsg: string | null = null;
  try {
    const r = await sendEmail({
      from,
      to: body.to,
      subject: body.subject ?? "",
      text: body.text,
      html: body.html,
      inReplyTo: body.in_reply_to,
      references: body.references,
      attachments: body.attachments,
      account: "agents",
    });
    resendId = r.id;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  const toAddr = Array.isArray(body.to) ? body.to.join(", ") : body.to;
  db.prepare(
    `INSERT INTO pod_emails (
      pod_uuid_short, resend_email_id, direction, from_addr, to_addr,
      subject, text, html, in_reply_to, sent_at, error
    ) VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  ).run(
    srv.identifier,
    resendId,
    from,
    toAddr,
    body.subject ?? "",
    body.text ?? null,
    body.html ?? null,
    body.in_reply_to ?? null,
    errorMsg,
  );

  if (errorMsg) {
    return NextResponse.json(
      { error: errorMsg, from },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    id: resendId,
    from,
    to: body.to,
    remaining: limit.remaining,
  });
}

// Convenience: GET returns the pod's outbound address + rate-limit
// status, useful for the EmailTab UI's "from" display.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const srv = data.data?.[0]?.attributes;
  if (!srv || srv.user !== user.pelicanUserId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const dom = db
    .prepare<[string], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE pod_uuid_short = ? AND kind = 'auto' LIMIT 1",
    )
    .get(uuid);
  return NextResponse.json({
    address: dom ? podAddressFor(dom.slug) : null,
    domain: EMAIL_DOMAIN,
    rate_limit_per_hour: HOURLY_LIMIT,
  });
}
