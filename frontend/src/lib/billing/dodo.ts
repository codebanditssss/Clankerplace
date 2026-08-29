import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import db, {
  type BillingEventRow,
  type SubscriptionRow,
  type UserRow,
} from "@/lib/db";
import {
  CREDIT_PACKS,
  creditPackForDodoProduct,
  getDodoProductForCreditPack,
  getDodoProductForPlan,
  isPlanId,
  isSelfServePlanId,
  planIdForDodoProduct,
  type CreditPackId,
  type PlanId,
  type SelfServePlanId,
} from "./plans";
import { upsertBillingCustomer } from "./customers";
import { recordCreditPurchase } from "./credits";
import { recordDodoPaymentAttempt } from "./payment-attempts";
import { upsertSubscriptionFromDodo } from "./subscriptions";

type JsonRecord = Record<string, unknown>;

export type DodoCheckoutSession = {
  session_id?: string;
  checkout_url: string;
};

export type DodoPortalSession = {
  portal_url: string;
};

export type DodoWebhookEvent = {
  business_id?: string;
  type: string;
  timestamp?: string;
  data: JsonRecord;
};

export type DodoWebhookResult =
  | { ok: true; duplicate: true }
  | {
      ok: true;
      duplicate: false;
      action:
        | "subscription_synced"
        | "credit_recorded"
        | "payment_attempt_recorded"
        | "ignored";
    }
  | { ok: false; status: number; error: string };

function dodoBaseUrl(): string {
  const env = process.env.DODO_PAYMENTS_ENVIRONMENT ?? "live_mode";
  return env === "test_mode"
    ? "https://test.dodopayments.com"
    : "https://live.dodopayments.com";
}

function dodoApiKey(): string {
  const key = process.env.DODO_PAYMENTS_API_KEY;
  if (!key) throw new Error("DODO_PAYMENTS_API_KEY is not configured");
  return key;
}

async function dodoPost<T>(path: string, body: JsonRecord): Promise<T> {
  const res = await fetch(`${dodoBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${dodoApiKey()}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(
      `Dodo API ${path} failed with ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  return payload as T;
}

export async function createSubscriptionCheckout(input: {
  plan: SelfServePlanId;
  userId: number;
  email: string;
  returnUrl: string;
  existingCustomerId?: string | null;
}): Promise<DodoCheckoutSession> {
  const productId = getDodoProductForPlan(input.plan);
  const body: JsonRecord = {
    product_cart: [{ product_id: productId, quantity: 1 }],
    return_url: input.returnUrl,
    metadata: {
      intent: "subscription",
      user_id: String(input.userId),
      plan: input.plan,
    },
  };
  if (input.existingCustomerId) {
    body.customer_id = input.existingCustomerId;
  } else {
    body.customer = {
      email: input.email,
      name: input.email.split("@")[0],
    };
  }

  const session = await dodoPost<DodoCheckoutSession>("/checkouts", body);
  if (!session.checkout_url) throw new Error("Dodo checkout_url missing");
  return session;
}

export async function createCreditCheckout(input: {
  pack: CreditPackId;
  userId: number;
  email: string;
  returnUrl: string;
  existingCustomerId?: string | null;
}): Promise<DodoCheckoutSession> {
  const productId = getDodoProductForCreditPack(input.pack);
  const pack = CREDIT_PACKS[input.pack];
  const body: JsonRecord = {
    product_cart: [{ product_id: productId, quantity: 1 }],
    return_url: input.returnUrl,
    metadata: {
      intent: "credit_pack",
      user_id: String(input.userId),
      credit_pack: input.pack,
      amount_cents: String(pack.amountCents),
    },
  };
  if (input.existingCustomerId) {
    body.customer_id = input.existingCustomerId;
  } else {
    body.customer = {
      email: input.email,
      name: input.email.split("@")[0],
    };
  }

  const session = await dodoPost<DodoCheckoutSession>("/checkouts", body);
  if (!session.checkout_url) throw new Error("Dodo checkout_url missing");
  return session;
}

export async function createCustomerPortal(input: {
  dodoCustomerId: string;
  returnUrl: string;
}): Promise<DodoPortalSession> {
  const payload = await dodoPost<JsonRecord>(
    `/customers/${encodeURIComponent(input.dodoCustomerId)}/customer-portal/session`,
    { return_url: input.returnUrl },
  );
  const portalUrl =
    stringValue(payload, "portal_url") ??
    stringValue(payload, "customer_portal_url") ??
    stringValue(payload, "url") ??
    stringValue(payload, "link");
  if (!portalUrl) throw new Error("Dodo portal URL missing");
  return { portal_url: portalUrl };
}

export function verifyDodoWebhookSignature(input: {
  rawBody: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  secret?: string;
}): boolean {
  const secret = input.secret ?? process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  if (!secret || !input.webhookId || !input.webhookTimestamp || !input.webhookSignature) {
    return false;
  }

  const signed = `${input.webhookId}.${input.webhookTimestamp}.${input.rawBody}`;
  const hmac = createHmac("sha256", webhookSecretBytes(secret)).update(signed).digest();
  const candidates = signatureCandidates(input.webhookSignature);
  return candidates.some((candidate) => secureCompare(candidate, hmac));
}

function webhookSecretBytes(secret: string): Buffer | string {
  if (!secret.startsWith("whsec_")) return secret;
  const encoded = secret.slice("whsec_".length);
  for (const encoding of ["base64", "base64url"] as const) {
    try {
      const decoded = Buffer.from(encoded, encoding);
      if (decoded.length > 0) return decoded;
    } catch {
      // Try the next Standard Webhooks secret encoding.
    }
  }
  return secret;
}

function signatureCandidates(header: string): Buffer[] {
  const values = header
    .split(/\s+/)
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^v\d+=/, ""))
    .map((part) => (part.startsWith("v") && /^v\d+$/.test(part) ? "" : part))
    .filter(Boolean);

  const out: Buffer[] = [];
  for (const value of values) {
    for (const encoding of ["base64", "hex"] as const) {
      try {
        const buf = Buffer.from(value, encoding);
        if (buf.length === 32) out.push(buf);
      } catch {
        // Try the next accepted encoding.
      }
    }
  }
  return out;
}

