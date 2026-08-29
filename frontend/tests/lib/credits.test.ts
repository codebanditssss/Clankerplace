import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-credits-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const credits = await import("../../src/lib/billing/credits");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (1, 'credits@test.local', 'x', 9001, datetime('now'))`,
).run();

test("credits: empty balance is initialized in cents", () => {
  const snapshot = credits.getCreditSnapshot(1);
  assert.equal(snapshot.balance_cents, 0);
  assert.equal(snapshot.balance_usd, "0.00");
  assert.equal(snapshot.currency, "usd");
});

test("credits: purchase updates balance and history", () => {
  const result = credits.recordCreditPurchase({
    userId: 1,
    amountCents: 2500,
    dodoPaymentId: "pay_1",
    dodoCheckoutSessionId: "cks_1",
  });
  assert.equal(result.inserted, true);
  assert.equal(result.balance_cents, 2500);

  const snapshot = credits.getCreditSnapshot(1);
  assert.equal(snapshot.balance_cents, 2500);
  assert.equal(snapshot.transactions.length, 1);
  assert.equal(snapshot.transactions[0].amount_cents, 2500);
});

test("credits: duplicate Dodo payment does not double-credit", () => {
  const result = credits.recordCreditPurchase({
    userId: 1,
    amountCents: 2500,
    dodoPaymentId: "pay_1",
    dodoCheckoutSessionId: "cks_1",
  });
  assert.equal(result.inserted, false);
  assert.equal(credits.getCreditSnapshot(1).balance_cents, 2500);
});

test("credits: non-positive purchase amounts are rejected", () => {
  assert.throws(() =>
    credits.recordCreditPurchase({
      userId: 1,
      amountCents: 0,
      dodoPaymentId: "pay_zero",
    }),
  );
});

test("credits: admin adjustment writes wallet transaction", () => {
  const result = credits.recordCreditAdjustment({
    userId: 1,
    amountCents: 500,
    adminUserId: 99,
    reason: "support credit",
  });
  assert.equal(result.balance_cents, 3000);

  const snapshot = credits.getCreditSnapshot(1);
  assert.equal(snapshot.balance_cents, 3000);
  assert.equal(snapshot.transactions[0].type, "admin_adjustment");
  assert.equal(snapshot.transactions[0].amount_cents, 500);
  assert.equal(snapshot.transactions[0].description, "support credit");
});

test("credits: admin adjustment cannot over-debit wallet", () => {
  assert.throws(() =>
    credits.recordCreditAdjustment({
      userId: 1,
      amountCents: -5000,
      adminUserId: 99,
      reason: "over debit",
    }),
  );
  assert.equal(credits.getCreditSnapshot(1).balance_cents, 3000);
});
