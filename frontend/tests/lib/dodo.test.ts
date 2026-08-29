import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomUUID } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "pods-dodo-"));
process.env.PODS_DB_PATH = join(dir, "test.db");
process.env.DODO_PAYMENTS_WEBHOOK_KEY = "whsec_test";
process.env.DODO_PRODUCT_DEVELOPER = "prod_dev";
process.env.DODO_PRODUCT_PRO = "prod_pro";
process.env.DODO_PRODUCT_SCALE = "prod_scale";
process.env.DODO_CREDIT_PACK_10 = "prod_credit_10";
process.env.DODO_CREDIT_PACK_25 = "prod_credit_25";
process.env.DODO_CREDIT_PACK_50 = "prod_credit_50";
process.env.DODO_CREDIT_PACK_100 = "prod_credit_100";

const db = (await import("../../src/lib/db")).default;
const dodo = await import("../../src/lib/billing/dodo");
const credits = await import("../../src/lib/billing/credits");
const customers = await import("../../src/lib/billing/customers");
const attempts = await import("../../src/lib/billing/payment-attempts");
const subs = await import("../../src/lib/billing/subscriptions");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (1, 'dodo@test.local', 'x', 9201, datetime('now'))`,
).run();
db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES
     (2, 'dodo-failed-payment@test.local', 'x', 9202, datetime('now')),
     (3, 'dodo-failed-subscription@test.local', 'x', 9203, datetime('now')),
     (4, 'dodo-success-payment@test.local', 'x', 9204, datetime('now')),
     (5, 'dodo-credit-only@test.local', 'x', 9205, datetime('now'))`,
).run();

function signed(rawBody: string) {
  const secret = "raw_test_secret";
  const webhookId = randomUUID();
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));
  const webhookSignature = createHmac("sha256", secret)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest("base64");
  return { secret, webhookId, webhookTimestamp, webhookSignature };
}

function signedWithStandardWebhookSecret(rawBody: string) {
  const secretBytes = Buffer.from("decoded-test-secret");
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const webhookId = randomUUID();
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));
  const webhookSignature = createHmac("sha256", secretBytes)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest("base64");
  return { secret, webhookId, webhookTimestamp, webhookSignature };
}

test("dodo: webhook signature verification accepts signed raw body", () => {
  const rawBody = JSON.stringify({ type: "payment.succeeded", data: {} });
  const sig = signed(rawBody);
  assert.equal(
    dodo.verifyDodoWebhookSignature({
      rawBody,
      webhookId: sig.webhookId,
      webhookTimestamp: sig.webhookTimestamp,
      webhookSignature: `v1,${sig.webhookSignature}`,
      secret: sig.secret,
    }),
    true,
  );
});

test("dodo: webhook signature verification accepts whsec encoded secrets", () => {
  const rawBody = JSON.stringify({ type: "payment.succeeded", data: {} });
  const sig = signedWithStandardWebhookSecret(rawBody);
  assert.equal(
    dodo.verifyDodoWebhookSignature({
      rawBody,
      webhookId: sig.webhookId,
      webhookTimestamp: sig.webhookTimestamp,
      webhookSignature: `v1,${sig.webhookSignature}`,
      secret: sig.secret,
    }),
    true,
  );
});

test("dodo: webhook signature verification rejects mutated body", () => {
  const rawBody = JSON.stringify({ type: "payment.succeeded", data: {} });
  const sig = signed(rawBody);
  assert.equal(
    dodo.verifyDodoWebhookSignature({
      rawBody: JSON.stringify({ type: "payment.succeeded", data: { changed: true } }),
      webhookId: sig.webhookId,
      webhookTimestamp: sig.webhookTimestamp,
      webhookSignature: `v1,${sig.webhookSignature}`,
      secret: sig.secret,
    }),
    false,
  );
});

