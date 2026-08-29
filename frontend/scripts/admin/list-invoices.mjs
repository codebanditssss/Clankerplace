#!/usr/bin/env node
// Admin tool: print every invoice + its deposit wallet + status + payment
// + sweep info. Run: `pnpm admin:invoices` (added in package.json).
//
// Safe — read-only. Does NOT touch private keys (they're encrypted in
// ciphertext form anyway, useless without the master key).
//
// Use this to:
//   - audit what's pending / confirmed / swept / underpaid / failed
//   - find a specific invoice's deposit address
//   - see how much you've received total

import Database from "better-sqlite3";
import { resolve } from "node:path";

const DB_PATH = process.env.PODS_DB_PATH || resolve("data/pods.db");
const db = new Database(DB_PATH, { readonly: true });

const PAD = (s, n, right = false) => {
  const str = String(s ?? "");
  if (str.length >= n) return str.slice(0, n);
  return right ? str.padStart(n) : str.padEnd(n);
};

const fmtMoney = (cents) => `$${(cents / 100).toFixed(2)}`;
const fmtAmount = (amount, currency) => {
  const dec = currency === "SOL" ? 9 : 6;
  return `${(Number(amount) / 10 ** dec).toFixed(dec === 9 ? 6 : 2)} ${currency}`;
};
const fmtTime = (unix) =>
  unix ? new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19) : "—";
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const shortSig = (s) => (s ? `${s.slice(0, 8)}…${s.slice(-4)}` : "—");

const summary = db
  .prepare(
    `SELECT status, COUNT(*) AS n, COALESCE(SUM(usd_amount_cents), 0) AS cents
     FROM invoices
     GROUP BY status
     ORDER BY status`,
  )
  .all();

console.log("\n=== INVOICE SUMMARY ===\n");
if (summary.length === 0) {
  console.log("No invoices yet.");
} else {
  console.log(PAD("status", 12) + PAD("count", 8, true) + PAD("total USD", 14, true));
  console.log("-".repeat(34));
  let totalN = 0;
  let totalC = 0;
  for (const row of summary) {
    console.log(
      PAD(row.status, 12) +
        PAD(row.n, 8, true) +
        PAD(fmtMoney(row.cents), 14, true),
    );
    totalN += row.n;
    totalC += row.cents;
  }
  console.log("-".repeat(34));
  console.log(
    PAD("TOTAL", 12) + PAD(totalN, 8, true) + PAD(fmtMoney(totalC), 14, true),
  );
}

console.log("\n=== ALL INVOICES (newest first, max 50) ===\n");
const rows = db
  .prepare(
    `SELECT id, user_id, status, currency, usd_amount_cents, token_amount,
            deposit_address, payment_tx_signature, sweep_tx_signature,
            created_at, confirmed_at, swept_at, failed_reason
       FROM invoices
       ORDER BY created_at DESC
       LIMIT 50`,
  )
  .all();

if (rows.length === 0) {
  console.log("No invoices found.");
} else {
  console.log(
    PAD("id", 10) +
      PAD("uid", 5) +
      PAD("status", 11) +
      PAD("amount", 18) +
      PAD("deposit", 14) +
      PAD("created", 21) +
      PAD("paid", 10) +
      PAD("swept", 10),
  );
  console.log("-".repeat(100));
  for (const r of rows) {
    console.log(
      PAD(r.id.slice(0, 8), 10) +
        PAD(r.user_id, 5) +
        PAD(r.status, 11) +
        PAD(`${fmtMoney(r.usd_amount_cents)} / ${fmtAmount(r.token_amount, r.currency)}`, 18) +
        PAD(shortAddr(r.deposit_address), 14) +
        PAD(fmtTime(r.created_at), 21) +
        PAD(shortSig(r.payment_tx_signature), 10) +
        PAD(shortSig(r.sweep_tx_signature), 10),
    );
    if (r.failed_reason) {
      console.log("  └─ failed_reason:", r.failed_reason);
    }
  }
}

console.log("\n=== UNSWEPT (money is still on the per-invoice address) ===\n");
const unswept = db
  .prepare(
    `SELECT i.id, i.status, i.currency, i.token_amount, i.deposit_address,
            CASE WHEN k.wiped_at IS NULL AND k.ciphertext_hex IS NOT NULL
                 THEN 'live'
                 ELSE 'wiped'
            END AS key_state
       FROM invoices i
       LEFT JOIN invoice_keypairs k ON k.invoice_id = i.id
       WHERE i.status IN ('confirmed','underpaid','overpaid','failed')
       ORDER BY i.created_at DESC`,
  )
  .all();
if (unswept.length === 0) {
  console.log("None. All payments either swept to treasury or never received.");
} else {
  for (const r of unswept) {
    console.log(
      `  ${r.id.slice(0, 8)}  ${PAD(r.status, 10)} ${fmtAmount(r.token_amount, r.currency)}  ` +
        `deposit=${r.deposit_address}  key=${r.key_state}`,
    );
  }
  console.log(
    `\n  ↑ run \`pnpm admin:recover <invoice-id>\` to manually sweep one of these.`,
  );
}

console.log("\n=== CREDIT LEDGER (last 20 entries) ===\n");
const ledger = db
  .prepare(
    `SELECT id, user_id, delta_cents, reason, ref_invoice_id, ts
       FROM credit_ledger
       ORDER BY ts DESC, id DESC
       LIMIT 20`,
  )
  .all();
if (ledger.length === 0) {
  console.log("No ledger entries.");
} else {
  for (const r of ledger) {
    const sign = r.delta_cents >= 0 ? "+" : "-";
    const amt = sign + fmtMoney(Math.abs(r.delta_cents));
    console.log(
      `  ${fmtTime(r.ts)}  uid=${r.user_id}  ${PAD(amt, 8)} ${PAD(r.reason, 20)} ${r.ref_invoice_id ? "inv=" + r.ref_invoice_id.slice(0, 8) : ""}`,
    );
  }
}

console.log(
  "\nTreasury address: " + (process.env.SOLANA_TREASURY_ADDRESS ?? "(not set)"),
);
console.log(
  `Check on-chain balance: https://explorer.solana.com/address/${process.env.SOLANA_TREASURY_ADDRESS}?cluster=${process.env.SOLANA_CLUSTER ?? "devnet"}`,
);
console.log();
