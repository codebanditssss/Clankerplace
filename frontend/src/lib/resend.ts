// Resend wrapper for the managed-email-per-pod feature.
//
// Three call surfaces:
//   1. sendEmail() — outbound. Used by the per-pod /email/send proxy.
//   2. fetchReceivedEmail(id) — pulls the full MIME body for a webhook
//      event (Resend's catch-all webhook only delivers metadata; the
//      payload lives behind a second API call: GET emails.receiving.get).
//   3. verifyInboundWebhook(headers, rawBody) — Svix HMAC check. Resend
//      signs every webhook with the secret you copy from the dashboard.
//
// Two separate Resend accounts/keys, BY DESIGN:
//   RESEND         — the FuelBorn account key. Platform / transactional mail:
//                    signup + password-reset OTPs (lib/auth-emails) and billing
//                    notices (lib/billing/emails), all sent from @pods.ml.
//   RESEND_AGENTS  — the bigcat.pw account key. Per-pod *agent* mailboxes:
//                    outbound <slug>@inbox.bigcat.pw (api/pods/[uuid]/email/send)
//                    and inbound MIME fetch (fetchReceivedEmail). Falls back to
//                    RESEND if unset (dev / single-account setups).
//   RESEND_WEBHOOK_SECRET  — whsec_... from the inbound webhook (bigcat acct).
//   EMAIL_DOMAIN           — agent mailbox domain (default inbox.bigcat.pw)

import "server-only";
import { Resend } from "resend";
import { Webhook as SvixWebhook } from "svix";

const API_KEY = process.env.RESEND ?? "";
const AGENTS_API_KEY = process.env.RESEND_AGENTS ?? process.env.RESEND ?? "";
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? "";
export const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN ?? "inbox.bigcat.pw";

if (!API_KEY) {
  console.warn(
    "[resend] RESEND is not set — platform email send/fetch will throw at call time.",
  );
}
if (!process.env.RESEND_AGENTS) {
  console.warn(
    "[resend] RESEND_AGENTS is not set — per-pod agent email falls back to the RESEND key, which won't be verified for inbox.bigcat.pw.",
  );
}

// Platform client (FuelBorn account): auth + billing.
let _client: Resend | null = null;
function client(): Resend {
  if (_client) return _client;
  if (!API_KEY) throw new Error("RESEND is required");
  _client = new Resend(API_KEY);
  return _client;
}

// Agents client (bigcat.pw account): per-pod mailboxes + inbound fetch.
let _agentsClient: Resend | null = null;
function agentsClient(): Resend {
  if (_agentsClient) return _agentsClient;
  if (!AGENTS_API_KEY) throw new Error("RESEND_AGENTS (or RESEND) is required");
  _agentsClient = new Resend(AGENTS_API_KEY);
  return _agentsClient;
}

export type SendOpts = {
  to: string | string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  /** RFC 5322 `In-Reply-To` value (Message-ID of the parent) for threading. */
  inReplyTo?: string;
  /** Extra Message-IDs to chain into References. */
  references?: string[];
  /**
   * Which Resend account/key to send through:
   *   "platform" (default) — the RESEND / pods.ml key (auth + billing).
   *   "agents"             — the RESEND_AGENTS / bigcat.pw key (pod mailboxes).
   */
  account?: "platform" | "agents";
  attachments?: Array<{
    filename: string;
    content: string; // base64 string per Resend's API
    contentType?: string;
  }>;
};

export type SendResult = {
  id: string;
};