test("dodo: subscription webhook syncs local subscription projection", () => {
  const rawBody = JSON.stringify({
    type: "subscription.active",
    timestamp: "2026-06-21T00:00:00Z",
    data: {
      subscription_id: "sub_123",
      customer_id: "cus_123",
      product_id: "prod_pro",
      status: "active",
      current_period_end: "2026-07-21T00:00:00Z",
      metadata: { user_id: "1", plan: "pro" },
    },
  });
  const event = dodo.parseDodoEvent(rawBody);
  const result = dodo.processDodoWebhook({
    webhookId: "wh_sub_1",
    rawBody,
    event,
  });

  assert.equal(result.ok, true);
  assert.equal(subs.getCurrentSubscription(1)?.plan, "pro");
  assert.equal(subs.getCurrentSubscription(1)?.status, "active");
});

test("dodo: subscription update syncs Dodo cancel-at-next-billing flag", () => {
  const rawBody = JSON.stringify({
    type: "subscription.updated",
    timestamp: "2026-06-22T00:00:00Z",
    data: {
      subscription_id: "sub_cancel_next",
      customer_id: "cus_cancel_next",
      product_id: "prod_pro",
      status: "active",
      cancel_at_next_billing_date: true,
      next_billing_date: "2026-07-22T00:00:00Z",
      metadata: { user_id: "1", plan: "pro" },
    },
  });
  const event = dodo.parseDodoEvent(rawBody);
  const result = dodo.processDodoWebhook({
    webhookId: "wh_sub_cancel_next",
    rawBody,
    event,
  });

  assert.equal(result.ok, true);
  const row = db
    .prepare(
      `SELECT cancel_at_period_end, renewal_date
         FROM subscriptions
        WHERE dodo_subscription_id = ?`,
    )
    .get("sub_cancel_next") as {
      cancel_at_period_end: number;
      renewal_date: string | null;
    };
  assert.equal(row.cancel_at_period_end, 1);
  assert.equal(row.renewal_date, "2026-07-22T00:00:00Z");
});

