import "server-only";
import db, { type DodoPaymentAttemptRow } from "@/lib/db";

export type DodoPaymentAttemptInput = {
  userId?: number | null;
  dodoPaymentId?: string | null;
  dodoCheckoutSessionId?: string | null;
  dodoSubscriptionId?: string | null;
  dodoCustomerId?: string | null;
  productId?: string | null;
  intent?: string | null;
  plan?: string | null;
  status: string;
  eventType: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  invoiceUrl?: string | null;
  receiptUrl?: string | null;
  providerUpdatedAt?: string | null;
  rawPayload?: unknown;
};

export function recordDodoPaymentAttempt(input: DodoPaymentAttemptInput): void {
  const existing = findExistingAttempt(input);
  if (existing && isStaleProviderUpdate(input.providerUpdatedAt, existing.provider_updated_at)) {
    return;
  }

  const payload = input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload);
  if (existing) {
    db.prepare(
      `UPDATE dodo_payment_attempts
          SET user_id = COALESCE(?, user_id),
              dodo_payment_id = COALESCE(?, dodo_payment_id),
              dodo_checkout_session_id = COALESCE(?, dodo_checkout_session_id),
              dodo_subscription_id = COALESCE(?, dodo_subscription_id),
              dodo_customer_id = COALESCE(?, dodo_customer_id),
              product_id = COALESCE(?, product_id),
              intent = COALESCE(?, intent),
              plan = COALESCE(?, plan),
              status = ?,
              event_type = ?,
              error_code = ?,
              error_message = ?,
              invoice_url = COALESCE(?, invoice_url),
              receipt_url = COALESCE(?, receipt_url),
              provider_updated_at = COALESCE(?, provider_updated_at),
              raw_payload_json = COALESCE(?, raw_payload_json),
              updated_at = datetime('now')
        WHERE id = ?`,
    ).run(
      input.userId ?? null,
      input.dodoPaymentId ?? null,
      input.dodoCheckoutSessionId ?? null,
      input.dodoSubscriptionId ?? null,
      input.dodoCustomerId ?? null,
      input.productId ?? null,
      input.intent ?? null,
      input.plan ?? null,
      normalizeStatus(input.status),
      input.eventType,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.invoiceUrl ?? null,
      input.receiptUrl ?? null,
      input.providerUpdatedAt ?? null,
      payload,
      existing.id,
    );
    return;
  }

  db.prepare(
    `INSERT INTO dodo_payment_attempts (
       user_id,
       dodo_payment_id,
       dodo_checkout_session_id,
       dodo_subscription_id,
       dodo_customer_id,
       product_id,
       intent,
       plan,
       status,
       event_type,
       error_code,
       error_message,
       invoice_url,
       receipt_url,
       provider_updated_at,
       raw_payload_json,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    input.userId ?? null,
    input.dodoPaymentId ?? null,
    input.dodoCheckoutSessionId ?? null,
    input.dodoSubscriptionId ?? null,
    input.dodoCustomerId ?? null,
    input.productId ?? null,
    input.intent ?? null,
    input.plan ?? null,
    normalizeStatus(input.status),
    input.eventType,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    input.invoiceUrl ?? null,
    input.receiptUrl ?? null,
    input.providerUpdatedAt ?? null,
    payload,
  );
}

export function getLatestDodoPaymentAttempt(
  userId: number,
  opts: {
    subscriptionId?: string | null;
    plan?: string | null;
    subscriptionOnly?: boolean;
  } = {},
): DodoPaymentAttemptRow | null {
  const subscriptionWhere = opts.subscriptionOnly
    ? "AND (plan IS NOT NULL OR intent = 'subscription' OR dodo_subscription_id IS NOT NULL)"
    : "";

  if (opts.subscriptionId) {
    const row =
      db
        .prepare<[number, string], DodoPaymentAttemptRow>(
          `SELECT *
             FROM dodo_payment_attempts
            WHERE user_id = ? AND dodo_subscription_id = ?
              ${subscriptionWhere}
            ORDER BY updated_at DESC, id DESC
            LIMIT 1`,
        )
        .get(userId, opts.subscriptionId) ?? null;
    if (row) return row;
  }

  if (opts.plan) {
    const row =
      db
        .prepare<[number, string], DodoPaymentAttemptRow>(
          `SELECT *
             FROM dodo_payment_attempts
            WHERE user_id = ? AND plan = ?
              ${subscriptionWhere}
            ORDER BY updated_at DESC, id DESC
            LIMIT 1`,
        )
        .get(userId, opts.plan) ?? null;
    if (row) return row;
  }

  return (
    db
      .prepare<[number], DodoPaymentAttemptRow>(
        `SELECT *
           FROM dodo_payment_attempts
          WHERE user_id = ?
            ${subscriptionWhere}
          ORDER BY updated_at DESC, id DESC
          LIMIT 1`,
      )
      .get(userId) ?? null
  );
}

function findExistingAttempt(
  input: DodoPaymentAttemptInput,
): Pick<DodoPaymentAttemptRow, "id" | "provider_updated_at"> | null {
  const paymentId = clean(input.dodoPaymentId);
  let paymentRow: Pick<DodoPaymentAttemptRow, "id" | "provider_updated_at"> | null = null;
  if (paymentId) {
    paymentRow =
      db
        .prepare<[string], Pick<DodoPaymentAttemptRow, "id" | "provider_updated_at">>(
          `SELECT id, provider_updated_at
             FROM dodo_payment_attempts
            WHERE dodo_payment_id = ?
            LIMIT 1`,
        )
        .get(paymentId) ?? null;
  }

  const checkoutId = clean(input.dodoCheckoutSessionId);
  let checkoutRow: Pick<DodoPaymentAttemptRow, "id" | "provider_updated_at"> | null = null;
  if (checkoutId) {
    checkoutRow =
      db
        .prepare<[string], Pick<DodoPaymentAttemptRow, "id" | "provider_updated_at">>(
          `SELECT id, provider_updated_at
             FROM dodo_payment_attempts
            WHERE dodo_checkout_session_id = ?
            LIMIT 1`,
        )
        .get(checkoutId) ?? null;
  }

  if (paymentRow && checkoutRow && paymentRow.id !== checkoutRow.id) {
    // Dodo can emit an abandoned-checkout event before a payment event. Once
    // the payment id arrives, keep one row so later updates cannot violate
    // the partial unique indexes on payment_id / checkout_session_id.
    db.prepare(`DELETE FROM dodo_payment_attempts WHERE id = ?`).run(checkoutRow.id);
    return paymentRow;
  }
  if (paymentRow) return paymentRow;
  if (checkoutRow) return checkoutRow;

  const subscriptionId = clean(input.dodoSubscriptionId);
  if (subscriptionId) {
    return (
      db
        .prepare<[string], Pick<DodoPaymentAttemptRow, "id" | "provider_updated_at">>(
          `SELECT id, provider_updated_at
             FROM dodo_payment_attempts
            WHERE dodo_subscription_id = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1`,
        )
        .get(subscriptionId) ?? null
    );
  }

  return null;
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase() || "unknown";
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isStaleProviderUpdate(next: string | null | undefined, current: string | null): boolean {
  if (!current) return false;
  if (!next) return true;
  const nextTs = Date.parse(next);
  const currentTs = Date.parse(current);
  if (Number.isNaN(nextTs) || Number.isNaN(currentTs)) return false;
  return nextTs < currentTs;
}
