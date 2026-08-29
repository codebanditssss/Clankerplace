#!/usr/bin/env node
// Admin tool: decrypt and print the per-invoice deposit keypair so you
// can inspect, import into Phantom/Solflare, or move funds manually.
//
// Usage:
//   pnpm admin:inspect-key <invoice-id>
//
// ⚠ SECURITY WARNING — printing a private key to your terminal exposes it
// to anyone who can see the screen / your shell history / your terminal
// logs. Use only for debugging, never paste the output anywhere.
//
// What it prints:
//   - The public address (same as in admin:invoices)
//   - The secret key in base58 (Phantom "Import Private Key" format)
//   - The secret key as a JSON byte array (Solana CLI keypair file format)
//
// Refuses to run if the key was already wiped (post-sweep). For that
// case, the key is mathematically gone — nothing to inspect.

import Database from "better-sqlite3";
import { createDecipheriv } from "node:crypto";
import { resolve } from "node:path";
import bs58 from "bs58";

const invoiceId = process.argv[2];
if (!invoiceId) {
  console.error("usage: pnpm admin:inspect-key <invoice-id>");
  console.error("(run `pnpm admin:invoices` to see ids)");
  process.exit(1);
}

const DB_PATH = process.env.PODS_DB_PATH || resolve("data/pods.db");
const masterKeyHex = process.env.INVOICE_KEY_ENCRYPTION_KEY;
if (!masterKeyHex || !/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
  console.error("INVOICE_KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

const inv = db
  .prepare(`SELECT id, status, currency, deposit_address FROM invoices WHERE id = ?`)
  .get(invoiceId);
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
  console.error(
    `keypair for invoice ${invoiceId} was wiped at unix=${kp.wiped_at}.`,
  );
  console.error("The private key was destroyed after sweep — it cannot be recovered.");
  process.exit(1);
}

const iv = Buffer.from(kp.iv_hex, "hex");
const tag = Buffer.from(kp.auth_tag_hex, "hex");
const ct = Buffer.from(kp.ciphertext_hex, "hex");
const decipher = createDecipheriv("aes-256-gcm", Buffer.from(masterKeyHex, "hex"), iv, {
  authTagLength: 16,
});
decipher.setAuthTag(tag);
let secret;
try {
  secret = Buffer.concat([decipher.update(ct), decipher.final()]);
} catch (err) {
  console.error("decryption failed (master key mismatch?):", err.message);
  process.exit(1);
}
if (secret.length !== 64) {
  console.error(`decrypted secret has unexpected length ${secret.length}`);
  process.exit(1);
}

const secretBytes = new Uint8Array(secret);
const secretBase58 = bs58.encode(secretBytes);
// Phantom "Import Private Key" wants the FIRST 32 bytes (the seed), not all 64.
// Solflare accepts both formats. Print both so you can use either.
const seedBase58 = bs58.encode(secretBytes.slice(0, 32));
const jsonArray = JSON.stringify(Array.from(secretBytes));

console.log(`
Invoice:     ${inv.id}
Status:      ${inv.status}
Currency:    ${inv.currency}

⚠  EVERYTHING BELOW IS SENSITIVE — TREAT IT LIKE A PASSWORD ⚠

Public address (deposit_address):
  ${inv.deposit_address}

Verify decryption matched: ${
  inv.deposit_address === bs58.encode(secretBytes.slice(32))
    ? "✓ ok"
    : "✗ MISMATCH — abort"
}

Private key (Phantom 'Import Private Key' format — 32-byte seed, base58):
  ${seedBase58}

Full ed25519 keypair (Solflare 'Import' format — 64-byte secret, base58):
  ${secretBase58}

Solana CLI keypair file (write to e.g. inspect-${invoiceId.slice(0, 8)}.json):
  ${jsonArray}

To import into Phantom:
  Phantom → ⚙ → Add / Connect Wallet → Import Private Key → paste the
  32-byte base58 string above → name it whatever you like.

To use with Solana CLI:
  Save the JSON array to a file, then:
    solana balance --keypair <that-file>.json --url devnet
    solana transfer <dest> 0.001 --keypair <that-file>.json --url devnet

CLEAR YOUR TERMINAL when done:
  Windows PowerShell:  Clear-Host
  bash / wsl:          clear
`);