export async function sendEmail(opts: SendOpts): Promise<SendResult> {
  const headers: Record<string, string> = {};
  if (opts.inReplyTo) headers["In-Reply-To"] = opts.inReplyTo;
  if (opts.references?.length) {
    headers.References = opts.references.map((m) => `<${m}>`).join(" ");
  }
  // Resend's TS types are a discriminated union — must commit to one of
  // {text, html, react, template}. We always set `text` (defaulting to
  // empty if the caller only sent html, which is allowed by the API and
  // by our SDK runtime).
  // Route through the agent (bigcat.pw) account for per-pod mailboxes,
  // otherwise the platform (pods.ml) account for auth + billing mail.
  const resendClient = opts.account === "agents" ? agentsClient() : client();
  const r = await resendClient.emails.send({
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text ?? "",
    ...(opts.html ? { html: opts.html } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(opts.attachments ? { attachments: opts.attachments } : {}),
  });
  if (r.error) {
    throw new Error(
      `Resend send failed: ${r.error.message ?? JSON.stringify(r.error)}`,
    );
  }
  if (!r.data?.id) {
    throw new Error("Resend send returned no id");
  }
  return { id: r.data.id };
}

export type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc: string[] | null;
  bcc: string[] | null;
  reply_to: string[] | null;
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, string> | null;
  message_id: string;
  attachments: Array<{ filename?: string; size?: number; content_type?: string }>;
  created_at: string;
};

/**
 * Pull the full MIME body for a `email.received` webhook event.
 * Resend stores received messages for 30 days; this call is idempotent.
 */
export async function fetchReceivedEmail(id: string): Promise<ReceivedEmail> {
  // Inbound pod mail lives in the agents (bigcat.pw) account.
  const r = await agentsClient().emails.receiving.get(id);
  if (r.error) {
    throw new Error(
      `Resend receiving.get failed: ${r.error.message ?? JSON.stringify(r.error)}`,
    );
  }
  const d = r.data;
  if (!d) throw new Error(`Resend receiving.get returned empty`);
  return {
    id: d.id,
    from: d.from,
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    reply_to: d.reply_to,
    subject: d.subject,
    text: d.text,
    html: d.html,
    headers: d.headers,
    message_id: d.message_id,
    attachments: (d.attachments ?? []).map((a) => ({
      filename: a.filename ?? undefined,
      size: a.size ?? undefined,
      content_type: a.content_type ?? undefined,
    })),
    created_at: d.created_at,
  };
}

/**
 * Verify a Resend inbound webhook signature using Svix's HMAC scheme.
 * Throws if the signature doesn't validate. Returns the parsed payload.
 *
 * Required Svix headers (case-insensitive):
 *   svix-id        — message id
 *   svix-timestamp — unix seconds
 *   svix-signature — v1,base64 HMAC over `${id}.${ts}.${rawBody}`
 *
 * Rawbody MUST be the exact byte sequence Resend sent — don't reparse +
 * stringify before passing here.
 */
export function verifyInboundWebhook(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
): unknown {
  if (!WEBHOOK_SECRET) {
    throw new Error("RESEND_WEBHOOK_SECRET is required");
  }
  if (!headers.id || !headers.timestamp || !headers.signature) {
    throw new Error("missing Svix headers (id/timestamp/signature)");
  }
  const wh = new SvixWebhook(WEBHOOK_SECRET);
  // svix.verify throws on signature mismatch. Returns the parsed JSON
  // payload on success.
  return wh.verify(rawBody, {
    "svix-id": headers.id,
    "svix-timestamp": headers.timestamp,
    "svix-signature": headers.signature,
  });
}

/**
 * Extract the receiver slug from a `to` address like `<slug>@inbox.bigcat.pw`.
 * Returns null if the address doesn't match our managed domain.
 */
export function slugFromAddress(addr: string): string | null {
  // Tolerate "Name <local@domain>" form: pull the part inside the angle brackets.
  const m = addr.match(/<([^>]+)>/);
  const clean = (m ? m[1] : addr).trim().toLowerCase();
  const at = clean.indexOf("@");
  if (at < 0) return null;
  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  if (domain !== EMAIL_DOMAIN.toLowerCase()) return null;
  // Slug shape matches our generator (a-z0-9-, length 3-63).
  if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(local)) return null;
  return local;
}

export function podAddressFor(slug: string): string {
  return `${slug}@${EMAIL_DOMAIN}`;
}
