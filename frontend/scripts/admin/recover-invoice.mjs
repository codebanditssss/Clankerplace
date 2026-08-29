#!/usr/bin/env node
// Admin recovery tool: decrypt a single invoice's deposit keypair and sweep
// any remaining funds to your treasury. Use this when:
//   - Reconciler auto-sweep failed (e.g., RPC outage) and the invoice is
//     stuck in 'confirmed'/'underpaid'/'failed' with funds still on the
//     deposit address.
//   - You want to refund an underpaid invoice manually (sweep funds, then
//     send them back to the payer from your treasury).
//
// Usage:
//   pnpm admin:recover <invoice-id>
//
// Reads the master encryption key from INVOICE_KEY_ENCRYPTION_KEY just like
// the server does. Requires SOLANA_RPC_URL + SOLANA_TREASURY_ADDRESS set.
// Read-only on the database UNTIL the sweep tx succeeds, then marks the
// keypair wiped.
//
// Safety:
//   - Refuses to run if invoice status is 'pending' (let the reconciler
//     handle it normally — no need for manual intervention).
//   - Refuses if the keypair is already wiped (no key to decrypt).
//   - Always sweeps to SOLANA_TREASURY_ADDRESS — you can't redirect it.

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
if (!invoiceId) {
  console.error("usage: pnpm admin:recover <invoice-id>");
  process.exit(1);
}

const DB_PATH = process.env.PODS_DB_PATH || resolve("data/pods.db");
const masterKeyHex = process.env.INVOICE_KEY_ENCRYPTION_KEY;
const treasury = process.env.SOLANA_TREASURY_ADDRESS;
const rpcUrl = process.env.SOLANA_RPC_URL;
const cluster = process.env.SOLANA_CLUSTER ?? "devnet";

if (!masterKeyHex || !/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
  console.error("INVOICE_KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  process.exit(1);
}
if (!treasury) {
  console.error("SOLANA_TREASURY_ADDRESS must be set");
  process.exit(1);
}
if (!rpcUrl) {
  console.error("SOLANA_RPC_URL must be set");
  process.exit(1);
}

const db = new Database(DB_PATH);

const inv = db
  .prepare(`SELECT * FROM invoices WHERE id = ?`)
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
    `keypair for invoice ${invoiceId} was already wiped at unix=${kp.wiped_at}`,
  );
  console.error("the funds were already swept to your treasury, OR the key was destroyed without a sweep — check sweep_tx_signature on the invoice");
  process.exit(1);
}
if (inv.status === "pending") {
  console.error(
    "invoice is still 'pending' — let the reconciler handle it normally. Recovery is for stuck/failed invoices only.",
  );
  process.exit(1);
}

console.log(`Recovering invoice ${invoiceId}`);
console.log(`  status:          ${inv.status}`);
console.log(`  currency:        ${inv.currency}`);
console.log(`  deposit address: ${inv.deposit_address}`);
console.log(`  treasury:        ${treasury}`);
console.log(`  cluster:         ${cluster}`);
console.log();

// Decrypt the secret key.
const iv = Buffer.from(kp.iv_hex, "hex");
const tag = Buffer.from(kp.auth_tag_hex, "hex");
const ct = Buffer.from(kp.ciphertext_hex, "hex");
const decipher = createDecipheriv("aes-256-gcm", Buffer.from(masterKeyHex, "hex"), iv, {
  authTagLength: 16,
});
decipher.setAuthTag(tag);
let secretKey;
try {
  secretKey = Buffer.concat([decipher.update(ct), decipher.final()]);
} catch (err) {
  console.error("decryption failed (wrong master key?):", err.message);
  process.exit(1);
}
const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
if (keypair.publicKey.toBase58() !== inv.deposit_address) {
  console.error(
    `decrypted pubkey ${keypair.publicKey.toBase58()} does not match invoice.deposit_address ${inv.deposit_address}`,
  );
  process.exit(1);
}
console.log(`✓ keypair decrypted, matches deposit address`);

const conn = new Connection(rpcUrl, "confirmed");

// Check on-chain balance.
const balance = await conn.getBalance(keypair.publicKey);
console.log(`✓ on-chain SOL balance: ${balance / 1e9} SOL (${balance} lamports)`);

if (inv.currency === "SOL") {
  if (balance < 10_000) {
    console.error(`balance ${balance} too low to cover fee (~5000 lamports)`);
    process.exit(1);
  }
  const sweepLamports = balance - 5_000;
  console.log(`Sweeping ${sweepLamports / 1e9} SOL to ${treasury}...`);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(treasury),
      lamports: sweepLamports,
    }),
  );
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.sign(keypair);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`✓ swept ${sweepLamports / 1e9} SOL`);
  console.log(`  tx: https://explorer.solana.com/tx/${sig}?cluster=${cluster}`);

  // Mark wiped.
  db.prepare(
    `UPDATE invoice_keypairs SET ciphertext_hex = NULL, wiped_at = ? WHERE invoice_id = ?`,
  ).run(Math.floor(Date.now() / 1000), invoiceId);
  db.prepare(
    `UPDATE invoices SET sweep_tx_signature = ?, swept_at = ?, status = CASE WHEN status = 'confirmed' THEN 'swept' ELSE status END, updated_at = ? WHERE id = ?`,
  ).run(
    sig,
    Math.floor(Date.now() / 1000),
    Math.floor(Date.now() / 1000),
    invoiceId,
  );
  console.log(`✓ DB updated: ciphertext wiped, sweep_tx_signature recorded`);
  process.exit(0);
}

// SPL token sweep (USDC / USDT / POD when added).
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
const destAta = await getAssociatedTokenAddress(mint, new PublicKey(treasury));

let sourceBalance;
try {
  const acc = await getAccount(conn, sourceAta, "confirmed");
  sourceBalance = acc.amount;
} catch (err) {
  if (err instanceof TokenAccountNotFoundError) {
    console.error(`no ${inv.currency} token account on deposit ${keypair.publicKey.toBase58()} — nothing to sweep`);
    process.exit(1);
  }
  throw err;
}
console.log(`✓ deposit ${inv.currency} balance: ${Number(sourceBalance) / 10 ** decimals}`);

try {
  await getAccount(conn, destAta, "confirmed");
} catch (err) {
  if (err instanceof TokenAccountNotFoundError) {
    console.error(
      `treasury ${treasury} has no ${inv.currency} ATA. ` +
        `Create one first by sending 1 ${inv.currency} from any wallet to ${treasury}.`,
    );
    process.exit(1);
  }
  throw err;
}

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
console.log(`✓ swept ${Number(sourceBalance) / 10 ** decimals} ${inv.currency}`);
console.log(`  tx: https://explorer.solana.com/tx/${sig}?cluster=${cluster}`);

db.prepare(
  `UPDATE invoice_keypairs SET ciphertext_hex = NULL, wiped_at = ? WHERE invoice_id = ?`,
).run(Math.floor(Date.now() / 1000), invoiceId);
db.prepare(
  `UPDATE invoices SET sweep_tx_signature = ?, swept_at = ?, status = CASE WHEN status = 'confirmed' THEN 'swept' ELSE status END, updated_at = ? WHERE id = ?`,
).run(
  sig,
  Math.floor(Date.now() / 1000),
  Math.floor(Date.now() / 1000),
  invoiceId,
);
console.log(`✓ DB updated: ciphertext wiped, sweep_tx_signature recorded`);
