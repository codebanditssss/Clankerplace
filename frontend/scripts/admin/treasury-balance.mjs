#!/usr/bin/env node
// Admin tool: print on-chain balance of the treasury wallet (SOL +
// every SPL token it holds). Read-only. Run with:
//
//   pnpm admin:balance
//
// Uses SOLANA_RPC_URL + SOLANA_TREASURY_ADDRESS from .env.local.

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const rpcUrl = process.env.SOLANA_RPC_URL;
const treasury = process.env.SOLANA_TREASURY_ADDRESS;
const cluster = process.env.SOLANA_CLUSTER ?? "devnet";

if (!rpcUrl || !treasury) {
  console.error("SOLANA_RPC_URL and SOLANA_TREASURY_ADDRESS must be set in .env.local");
  process.exit(1);
}

const KNOWN_MINTS = {
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC (mainnet)",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT (mainnet)",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "USDC-Dev (devnet)",
};

const SPL_TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

const conn = new Connection(rpcUrl, "confirmed");
const treasuryPk = new PublicKey(treasury);

console.log(`\nTreasury: ${treasury}`);
console.log(`Cluster:  ${cluster}`);
console.log(`Explorer: https://explorer.solana.com/address/${treasury}?cluster=${cluster}\n`);

// 1. Native SOL balance.
const lamports = await conn.getBalance(treasuryPk, "confirmed");
console.log(`  SOL:  ${(lamports / LAMPORTS_PER_SOL).toFixed(9)} SOL  (${lamports.toLocaleString()} lamports)`);

// 2. SPL token balances — query all token accounts owned by the treasury.
const tokenAccounts = await conn.getParsedTokenAccountsByOwner(treasuryPk, {
  programId: SPL_TOKEN_PROGRAM,
});

if (tokenAccounts.value.length === 0) {
  console.log("\n  No SPL token accounts. You only hold SOL.\n");
} else {
  console.log("\n  SPL tokens:");
  for (const acc of tokenAccounts.value) {
    const info = acc.account.data.parsed.info;
    const mint = info.mint;
    const amount = info.tokenAmount.uiAmountString;
    const decimals = info.tokenAmount.decimals;
    const label = KNOWN_MINTS[mint] ?? mint;
    console.log(
      `    ${label}: ${amount}  (${info.tokenAmount.amount} base units, ${decimals} decimals)`,
    );
    console.log(`      mint: ${mint}`);
    console.log(`      ata:  ${acc.pubkey.toBase58()}`);
  }
  console.log();
}

// 3. Recent inbound transactions (last 10).
console.log("  Recent transactions (last 10):");
const sigs = await conn.getSignaturesForAddress(treasuryPk, { limit: 10 });
if (sigs.length === 0) {
  console.log("    (none)");
} else {
  for (const s of sigs) {
    const ts = s.blockTime
      ? new Date(s.blockTime * 1000).toISOString().replace("T", " ").slice(0, 19)
      : "—";
    const err = s.err ? " [FAILED]" : "";
    console.log(`    ${ts}  ${s.signature.slice(0, 12)}…${err}`);
  }
}
console.log();