test("dodo: credit payment webhook records purchase once", () => {
  const rawBody = JSON.stringify({
    type: "payment.succeeded",
    timestamp: "2026-06-21T00:00:00Z",
    data: {
      payment_id: "pay_credit_1",
      checkout_session_id: "cks_credit_1",
      customer_id: "cus_credit_1",
      product_id: "prod_credit_100",
      metadata: { user_id: "1", intent: "credit_pack", credit_pack: "credit_100" },
    },
  });
  const event = dodo.parseDodoEvent(rawBody);
  const result = dodo.processDodoWebhook({
    webhookId: "wh_pay_1",
    rawBody,
    event,
  });
  const duplicate = dodo.processDodoWebhook({
    webhookId: "wh_pay_1",
    rawBody,
    event,
  });

  assert.equal(result.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(credits.getCreditSnapshot(1).balance_cents, 10000);
  assert.equal(customers.getBillingCustomerByUser(1)?.dodo_customer_id, "cus_credit_1");
});

test("dodo: credit payment without payment/session id is ignored", () => {
  const rawBody = JSON.stringify({
    type: "payment.succeeded",
    timestamp: "2026-06-21T00:00:00Z",
    data: {
      product_id: "prod_credit_10",
      metadata: { user_id: "1", intent: "credit_pack", credit_pack: "credit_10" },
    },
  });
  const event = dodo.parseDodoEvent(rawBody);
  const result = dodo.processDodoWebhook({
    webhookId: "wh_pay_missing_id",
    rawBody,
    event,
  });

  assert.equal(result.ok, true);
  assert.equal(credits.getCreditSnapshot(1).balance_cents, 10000);
});

test("dodo: duplicate credit payment attempts do not appear as subscription recovery", () => {
  const rawBody = JSON.stringify({
    type: "payment.succeeded",
    timestamp: "2026-06-22T00:00:00Z",
    data: {
      payment_id: "pay_credit_only",
      checkout_session_id: "cks_credit_only",
      customer_id: "cus_credit_only",
      product_id: "prod_credit_25",
      metadata: { user_id: "5", intent: "credit_pack", credit_pack: "credit_25" },
    },
  });
  const event = dodo.parseDodoEvent(rawBody);
  dodo.processDodoWebhook({
    webhookId: "wh_credit_only_1",
    rawBody,
    event,
  });
  dodo.processDodoWebhook({
    webhookId: "wh_credit_only_2",
    rawBody,
    event,
  });

  assert.equal(credits.getCreditSnapshot(5).balance_cents, 2500);
  assert.equal(
    attempts.getLatestDodoPaymentAttempt(5, { subscriptionOnly: true }),
    null,
  );
});

test("dodo: failed payment is stored for user-facing recovery", () => {
  const rawBody = JSON.stringify({
    type: "payment.failed",
    timestamp: "2026-06-23T00:00:00Z",
    data: {
      payment_id: "pay_failed_card",
      checkout_session_id: "cks_failed_card",
      customer_id: "cus_failed_card",
      subscription_id: "sub_failed_card",
      product_id: "prod_pro",
      status: "failed",
      error_code: "card_declined",
      error_message: "The card was declined.",
      metadata: { user_id: "2", intent: "subscription", plan: "pro" },
    },
  });
  const result = dodo.processDodoWebhook({
    webhookId: "wh_payment_failed_card",
    rawBody,
    event: dodo.parseDodoEvent(rawBody),
  });

  assert.equal(result.ok, true);
  const row = attempts.getLatestDodoPaymentAttempt(2, {
    subscriptionId: "sub_failed_card",
    plan: "pro",
  });
  assert.equal(row?.status, "failed");
  assert.equal(row?.error_code, "card_declined");
  assert.equal(row?.error_message, "The card was declined.");

  const untimestampedBody = JSON.stringify({
    type: "payment.processing",
    data: {
      payment_id: "pay_failed_card",
      checkout_session_id: "cks_failed_card",
      customer_id: "cus_failed_card",
      subscription_id: "sub_failed_card",
      product_id: "prod_pro",
      status: "processing",
      metadata: { user_id: "2", intent: "subscription", plan: "pro" },
    },
  });
  dodo.processDodoWebhook({
    webhookId: "wh_payment_failed_card_untimestamped",
    rawBody: untimestampedBody,
    event: dodo.parseDodoEvent(untimestampedBody),
  });
  const afterUntimestamped = attempts.getLatestDodoPaymentAttempt(2, {
    subscriptionId: "sub_failed_card",
    plan: "pro",
  });
  assert.equal(afterUntimestamped?.status, "failed");
});

test("dodo: subscription failed syncs blocked plan and recovery attempt", () => {
  const rawBody = JSON.stringify({
    type: "subscription.failed",
    timestamp: "2026-06-24T00:00:00Z",
    data: {
      subscription_id: "sub_failed_mandate",
      customer_id: "cus_failed_mandate",
      product_id: "prod_pro",
      status: "failed",
      error_code: "mandate_failed",
      error_message: "Unable to create mandate.",
      metadata: { user_id: "3", intent: "subscription", plan: "pro" },
    },
  });
  const result = dodo.processDodoWebhook({
    webhookId: "wh_subscription_failed_mandate",
    rawBody,
    event: dodo.parseDodoEvent(rawBody),
  });

  assert.equal(result.ok, true);
  const current = subs.getCurrentSubscription(3);
  assert.equal(current?.plan, "pro");
  assert.equal(current?.status, "failed");
  assert.equal(subs.canCreatePod(3).ok, false);
  const row = attempts.getLatestDodoPaymentAttempt(3, {
    subscriptionId: "sub_failed_mandate",
    plan: "pro",
  });
  assert.equal(row?.status, "failed");
  assert.equal(row?.error_message, "Unable to create mandate.");
});

test("dodo: subscription payment success can activate plan before subscription.active arrives", () => {
  const rawBody = JSON.stringify({
    type: "payment.succeeded",
    timestamp: "2026-06-25T00:00:00Z",
    data: {
      payment_id: "pay_sub_success",
      checkout_session_id: "cks_sub_success",
      customer_id: "cus_sub_success",
      subscription_id: "sub_sub_success",
      product_id: "prod_scale",
      status: "succeeded",
      metadata: { user_id: "4", intent: "subscription", plan: "scale" },
    },
  });
  const result = dodo.processDodoWebhook({
    webhookId: "wh_payment_sub_success",
    rawBody,
    event: dodo.parseDodoEvent(rawBody),
  });

  assert.equal(result.ok, true);
  const row = db
    .prepare("SELECT plan, status FROM subscriptions WHERE dodo_subscription_id = ?")
    .get("sub_sub_success") as { plan: string; status: string };
  assert.equal(row.plan, "scale");
  assert.equal(row.status, "active");
});

test("dodo: duplicate webhook id with different payload is rejected", () => {
  const rawBody = JSON.stringify({
    type: "payment.succeeded",
    data: {
      payment_id: "pay_replay_1",
      product_id: "prod_credit_10",
      metadata: { user_id: "1", credit_pack: "credit_10" },
    },
  });
  const event = dodo.parseDodoEvent(rawBody);
  const first = dodo.processDodoWebhook({
    webhookId: "wh_replay_guard",
    rawBody,
    event,
  });
  const mutatedBody = JSON.stringify({
    type: "payment.succeeded",
    data: {
      payment_id: "pay_replay_2",
      product_id: "prod_credit_100",
      metadata: { user_id: "1", credit_pack: "credit_100" },
    },
  });
  const replay = dodo.processDodoWebhook({
    webhookId: "wh_replay_guard",
    rawBody: mutatedBody,
    event: dodo.parseDodoEvent(mutatedBody),
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.status, 409);
});

test("dodo: stale subscription events do not overwrite newer status", () => {
  const cancelledBody = JSON.stringify({
    type: "subscription.cancelled",
    timestamp: "2026-07-21T00:00:00Z",
    data: {
      subscription_id: "sub_stale_guard",
      customer_id: "cus_stale_guard",
      product_id: "prod_pro",
      status: "cancelled",
      metadata: { user_id: "1", plan: "pro" },
    },
  });
  dodo.processDodoWebhook({
    webhookId: "wh_stale_cancelled",
    rawBody: cancelledBody,
    event: dodo.parseDodoEvent(cancelledBody),
  });

  const olderActiveBody = JSON.stringify({
    type: "subscription.active",
    timestamp: "2026-06-21T00:00:00Z",
    data: {
      subscription_id: "sub_stale_guard",
      customer_id: "cus_stale_guard",
      product_id: "prod_pro",
      status: "active",
      metadata: { user_id: "1", plan: "pro" },
    },
  });
  dodo.processDodoWebhook({
    webhookId: "wh_stale_active",
    rawBody: olderActiveBody,
    event: dodo.parseDodoEvent(olderActiveBody),
  });

  const row = db
    .prepare("SELECT status FROM subscriptions WHERE dodo_subscription_id = ?")
    .get("sub_stale_guard") as { status: string };
  assert.equal(row.status, "cancelled");
});

test("dodo: untimestamped subscription event does not overwrite timestamped state", () => {
  const cancelledBody = JSON.stringify({
    type: "subscription.cancelled",
    timestamp: "2026-07-21T00:00:00Z",
    data: {
      subscription_id: "sub_null_timestamp_guard",
      customer_id: "cus_null_timestamp_guard",
      product_id: "prod_pro",
      status: "cancelled",
      metadata: { user_id: "1", plan: "pro" },
    },
  });
  dodo.processDodoWebhook({
    webhookId: "wh_null_ts_cancelled",
    rawBody: cancelledBody,
    event: dodo.parseDodoEvent(cancelledBody),
  });

  const activeBody = JSON.stringify({
    type: "subscription.active",
    data: {
      subscription_id: "sub_null_timestamp_guard",
      customer_id: "cus_null_timestamp_guard",
      product_id: "prod_pro",
      status: "active",
      metadata: { user_id: "1", plan: "pro" },
    },
  });
  dodo.processDodoWebhook({
    webhookId: "wh_null_ts_active",
    rawBody: activeBody,
    event: dodo.parseDodoEvent(activeBody),
  });

  const row = db
    .prepare("SELECT status FROM subscriptions WHERE dodo_subscription_id = ?")
    .get("sub_null_timestamp_guard") as { status: string };
  assert.equal(row.status, "cancelled");
});

test("dodo: metadata-only subscription and credit entitlements are ignored", () => {
  const subscriptionBody = JSON.stringify({
    type: "subscription.active",
    timestamp: "2026-06-21T00:00:00Z",
    data: {
      subscription_id: "sub_metadata_only",
      customer_id: "cus_metadata_only",
      status: "active",
      metadata: { user_id: "1", plan: "enterprise" },
    },
  });
  const subResult = dodo.processDodoWebhook({
    webhookId: "wh_metadata_sub",
    rawBody: subscriptionBody,
    event: dodo.parseDodoEvent(subscriptionBody),
  });
  assert.equal(subResult.ok, true);
  const countRow = db
    .prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE dodo_subscription_id = ?")
    .get("sub_metadata_only") as { c: number };
  assert.equal(countRow.c, 0);

  const before = credits.getCreditSnapshot(1).balance_cents;
  const creditBody = JSON.stringify({
    type: "payment.succeeded",
    timestamp: "2026-06-21T00:00:00Z",
    data: {
      payment_id: "pay_metadata_only",
      checkout_session_id: "cks_metadata_only",
      metadata: { user_id: "1", credit_pack: "credit_100" },
    },
  });
  const creditResult = dodo.processDodoWebhook({
    webhookId: "wh_metadata_credit",
    rawBody: creditBody,
    event: dodo.parseDodoEvent(creditBody),
  });
  assert.equal(creditResult.ok, true);
  assert.equal(credits.getCreditSnapshot(1).balance_cents, before);
});

test("dodo: existing subscription lifecycle can sync without product metadata", () => {
  const activeBody = JSON.stringify({
    type: "subscription.active",
    timestamp: "2026-06-21T00:00:00Z",
    data: {
      subscription_id: "sub_lifecycle_no_product",
      customer_id: "cus_lifecycle_no_product",
      product_id: "prod_scale",
      status: "active",
      metadata: { user_id: "1", plan: "scale" },
    },
  });
  dodo.processDodoWebhook({
    webhookId: "wh_lifecycle_no_product_active",
    rawBody: activeBody,
    event: dodo.parseDodoEvent(activeBody),
  });

  const cancelledBody = JSON.stringify({
    type: "subscription.cancelled",
    timestamp: "2026-07-21T00:00:00Z",
    data: {
      subscription_id: "sub_lifecycle_no_product",
      status: "cancelled",
    },
  });
  const result = dodo.processDodoWebhook({
    webhookId: "wh_lifecycle_no_product_cancelled",
    rawBody: cancelledBody,
    event: dodo.parseDodoEvent(cancelledBody),
  });

  assert.equal(result.ok, true);
  const row = db
    .prepare(
      `SELECT plan, status, dodo_customer_id
         FROM subscriptions
        WHERE dodo_subscription_id = ?`,
    )
    .get("sub_lifecycle_no_product") as {
      plan: string;
      status: string;
      dodo_customer_id: string | null;
    };
  assert.equal(row.plan, "scale");
  assert.equal(row.status, "cancelled");
  assert.equal(row.dodo_customer_id, "cus_lifecycle_no_product");
});

test("dodo: unknown subscription event without status remains blocked", () => {
  const rawBody = JSON.stringify({
    type: "subscription.some_future_event",
    timestamp: "2026-06-21T00:00:00Z",
    data: {
      subscription_id: "sub_unknown_status",
      customer_id: "cus_unknown_status",
      product_id: "prod_scale",
      metadata: { user_id: "1", plan: "scale" },
    },
  });
  const result = dodo.processDodoWebhook({
    webhookId: "wh_unknown_status",
    rawBody,
    event: dodo.parseDodoEvent(rawBody),
  });

  assert.equal(result.ok, true);
  const row = db
    .prepare("SELECT status FROM subscriptions WHERE dodo_subscription_id = ?")
    .get("sub_unknown_status") as { status: string };
  assert.equal(row.status, "unknown");
});
