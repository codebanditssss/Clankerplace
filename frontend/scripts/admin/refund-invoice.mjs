#!/usr/bin/env node
// Admin refund tool: send the funds sitting on a per-invoice deposit
// address back to the original payer. Use cases:
//
//   - User accidentally underpaid → refund whatever they sent
//   - User overpaid → refund the excess (currently this script sends
//     the FULL deposit balance back; for partial refunds, sweep first
//     then transfer manually from treasury)
//   - You want to undo a confirmed-but-unswept payment → refund + the
//     credit-ledger entry is reversed
//
// Usage:
//   pnpm admin:refund <invoice-id> [payer-address]
//
// If payer-address is omitted, the script uses invoice.payer_address
// (set by the confirm path when we detected the payment). Provide the
// override only when the recorded payer isn't where you want the refund
// to go — e.g. customer paid from an exchange wallet and wants it on a
// different address.
//
// Restrictions:
//   - Invoice must NOT be 'pending' (let the reconciler do its job)
//   - Invoice must NOT be 'swept' (funds already in treasury — no key
//     left to sign with). For swept refunds you have to send manually
//     from your treasury wallet (Phantom → Send → payer address).
//   - Per-invoice keypair must still be 'live' (not yet wiped).
//
// Side effects:
//   - Sends a SystemProgram.transfer (or SPL TransferChecked) from the
//     deposit address to the payer (or override).
//   - Sets invoices.refund_tx_signature.
//   - Wipes invoice_keypairs.ciphertext_hex (key destroyed).
//   - If invoice status was 'confirmed' or 'overpaid' (had ledger
//     credit), inserts a NEGATIVE ledger entry reversing the credit.

import Database from "better-sqlite3";
import { createDecipheriv } from "node:crypto";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";

const invoiceId = process.argv[2];
const payerOverride = process.argv[3];
if (!invoiceId) {
  console.error("usage: pnpm admin:refund <invoice-id> [payer-address]");
  process.exit(1);
}

const DB_PATH = process.env.PODS_DB_PATH || resolve("data/pods.db");
const masterKeyHex = process.env.INVOICE_KEY_ENCRYPTION_KEY;
const rpcUrl = process.env.SOLANA_RPC_URL;
const cluster = process.env.SOLANA_CLUSTER ?? "devnet";

if (!masterKeyHex || !/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
  console.error("INVOICE_KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  process.exit(1);
}
if (!rpcUrl) {
  console.error("SOLANA_RPC_URL must be set");
  process.exit(1);
}

const db = new Database(DB_PATH);

const inv = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId);
if (!inv) {
  console.error(`invoice ${invoiceId} not found`);
  process.exit(1);
}
const kp = db
  .prepare(`SELECT * FROM invoice_keypairs WHERE invoice_id = ?`)
  .get(invoiceId);
if (!kp) {
  console.error(`no keypair row for invoice ${invoiceId}`);
  process.exit(1);
}
if (kp.wiped_at != null || kp.ciphertext_hex == null) {
  console.error(`keypair was wiped at unix=${kp.wiped_at} — cannot refund automatically.`);
  console.error("If funds were already swept, refund manually from your treasury wallet.");
  process.exit(1);
}
if (inv.status === "pending") {
  console.error("invoice is still 'pending' — wait for it to confirm or expire");
  process.exit(1);
}
if (inv.status === "swept") {
  console.error("invoice already swept — no key available; refund manually from treasury");
  process.exit(1);
}
if (inv.refund_tx_signature) {
  console.error(`already refunded — refund_tx_signature=${inv.refund_tx_signature}`);
  process.exit(1);
}

const recipient = payerOverride || inv.payer_address;
if (!recipient) {
  console.error("no payer_address recorded on this invoice — provide one as the second arg");
  process.exit(1);
}

console.log(`Refunding invoice ${invoiceId}`);
console.log(`  status:           ${inv.status}`);
console.log(`  currency:         ${inv.currency}`);
console.log(`  deposit address:  ${inv.deposit_address}`);
console.log(`  refund to:        ${recipient}${payerOverride ? " (override)" : " (from invoice.payer_address)"}`);
console.log(`  cluster:          ${cluster}`);
console.log();

// Decrypt the keypair.
const iv = Buffer.from(kp.iv_hex, "hex");
const tag = Buffer.from(kp.auth_tag_hex, "hex");
const ct = Buffer.from(kp.ciphertext_hex, "hex");
const dec = createDecipheriv("aes-256-gcm", Buffer.from(masterKeyHex, "hex"), iv, {
  authTagLength: 16,
});
dec.setAuthTag(tag);
let secret;
try {
  secret = Buffer.concat([dec.update(ct), dec.final()]);
} catch (err) {
  console.error("decryption failed:", err.message);
  process.exit(1);
}
const keypair = Keypair.fromSecretKey(new Uint8Array(secret));
if (keypair.publicKey.toBase58() !== inv.deposit_address) {
  console.error(`decrypted pubkey mismatch — abort`);
  process.exit(1);
}
console.log(`✓ keypair decrypted, matches deposit address`);

