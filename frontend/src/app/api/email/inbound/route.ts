// POST /api/email/inbound
//
// Resend's catch-all inbound webhook delivers every email sent to
// `*@<EMAIL_DOMAIN>` here. We:
//   1. Verify the Svix signature (using RESEND_WEBHOOK_SECRET).
//   2. Pick the slug out of the to-address(es).
//   3. Resolve the pod via pod_domains.slug → pod_uuid_short.
//   4. Pull the full MIME body via GET /emails/<id> (the webhook only
//      gives us metadata — the body lives behind that second call).
//   5. INSERT into pod_emails (idempotent on resend_email_id).
//   6. Fire-and-forget POST to https://<slug>.bigcat.pw/webhooks/email
//      so the running Hermes agent can react in real-time.
//
// We ALWAYS return 200 if the signature was valid — Resend retries
// non-2xx, and we'd rather degrade gracefully than churn deliveries
// while a pod is mid-restart.
import { NextRequest, NextResponse } from "next/server";
import db, { type PodDomainRow, type PodEmailRow } from "@/lib/db";
import {
  fetchReceivedEmail,
  slugFromAddress,
  verifyInboundWebhook,
} from "@/lib/resend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResendInboundPayload = {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    created_at: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    message_id: string;
  };
};

export async function POST(req: NextRequest) {
  // Svix needs the raw body byte-for-byte for signature verification.
  // We do NOT use req.json() until AFTER verify (svix.verify does the
  // JSON.parse internally).
  const rawBody = await req.text();
  let payload: ResendInboundPayload;
  try {
    payload = verifyInboundWebhook(rawBody, {
      id: req.headers.get("svix-id") ?? undefined,
      timestamp: req.headers.get("svix-timestamp") ?? undefined,
      signature: req.headers.get("svix-signature") ?? undefined,
    }) as ResendInboundPayload;
  } catch (err) {
    console.warn(
      `[email/inbound] signature verify failed: ${err instanceof Error ? err.message : err}`,
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  if (payload.type !== "email.received") {
    // Some other Resend webhook event landed here by mistake — ack OK
    // so Resend doesn't retry, but do nothing.
    return NextResponse.json({ ok: true, ignored: payload.type });
  }

  // Pick the first recipient that matches our managed domain.
  const recipients = [
    ...(payload.data.to ?? []),
    ...(payload.data.cc ?? []),
    ...(payload.data.bcc ?? []),
  ];
  let slug: string | null = null;
  let matchedTo: string | null = null;
  for (const addr of recipients) {
    const s = slugFromAddress(addr);
    if (s) {
      slug = s;
      matchedTo = addr;
      break;
    }
  }
  if (!slug) {
    console.warn(
      `[email/inbound] no slug-matching recipient on email_id=${payload.data.email_id} to=${recipients.join(",")}`,
    );
    return NextResponse.json({ ok: true, dropped: "no matching slug" });
  }

  // Resolve slug → pod. We don't restrict by user_id (the slug is
  // unique site-wide anyway).
  const dom = db
    .prepare<[string], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE slug = ? LIMIT 1",
    )
    .get(slug);
  if (!dom) {
    console.warn(`[email/inbound] slug ${slug} not in pod_domains — dropping`);
    return NextResponse.json({ ok: true, dropped: "unknown slug" });
  }

  // Idempotency: if we already stored this resend_email_id, skip the
  // body fetch + insert. Resend redelivers on non-2xx; we want this
  // hit to be safe.
  const existing = db
    .prepare<[string], PodEmailRow>(
      "SELECT * FROM pod_emails WHERE resend_email_id = ? LIMIT 1",
    )
    .get(payload.data.email_id);
  if (existing) {
    return NextResponse.json({ ok: true, deduped: true, id: existing.id });
  }

  // Fetch the full message body. Fail-soft: if Resend's GET errors,
  // we still write the metadata-only row so the user sees something.
  let full: Awaited<ReturnType<typeof fetchReceivedEmail>> | null = null;
  try {
    full = await fetchReceivedEmail(payload.data.email_id);
  } catch (err) {
    console.warn(
      `[email/inbound] fetchReceivedEmail(${payload.data.email_id}) failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  const insert = db
    .prepare(
      `INSERT INTO pod_emails (
        pod_uuid_short, resend_email_id, direction, from_addr, to_addr,
        subject, text, html, headers_json, in_reply_to, message_id,
        received_at
      ) VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      dom.pod_uuid_short,
      payload.data.email_id,
      payload.data.from,
      matchedTo,
      payload.data.subject ?? full?.subject ?? "",
      full?.text ?? null,
      full?.html ?? null,
      full?.headers ? JSON.stringify(full.headers) : null,
      full?.headers?.["In-Reply-To"] ?? full?.headers?.["in-reply-to"] ?? null,
      payload.data.message_id ?? full?.message_id ?? null,
      payload.data.created_at,
    );

  // Fan out to the pod's webhook adapter (best-effort).
  // The pod is reachable at https://<slug>.bigcat.pw/webhooks/email
  // through the existing Caddy path-routed include → :8644 (Hermes
  // generic webhook adapter). Fire-and-forget; we already persisted
  // the canonical copy in pod_emails.
  (async () => {
    const url = `https://${dom.slug}.${process.env.PODS_DOMAIN_ROOT ?? "bigcat.pw"}/webhooks/email`;
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pods-Email-Id": String(insert.lastInsertRowid),
        },
        body: JSON.stringify({
          id: payload.data.email_id,
          from: payload.data.from,
          to: matchedTo,
          subject: payload.data.subject,
          text: full?.text ?? null,
          html: full?.html ?? null,
          message_id: payload.data.message_id,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Pod might not have a /webhooks/email handler yet — fine.
    }
  })().catch(() => {});

  return NextResponse.json({ ok: true, id: Number(insert.lastInsertRowid) });
}
