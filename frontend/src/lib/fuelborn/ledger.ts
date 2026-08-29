import "server-only";
import db, {
  type FuelbornAgentRow,
  type FuelLedgerEntryRow,
  type FuelLedgerReason,
} from "../db";

export type ChainEventRef = {
  chainId: number;
  contractAddress: string;
  txHash: string;
  logIndex: number;
};

export function createAgent(args: {
  id: string;
  podUuidShort: string;
  userId: number;
  name: string;
  ownerWallet: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  nowSeconds?: number;
}): FuelbornAgentRow {
  const now = args.nowSeconds ?? unixNow();
  const id = requireText(args.id, "agent id");
  const podUuidShort = requireText(args.podUuidShort, "pod uuid");
  const name = requireText(args.name, "agent name");
  const ownerWallet = normalizeEvmAddress(args.ownerWallet);
  const contractAddress = normalizeEvmAddress(args.contractAddress);
  requirePositiveInteger(args.userId, "user id");
  requirePositiveInteger(args.chainId, "chain id");
  if (!/^\d+$/.test(args.tokenId)) {
    throw new Error("token id must be an unsigned decimal string");
  }

  db.prepare(
    `INSERT INTO fuelborn_agents (
       id, pod_uuid_short, user_id, name, owner_wallet, chain_id,
       contract_address, token_id, status, born_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'alive', ?, ?, ?)`,
  ).run(
    id,
    podUuidShort,
    args.userId,
    name,
    ownerWallet,
    args.chainId,
    contractAddress,
    args.tokenId,
    now,
    now,
    now,
  );

  return db
    .prepare<[string], FuelbornAgentRow>(
      `SELECT * FROM fuelborn_agents WHERE id = ?`,
    )
    .get(id)!;
}

export function appendFuelEntry(args: {
  agentId: string;
  deltaMicroFuel: number;
  reason: FuelLedgerReason;
  refType?: string;
  refId?: string;
  chainEvent?: ChainEventRef;
  nowSeconds?: number;
}): { entry: FuelLedgerEntryRow; created: boolean } {
  const agentId = requireText(args.agentId, "agent id");
  if (!Number.isSafeInteger(args.deltaMicroFuel) || args.deltaMicroFuel === 0) {
    throw new Error("deltaMicroFuel must be a safe non-zero integer");
  }
  const event = args.chainEvent ? normalizeChainEventRef(args.chainEvent) : null;
  const now = args.nowSeconds ?? unixNow();

  const write = db.transaction(() => {
    if (event) {
      const existing = findChainEntry(event);
      if (existing) {
        assertSameChainCredit(existing, {
          agentId,
          deltaMicroFuel: args.deltaMicroFuel,
          reason: args.reason,
        });
        return { entry: existing, created: false };
      }
    }

    const result = db.prepare(
      `INSERT INTO fuel_ledger (
         agent_id, delta_micro_fuel, reason, ref_type, ref_id,
         chain_id, contract_address, tx_hash, log_index, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      agentId,
      args.deltaMicroFuel,
      args.reason,
      args.refType ?? null,
      args.refId ?? null,
      event?.chainId ?? null,
      event?.contractAddress ?? null,
      event?.txHash ?? null,
      event?.logIndex ?? null,
      now,
    );
    const entry = db
      .prepare<[number], FuelLedgerEntryRow>(
        `SELECT * FROM fuel_ledger WHERE id = ?`,
      )
      .get(Number(result.lastInsertRowid))!;
    return { entry, created: true };
  });

  return write();
}

export function getFuelBalance(agentId: string): number {
  const row = db
    .prepare<[string], { balance: number | null }>(
      `SELECT SUM(delta_micro_fuel) AS balance
         FROM fuel_ledger WHERE agent_id = ?`,
    )
    .get(agentId);
  return row?.balance ?? 0;
}

export function listFuelEntries(
  agentId: string,
  limit = 100,
): FuelLedgerEntryRow[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("limit must be an integer between 1 and 500");
  }
  return db
    .prepare<[string, number], FuelLedgerEntryRow>(
      `SELECT * FROM fuel_ledger
        WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(agentId, limit);
}

function findChainEntry(event: ChainEventRef): FuelLedgerEntryRow | null {
  return (
    db
      .prepare<[number, string, string, number], FuelLedgerEntryRow>(
        `SELECT * FROM fuel_ledger
          WHERE chain_id = ? AND contract_address = ?
            AND tx_hash = ? AND log_index = ?`,
      )
      .get(
        event.chainId,
        event.contractAddress,
        event.txHash,
        event.logIndex,
      ) ?? null
  );
}

function assertSameChainCredit(
  existing: FuelLedgerEntryRow,
  expected: {
    agentId: string;
    deltaMicroFuel: number;
    reason: FuelLedgerReason;
  },
): void {
  if (
    existing.agent_id !== expected.agentId ||
    existing.delta_micro_fuel !== expected.deltaMicroFuel ||
    existing.reason !== expected.reason
  ) {
    throw new Error("chain event conflict: existing FUEL entry differs");
  }
}

export function normalizeChainEventRef(event: ChainEventRef): ChainEventRef {
  requirePositiveInteger(event.chainId, "chain id");
  if (!Number.isSafeInteger(event.logIndex) || event.logIndex < 0) {
    throw new Error("log index must be a non-negative integer");
  }
  const txHash = event.txHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    throw new Error("transaction hash must be 32-byte hex");
  }
  return {
    chainId: event.chainId,
    contractAddress: normalizeEvmAddress(event.contractAddress),
    txHash,
    logIndex: event.logIndex,
  };
}

export function normalizeEvmAddress(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error("EVM address must be 20-byte hex");
  }
  return normalized;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
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