function secureCompare(candidate: Buffer, expected: Buffer): boolean {
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function parseDodoEvent(rawBody: string): DodoWebhookEvent {
  const parsed = JSON.parse(rawBody) as unknown;
  if (!isRecord(parsed)) throw new Error("webhook body must be an object");
  const type = stringValue(parsed, "type");
  const data = recordValue(parsed, "data");
  if (!type || !data) throw new Error("webhook body missing type or data");
  return {
    business_id: stringValue(parsed, "business_id") ?? undefined,
    type,
    timestamp: stringValue(parsed, "timestamp") ?? undefined,
    data,
  };
}

export function processDodoWebhook(input: {
  webhookId: string;
  rawBody: string;
  event: DodoWebhookEvent;
}): DodoWebhookResult {
  const payloadHash = createHash("sha256").update(input.rawBody).digest("hex");
  try {
    return processDodoWebhookTransaction({
      webhookId: input.webhookId,
      payloadHash,
      event: input.event,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ensureWebhookFailureRow(input.webhookId, input.event.type, payloadHash);
    markWebhookFailed(input.webhookId, message);
    return { ok: false, status: 500, error: message };
  }
}

const processDodoWebhookTransaction = db.transaction(
  (input: {
    webhookId: string;
    payloadHash: string;
    event: DodoWebhookEvent;
  }): DodoWebhookResult => {
    db.prepare(
      `INSERT OR IGNORE INTO dodo_webhook_events
        (webhook_id, event_type, processing_status, payload_hash)
       VALUES (?, ?, 'received', ?)`,
    ).run(input.webhookId, input.event.type, input.payloadHash);

    const existing = db
      .prepare<
        [string],
        {
          processing_status: string;
          payload_hash: string;
          error: string | null;
        }
      >(
        `SELECT processing_status, payload_hash, error
           FROM dodo_webhook_events
          WHERE webhook_id = ?`,
      )
      .get(input.webhookId);
    if (!existing) throw new Error("failed to record webhook event");

    if (existing.payload_hash !== input.payloadHash) {
      return {
        ok: false,
        status: 409,
        error: "webhook_id_reused_with_different_payload",
      };
    }
    if (
      existing.processing_status === "processed" ||
      existing.processing_status === "ignored"
    ) {
      return { ok: true, duplicate: true };
    }

    const billingEventId = insertBillingEvent({
      webhookId: input.webhookId,
      event: input.event,
    });
    const action = handleDodoEvent(input.event, billingEventId);
    markWebhookProcessed(input.webhookId, action);
    return { ok: true, duplicate: false, action };
  },
);

function ensureWebhookFailureRow(
  webhookId: string,
  eventType: string,
  payloadHash: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO dodo_webhook_events
      (webhook_id, event_type, processing_status, payload_hash)
     VALUES (?, ?, 'received', ?)`,
  ).run(webhookId, eventType, payloadHash);
}

function insertBillingEvent(input: {
  webhookId: string;
  event: DodoWebhookEvent;
}): number {
  const userId = extractUserId(input.event.data);
  const resource = extractResource(input.event);
  db.prepare(
    `INSERT OR IGNORE INTO billing_events (
       user_id,
       provider,
       provider_event_id,
       event_type,
       resource_type,
       resource_id,
       payload_json
     )
     VALUES (?, 'dodo', ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    input.webhookId,
    input.event.type,
    resource.type,
    resource.id,
    JSON.stringify(input.event),
  );

  const row = db
    .prepare<[string], Pick<BillingEventRow, "id">>(
      `SELECT id FROM billing_events
        WHERE provider = 'dodo' AND provider_event_id = ?`,
    )
    .get(input.webhookId);
  if (!row) throw new Error("failed to record billing event");
  return row.id;
}

function handleDodoEvent(
  event: DodoWebhookEvent,
  billingEventId: number,
): "subscription_synced" | "credit_recorded" | "payment_attempt_recorded" | "ignored" {
  if (event.type.startsWith("subscription.")) {
    return syncSubscription(event);
  }
  if (event.type.startsWith("payment.")) {
    if (event.type === "payment.succeeded") {
      const creditAction = recordCreditPackPayment(event, billingEventId);
      if (creditAction === "credit_recorded") return creditAction;
      syncSubscriptionFromSuccessfulPayment(event);
      return recordPaymentAttempt(event);
    }
    return recordPaymentAttempt(event);
  }
  if (event.type.startsWith("abandoned_checkout.")) {
    return recordPaymentAttempt(event);
  }
  return "ignored";
}

function syncSubscription(event: DodoWebhookEvent): "subscription_synced" | "ignored" {
  const subscriptionId = extractSubscriptionId(event.data);
  if (!subscriptionId) return "ignored";

  const existingSubscription = findSubscriptionByDodoId(subscriptionId);
  const userId =
    extractUserId(event.data) ??
    findUserIdByEmail(extractEmail(event.data)) ??
    existingSubscription?.user_id ??
    null;
  if (!userId) return "ignored";

  const productId = extractProductId(event.data);
  const existingPlan =
    existingSubscription && isPlanId(existingSubscription.plan)
      ? existingSubscription.plan
      : null;
  const plan = planIdForDodoProduct(productId) ?? existingPlan;
  if (!plan) return "ignored";

  upsertSubscriptionFromDodo({
    userId,
    plan,
    status: extractSubscriptionStatus(event, existingSubscription?.status),
    dodoCustomerId: extractCustomerId(event.data),
    dodoSubscriptionId: subscriptionId,
    currentPeriodStart:
      stringValue(event.data, "current_period_start") ??
      stringValue(event.data, "billing_period_start"),
    currentPeriodEnd:
      stringValue(event.data, "current_period_end") ??
      stringValue(event.data, "next_billing_date") ??
      stringValue(event.data, "billing_period_end"),
    cancelAtPeriodEnd:
      booleanValue(event.data, "cancel_at_period_end") ??
      booleanValue(event.data, "cancel_at_next_billing_date") ??
      undefined,
    cancelledAt:
      stringValue(event.data, "cancelled_at") ??
      stringValue(event.data, "canceled_at"),
    renewalDate:
      stringValue(event.data, "renewal_date") ??
      stringValue(event.data, "next_billing_date") ??
      stringValue(event.data, "current_period_end"),
    providerUpdatedAt: providerTimestampForEvent(event),
    rawPayload: event.data,
  });
  upsertBillingCustomer({
    userId,
    dodoCustomerId: extractCustomerId(event.data),
    email: extractEmail(event.data),
    metadata: event.data,
  });
  recordPaymentAttempt(event, {
    userId,
    plan,
    status: extractSubscriptionStatus(event, existingSubscription?.status),
  });
  return "subscription_synced";
}

function findSubscriptionByDodoId(
  subscriptionId: string,
): Pick<SubscriptionRow, "user_id" | "plan" | "status"> | null {
  return (
    db
      .prepare<[string], Pick<SubscriptionRow, "user_id" | "plan" | "status">>(
        `SELECT user_id, plan, status
           FROM subscriptions
          WHERE dodo_subscription_id = ?
          LIMIT 1`,
      )
      .get(subscriptionId) ?? null
  );
}

function recordCreditPackPayment(
  event: DodoWebhookEvent,
  billingEventId: number,
): "credit_recorded" | "ignored" {
  const userId = extractUserId(event.data) ?? findUserIdByEmail(extractEmail(event.data));
  if (!userId) return "ignored";

  const productId = extractProductId(event.data);
  const pack = creditPackForDodoProduct(productId);
  if (!pack) return "ignored";
  const paymentId = extractPaymentId(event.data);
  const checkoutSessionId = extractCheckoutSessionId(event.data);
  if (!paymentId && !checkoutSessionId) return "ignored";
  upsertBillingCustomer({
    userId,
    dodoCustomerId: extractCustomerId(event.data),
    email: extractEmail(event.data),
    metadata: event.data,
  });

  const result = recordCreditPurchase({
    userId,
    amountCents: pack.amountCents,
    dodoPaymentId: paymentId,
    dodoCheckoutSessionId: checkoutSessionId,
    billingEventId,
    description: pack.label,
    metadata: event.data,
  });
  return result.inserted ? "credit_recorded" : "ignored";
}

function recordPaymentAttempt(
  event: DodoWebhookEvent,
  known?: {
    userId?: number | null;
    plan?: PlanId | null;
    status?: string | null;
  },
): "payment_attempt_recorded" | "ignored" {
  const userId =
    known?.userId ??
    extractUserId(event.data) ??
    findUserIdByEmail(extractEmail(event.data));
  const productId = extractProductId(event.data);
  const plan = known?.plan ?? planIdForDodoProduct(productId);
  const checkoutSessionId =
    extractCheckoutSessionId(event.data) ??
    (event.type.startsWith("abandoned_checkout.") ? stringValue(event.data, "id") : null);
  const paymentId = event.type.startsWith("payment.") ? extractPaymentId(event.data) : null;
  const subscriptionId = event.type.startsWith("subscription.")
    ? extractSubscriptionId(event.data)
    : extractRelatedSubscriptionId(event.data);

  if (!userId && !paymentId && !checkoutSessionId && !subscriptionId) {
    return "ignored";
  }

  recordDodoPaymentAttempt({
    userId,
    dodoPaymentId: paymentId,
    dodoCheckoutSessionId: checkoutSessionId,
    dodoSubscriptionId: subscriptionId,
    dodoCustomerId: extractCustomerId(event.data),
    productId,
    intent: metadataString(event.data, "intent"),
    plan,
    status: known?.status ?? extractPaymentStatus(event),
    eventType: event.type,
    errorCode: extractErrorCode(event.data),
    errorMessage: extractErrorMessage(event.data),
    invoiceUrl: extractInvoiceUrl(event.data),
    receiptUrl: extractReceiptUrl(event.data),
    providerUpdatedAt: providerTimestampForEvent(event),
    rawPayload: event.data,
  });

  return "payment_attempt_recorded";
}

function syncSubscriptionFromSuccessfulPayment(event: DodoWebhookEvent): void {
  const productId = extractProductId(event.data);
  const plan = planIdForDodoProduct(productId);
  const subscriptionId = extractRelatedSubscriptionId(event.data);
  if (!plan || !subscriptionId) return;
  const userId = extractUserId(event.data) ?? findUserIdByEmail(extractEmail(event.data));
  if (!userId) return;

  upsertSubscriptionFromDodo({
    userId,
    plan,
    status: "active",
    dodoCustomerId: extractCustomerId(event.data),
    dodoSubscriptionId: subscriptionId,
    currentPeriodStart:
      stringValue(event.data, "current_period_start") ??
      stringValue(event.data, "billing_period_start"),
    currentPeriodEnd:
      stringValue(event.data, "current_period_end") ??
      stringValue(event.data, "next_billing_date") ??
      stringValue(event.data, "billing_period_end"),
    renewalDate:
      stringValue(event.data, "renewal_date") ??
      stringValue(event.data, "next_billing_date") ??
      stringValue(event.data, "current_period_end"),
    providerUpdatedAt: providerTimestampForEvent(event),
    rawPayload: event.data,
  });
  upsertBillingCustomer({
    userId,
    dodoCustomerId: extractCustomerId(event.data),
    email: extractEmail(event.data),
    metadata: event.data,
  });
}

function markWebhookProcessed(webhookId: string, action: string): void {
  db.prepare(
    `UPDATE dodo_webhook_events
        SET processing_status = ?,
            processed_at = datetime('now'),
            error = NULL
      WHERE webhook_id = ?`,
  ).run(action === "ignored" ? "ignored" : "processed", webhookId);
}

function markWebhookFailed(webhookId: string, error: string): void {
  db.prepare(
    `UPDATE dodo_webhook_events
        SET processing_status = 'failed',
            processed_at = datetime('now'),
            error = ?
      WHERE webhook_id = ?`,
  ).run(error.slice(0, 1000), webhookId);
}

function extractSubscriptionStatus(
  event: DodoWebhookEvent,
  existingStatus?: string | null,
): string {
  const fromPayload = stringValue(event.data, "status");
  if (fromPayload) return fromPayload;
  switch (event.type) {
    case "subscription.active":
    case "subscription.renewed":
      return "active";
    case "subscription.cancelled":
      return "cancelled";
    case "subscription.expired":
      return "expired";
    case "subscription.failed":
      return "failed";
    case "subscription.on_hold":
      return "on_hold";
    case "subscription.updated":
    case "subscription.plan_changed":
      return existingStatus ?? "unknown";
    default:
      return "unknown";
  }
}

function extractPaymentStatus(event: DodoWebhookEvent): string {
  const fromPayload = stringValue(event.data, "status");
  if (fromPayload) return fromPayload;
  switch (event.type) {
    case "payment.succeeded":
      return "succeeded";
    case "payment.failed":
      return "failed";
    case "payment.processing":
      return "processing";
    case "payment.cancelled":
      return "cancelled";
    case "abandoned_checkout.detected":
      return "abandoned";
    case "abandoned_checkout.recovered":
      return "recovered";
    default:
      return "unknown";
  }
}

function providerTimestampForEvent(event: DodoWebhookEvent): string | null {
  return (
    event.timestamp ??
    stringValue(event.data, "updated_at") ??
    stringValue(event.data, "created_at") ??
    null
  );
}

function extractResource(event: DodoWebhookEvent): {
  type: string | null;
  id: string | null;
} {
  if (event.type.startsWith("subscription.")) {
    return { type: "subscription", id: extractSubscriptionId(event.data) };
  }
  if (event.type.startsWith("payment.")) {
    return { type: "payment", id: extractPaymentId(event.data) };
  }
  return { type: null, id: null };
}

function extractUserId(data: JsonRecord): number | null {
  const raw =
    metadataString(data, "user_id") ??
    stringValue(data, "user_id") ??
    stringValue(data, "customer_user_id");
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function extractProductId(data: JsonRecord): string | null {
  return (
    stringValue(data, "product_id") ??
    stringValue(data, "productId") ??
    firstCartProductId(data)
  );
}

function firstCartProductId(data: JsonRecord): string | null {
  const cart = data.product_cart ?? data.products ?? data.items;
  if (!Array.isArray(cart)) return null;
  for (const item of cart) {
    if (!isRecord(item)) continue;
    const value = stringValue(item, "product_id") ?? stringValue(item, "productId");
    if (value) return value;
  }
  return null;
}

function extractCustomerId(data: JsonRecord): string | null {
  return (
    stringValue(data, "customer_id") ??
    stringValue(data, "customerId") ??
    stringValue(recordValue(data, "customer"), "customer_id") ??
    stringValue(recordValue(data, "customer"), "id")
  );
}

function extractSubscriptionId(data: JsonRecord): string | null {
  return stringValue(data, "subscription_id") ?? stringValue(data, "id");
}

function extractRelatedSubscriptionId(data: JsonRecord): string | null {
  return (
    stringValue(data, "subscription_id") ??
    stringValue(data, "subscriptionId") ??
    stringValue(recordValue(data, "subscription"), "subscription_id") ??
    stringValue(recordValue(data, "subscription"), "id")
  );
}

function extractPaymentId(data: JsonRecord): string | null {
  return stringValue(data, "payment_id") ?? stringValue(data, "id");
}

function extractCheckoutSessionId(data: JsonRecord): string | null {
  return (
    stringValue(data, "checkout_session_id") ??
    stringValue(data, "checkout_id") ??
    stringValue(data, "session_id")
  );
}

function extractErrorCode(data: JsonRecord): string | null {
  return (
    stringValue(data, "error_code") ??
    stringValue(data, "failure_code") ??
    stringValue(recordValue(data, "error"), "code")
  );
}

function extractErrorMessage(data: JsonRecord): string | null {
  return (
    stringValue(data, "error_message") ??
    stringValue(data, "failure_message") ??
    stringValue(data, "decline_message") ??
    stringValue(recordValue(data, "error"), "message")
  );
}

function extractInvoiceUrl(data: JsonRecord): string | null {
  return (
    stringValue(data, "invoice_url") ??
    stringValue(data, "invoice_pdf") ??
    stringValue(data, "invoice_pdf_url") ??
    stringValue(data, "hosted_invoice_url") ??
    stringValue(recordValue(data, "invoice"), "url") ??
    stringValue(recordValue(data, "invoice"), "invoice_url") ??
    stringValue(recordValue(data, "invoice"), "hosted_invoice_url")
  );
}

function extractReceiptUrl(data: JsonRecord): string | null {
  return (
    stringValue(data, "receipt_url") ??
    stringValue(data, "receipt_pdf") ??
    stringValue(data, "receipt_pdf_url") ??
    stringValue(recordValue(data, "receipt"), "url") ??
    stringValue(recordValue(data, "receipt"), "receipt_url")
  );
}

function extractEmail(data: JsonRecord): string | null {
  return (
    stringValue(data, "customer_email") ??
    stringValue(data, "email") ??
    stringValue(recordValue(data, "customer"), "email")
  );
}

function metadataString(data: JsonRecord, key: string): string | null {
  const metadata = recordValue(data, "metadata");
  return metadata ? stringValue(metadata, key) : null;
}

function findUserIdByEmail(email: string | null): number | null {
  if (!email) return null;
  const row =
    db
      .prepare<[string], Pick<UserRow, "id">>(
        `SELECT id FROM users WHERE LOWER(email) = LOWER(?)`,
      )
      .get(email) ?? null;
  return row?.id ?? null;
}

function recordValue(
  obj: JsonRecord | null | undefined,
  key: string,
): JsonRecord | null {
  if (!obj) return null;
  const value = obj[key];
  return isRecord(value) ? value : null;
}

function stringValue(
  obj: JsonRecord | null | undefined,
  key: string,
): string | null {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function booleanValue(
  obj: JsonRecord | null | undefined,
  key: string,
): boolean | null {
  if (!obj || !(key in obj)) return null;
  const value = obj[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
