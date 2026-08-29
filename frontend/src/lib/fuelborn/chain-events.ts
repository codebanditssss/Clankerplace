import "server-only";
import db, { type FuelChainEventRow } from "../db";
import {
  normalizeChainEventRef,
  normalizeEvmAddress,
  type ChainEventRef,
} from "./ledger";
import { fundAgent } from "./lifecycle";

export function observeFundingEvent(args: {
  agentId: string;
  deltaMicroFuel: number;
  chainEvent: ChainEventRef;
  blockNumber: bigint | number | string;
  blockHash: string;
  nowSeconds?: number;
}): { event: FuelChainEventRow; created: boolean } {
  requirePositiveInteger(args.deltaMicroFuel, "funding amount");
  const ref = normalizeChainEventRef(args.chainEvent);
  const blockNumber = normalizeBlockNumber(args.blockNumber);
  const blockHash = normalizeHash(args.blockHash, "block hash");
  const now = args.nowSeconds ?? unixNow();

  const observe = db.transaction(() => {
    const existing = getChainEvent(ref);
    if (existing) {
      if (
        existing.agent_id !== args.agentId ||
        existing.delta_micro_fuel !== args.deltaMicroFuel ||
        existing.block_number !== blockNumber ||
        existing.block_hash !== blockHash
      ) {
        throw new Error("chain event conflict: observed payload differs");
      }
      return { event: existing, created: false };
    }
    const result = db.prepare(
      `INSERT INTO fuel_chain_events (
         agent_id, delta_micro_fuel, chain_id, contract_address,
         tx_hash, log_index, block_number, block_hash, observed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      args.agentId,
      args.deltaMicroFuel,
      ref.chainId,
      ref.contractAddress,
      ref.txHash,
      ref.logIndex,
      blockNumber,
      blockHash,
      now,
    );
    const event = db
      .prepare<[number], FuelChainEventRow>(
        `SELECT * FROM fuel_chain_events WHERE id = ?`,
      )
      .get(Number(result.lastInsertRowid))!;
    return { event, created: true };
  });
  return observe();
}

export function markFundingVerified(
  chainEvent: ChainEventRef,
  nowSeconds: number = unixNow(),
): FuelChainEventRow {
  const ref = normalizeChainEventRef(chainEvent);
  const existing = getChainEvent(ref);
  if (!existing) throw new Error("observed funding event not found");
  if (existing.status === "observed") {
    db.prepare(
      `UPDATE fuel_chain_events
          SET status = 'verified', verified_at = ? WHERE id = ?`,
    ).run(nowSeconds, existing.id);
  }
  return getChainEvent(ref)!;
}

export function applyVerifiedFunding(
  chainEvent: ChainEventRef,
  nowSeconds: number = unixNow(),
): { applied: boolean; credited: boolean; revived: boolean } {
  const ref = normalizeChainEventRef(chainEvent);
  const apply = db.transaction(() => {
    const event = getChainEvent(ref);
    if (!event) throw new Error("observed funding event not found");
    if (event.status === "applied") {
      return { applied: false, credited: false, revived: false };
    }
    if (event.status !== "verified") {
      throw new Error("funding event is not verified");
    }
    const result = fundAgent({
      agentId: event.agent_id,
      deltaMicroFuel: event.delta_micro_fuel,
      chainEvent: ref,
      nowSeconds,
    });
    db.prepare(
      `UPDATE fuel_chain_events
          SET status = 'applied', applied_at = ? WHERE id = ?`,
    ).run(nowSeconds, event.id);
    return {
      applied: true,
      credited: result.credited,
      revived: result.revived,
    };
  });
  return apply();
}

export function getChainEvent(
  chainEvent: ChainEventRef,
): FuelChainEventRow | null {
  const ref = normalizeChainEventRef(chainEvent);
  return (
    db
      .prepare<[number, string, string, number], FuelChainEventRow>(
        `SELECT * FROM fuel_chain_events
          WHERE chain_id = ? AND contract_address = ?
            AND tx_hash = ? AND log_index = ?`,
      )
      .get(
        ref.chainId,
        ref.contractAddress,
        ref.txHash,
        ref.logIndex,
      ) ?? null
  );
}

export function listObservedFundingEventsThrough(args: {
  chainId: number;
  contractAddress: string;
  blockNumber: bigint | number | string;
}): FuelChainEventRow[] {
  requirePositiveInteger(args.chainId, "chain id");
  const address = normalizeEvmAddress(args.contractAddress);
  const through = BigInt(normalizeBlockNumber(args.blockNumber));
  return db
    .prepare<[number, string], FuelChainEventRow>(
      `SELECT * FROM fuel_chain_events
        WHERE chain_id = ? AND contract_address = ? AND status = 'observed'
        ORDER BY id`,
    )
    .all(args.chainId, address)
    .filter((event) => BigInt(event.block_number) <= through);
}

export function setSyncCursor(args: {
  chainId: number;
  contractAddress: string;
  blockNumber: bigint | number | string;
  nowSeconds?: number;
}): void {
  requirePositiveInteger(args.chainId, "chain id");
  const address = normalizeEvmAddress(args.contractAddress);
  const blockNumber = normalizeBlockNumber(args.blockNumber);
  const now = args.nowSeconds ?? unixNow();
  const existing = getSyncCursor(args.chainId, address);
  if (existing != null && BigInt(blockNumber) < existing) {
    throw new Error("chain sync cursor cannot move backwards");
  }
  db.prepare(
    `INSERT INTO fuel_chain_sync_state (
       chain_id, contract_address, last_scanned_block, updated_at
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT(chain_id, contract_address) DO UPDATE SET
       last_scanned_block = excluded.last_scanned_block,
       updated_at = excluded.updated_at`,
  ).run(args.chainId, address, blockNumber, now);
}

export function getSyncCursor(
  chainId: number,
  contractAddress: string,
): bigint | null {
  requirePositiveInteger(chainId, "chain id");
  const address = normalizeEvmAddress(contractAddress);
  const row = db
    .prepare<[number, string], { last_scanned_block: string }>(
      `SELECT last_scanned_block FROM fuel_chain_sync_state
        WHERE chain_id = ? AND contract_address = ?`,
    )
    .get(chainId, address);
  return row ? BigInt(row.last_scanned_block) : null;
}

function normalizeBlockNumber(value: bigint | number | string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error("block number must be a non-negative integer");
  }
  if (parsed < BigInt(0) || String(value).includes(".")) {
    throw new Error("block number must be a non-negative integer");
  }
  return parsed.toString(10);
}

function normalizeHash(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be 32-byte hex`);
  }
  return normalized;
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