const conn = new Connection(rpcUrl, "confirmed");
const balance = await conn.getBalance(keypair.publicKey);
console.log(`✓ on-chain SOL balance: ${balance / 1e9} SOL`);

if (inv.currency === "SOL") {
  if (balance < 10_000) {
    console.error(`balance ${balance} too low to cover fee (~5000 lamports)`);
    process.exit(1);
  }
  const amount = balance - 5_000;
  console.log(`Refunding ${amount / 1e9} SOL to ${recipient}...`);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(recipient),
      lamports: amount,
    }),
  );
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.sign(keypair);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`✓ refunded ${amount / 1e9} SOL`);
  console.log(`  tx: https://explorer.solana.com/tx/${sig}?cluster=${cluster}`);
  finalizeRefund(sig);
  process.exit(0);
}

// SPL token refund.
const MINTS = {
  USDC: {
    "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
  USDT: {
    "mainnet-beta": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    devnet: null,
  },
};
const mintAddr = MINTS[inv.currency]?.[cluster];
if (!mintAddr) {
  console.error(`${inv.currency} not supported on ${cluster}`);
  process.exit(1);
}
const mint = new PublicKey(mintAddr);
const decimals = 6;
const sourceAta = await getAssociatedTokenAddress(mint, keypair.publicKey);
const destAta = await getAssociatedTokenAddress(mint, new PublicKey(recipient));

let sourceBalance;
try {
  const acc = await getAccount(conn, sourceAta, "confirmed");
  sourceBalance = acc.amount;
} catch (err) {
  if (err instanceof TokenAccountNotFoundError) {
    console.error(`no ${inv.currency} token account on deposit — nothing to refund`);
    process.exit(1);
  }
  throw err;
}
try {
  await getAccount(conn, destAta, "confirmed");
} catch (err) {
  if (err instanceof TokenAccountNotFoundError) {
    console.error(
      `payer ${recipient} has no ${inv.currency} ATA. They need to receive 1 ${inv.currency} from any wallet first to create the ATA, then re-run this refund.`,
    );
    process.exit(1);
  }
  throw err;
}
console.log(`Refunding ${Number(sourceBalance) / 10 ** decimals} ${inv.currency} to ${recipient}...`);
const tx = new Transaction().add(
  createTransferCheckedInstruction(
    sourceAta,
    mint,
    destAta,
    keypair.publicKey,
    sourceBalance,
    decimals,
  ),
);
const { blockhash } = await conn.getLatestBlockhash("confirmed");
tx.recentBlockhash = blockhash;
tx.feePayer = keypair.publicKey;
tx.sign(keypair);
const sig = await conn.sendRawTransaction(tx.serialize());
await conn.confirmTransaction(sig, "confirmed");
console.log(`✓ refunded ${Number(sourceBalance) / 10 ** decimals} ${inv.currency}`);
console.log(`  tx: https://explorer.solana.com/tx/${sig}?cluster=${cluster}`);
finalizeRefund(sig);

function finalizeRefund(sig) {
  const now = Math.floor(Date.now() / 1000);
  // 1. Record refund signature + wipe key.
  db.prepare(
    `UPDATE invoices SET refund_tx_signature = ?, updated_at = ? WHERE id = ?`,
  ).run(sig, now, invoiceId);
  db.prepare(
    `UPDATE invoice_keypairs SET ciphertext_hex = NULL, wiped_at = ? WHERE invoice_id = ?`,
  ).run(now, invoiceId);

  // 2. If the invoice had a ledger credit (confirmed/overpaid status),
  //    reverse it with a negative ledger entry.
  if (inv.status === "confirmed" || inv.status === "overpaid") {
    const existingCredit = db
      .prepare(
        `SELECT delta_cents FROM credit_ledger WHERE ref_invoice_id = ? AND reason = 'invoice_credit'`,
      )
      .get(invoiceId);
    if (existingCredit && existingCredit.delta_cents > 0) {
      db.prepare(
        `INSERT INTO credit_ledger (user_id, delta_cents, reason, ref_invoice_id, note, ts)
         VALUES (?, ?, 'refund', ?, ?, ?)`,
      ).run(
        inv.user_id,
        -Math.abs(existingCredit.delta_cents),
        invoiceId,
        `auto-refund via admin:refund`,
        now,
      );
      console.log(
        `✓ reversed ledger credit of $${(existingCredit.delta_cents / 100).toFixed(2)} (added -$${(existingCredit.delta_cents / 100).toFixed(2)} entry)`,
      );
    }
  }
  console.log(`✓ DB updated: refund_tx_signature recorded, key wiped`);
}
