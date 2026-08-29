import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-test-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const ledger = await import("../../src/lib/billing/ledger");

// Seed a fake user so foreign keys hold.
db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (1, 'a@test.local', 'x', 99, datetime('now'))`,
).run();
db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (2, 'b@test.local', 'x', 100, datetime('now'))`,
).run();
// Seed an invoice row so creditInvoice can reference it.
db.prepare(
  `INSERT INTO invoices (
    id, user_id, usd_amount_cents, currency, token_amount,
    deposit_address, treasury_address, price_quote_usd,
    quote_expires_at, status, created_at, updated_at
  ) VALUES (?, 1, 2500, 'SOL', '0', 'D1eposit', 'T1reasury', '200', 9999999999, 'pending', 0, 0)`,
).run("inv-1");

test("ledger: empty balance is zero", () => {
  assert.equal(ledger.getBalanceCents(1), 0);
});

test("ledger: insert + balance reflects sum", () => {
  ledger.insertLedger({
    userId: 1,
    delta_cents: 2500,
    reason: "promo",
    note: "signup bonus",
  });
  assert.equal(ledger.getBalanceCents(1), 2500);
});

test("ledger: balances are per-user", () => {
  assert.equal(ledger.getBalanceCents(2), 0);
});

test("ledger: creditInvoice is idempotent — second call raises UNIQUE", () => {
  ledger.creditInvoice({ invoiceId: "inv-1", userId: 1, usdAmountCents: 2500 });
  assert.throws(
    () =>
      ledger.creditInvoice({
        invoiceId: "inv-1",
        userId: 1,
        usdAmountCents: 2500,
      }),
    /UNIQUE/i,
  );
  // Net balance: 2500 promo + 2500 invoice = 5000
  assert.equal(ledger.getBalanceCents(1), 5000);
});

test("ledger: refund uses negative delta", () => {
  ledger.refundInvoice({
    invoiceId: "inv-1",
    userId: 1,
    usdAmountCents: 2500,
  });
  // 5000 - 2500 = 2500
  assert.equal(ledger.getBalanceCents(1), 2500);
});

test("ledger: refund does NOT collide with invoice_credit unique index", () => {
  // Two refunds for the same invoice are allowed.
  ledger.insertLedger({
    userId: 1,
    delta_cents: -100,
    reason: "refund",
    ref_invoice_id: "inv-1",
  });
  ledger.insertLedger({
    userId: 1,
    delta_cents: -100,
    reason: "refund",
    ref_invoice_id: "inv-1",
  });
  assert.equal(ledger.getBalanceCents(1), 2300);
});

test("ledger: zero delta rejected", () => {
  assert.throws(() =>
    ledger.insertLedger({ userId: 1, delta_cents: 0, reason: "promo" }),
  );
});

test("ledger: listRecent returns rows in reverse-chronological order", () => {
  const rows = ledger.listRecent(1, 10);
  assert.equal(rows.length > 0, true);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].ts >= rows[i].ts);
  }
});
