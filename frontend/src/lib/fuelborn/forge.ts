import "server-only";
import { randomUUID } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import db, { type ForgeAttemptRow } from "../db";
import { upsertMeterStateFromPelican } from "../billing/meter";
import { appendFuelEntry, createAgent, normalizeEvmAddress } from "./ledger";
import { configureFuelMeter } from "./lifecycle";
import { monWeiToMicroFuel } from "./monad-indexer";

export type ForgeConfig = {
  chainId: number;
  contractAddress: string;
  verificationLagBlocks: bigint;
  fuelPerMon: bigint;
  minDepositWei: bigint;
  burnRateMicroFuelPerSecond: number;
};

export type ForgeRegistration = {
  agentId: bigint;
  smith: string;
  metadataHash: string;
  depositWei: bigint;
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
};

export type ForgeRegistrationReader = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getRegistration(args: {
    contractAddress: string;
    txHash: string;
  }): Promise<ForgeRegistration | null>;
};

export type ForgeProvisionedPod = {
  podUuidShort: string;
  podFullUuid: string;
  ramMib: number;
  diskMib: number;
  cpuPercent: number;
};

export type ForgePodProvisioner = {
  provision(attempt: ForgeAttemptRow): Promise<ForgeProvisionedPod>;
};

export type ForgeTransactionRequest = {
  chainId: number;
  address: string;
  functionName: "registerAgent";
  args: [string];
  value: string;
};

export function prepareForge(args: {
  userId: number;
  pelicanUserId: number;
  idempotencyKey: string;
  name: string;
  mission: string;
  personality: string;
  model: string;
  ownerWallet: string;
  depositWei: string;
  config: ForgeConfig;
  nowSeconds?: number;
}): { attempt: ForgeAttemptRow; transaction: ForgeTransactionRequest } {
  validateConfig(args.config);
  requirePositiveInteger(args.userId, "user id");
  requirePositiveInteger(args.pelicanUserId, "Pelican user id");
  const idempotencyKey = requireBoundedText(
    args.idempotencyKey,
    "idempotency key",
    8,
    128,
  );
  const name = requireBoundedText(args.name, "name", 1, 40);
  const mission = requireBoundedText(args.mission, "mission", 1, 1_000);
  const personality = requireBoundedText(
    args.personality,
    "personality",
    1,
    1_000,
  );
  const model = requireBoundedText(args.model, "model", 1, 160);
  const ownerWallet = normalizeEvmAddress(args.ownerWallet);
  const depositWei = parseUnsignedDecimal(args.depositWei, "deposit");
  if (depositWei < args.config.minDepositWei) {
    throw new Error("deposit is below the Forge minimum");
  }
  const contractAddress = normalizeEvmAddress(args.config.contractAddress);
  const metadata = { name, mission, personality, model };
  const metadataJson = JSON.stringify(metadata);
  const metadataHash = keccak256(stringToHex(metadataJson)).toLowerCase();
  const now = args.nowSeconds ?? unixNow();

  const existing = findByIdempotencyKey(args.userId, idempotencyKey);
  if (existing) {
    assertSameRequest(existing, {
      pelicanUserId: args.pelicanUserId,
      name,
      mission,
      personality,
      model,
      metadataJson,
      metadataHash,
      ownerWallet,
      depositWei: depositWei.toString(10),
      fuelPerMon: args.config.fuelPerMon.toString(10),
      burnRateMicroFuelPerSecond: args.config.burnRateMicroFuelPerSecond,
      chainId: args.config.chainId,
      contractAddress,
    });
    return { attempt: existing, transaction: transactionFor(existing) };
  }

  const id = randomUUID();
  const agentId = randomUUID();
  db.prepare(
    `INSERT INTO forge_attempts (
       id, agent_id, user_id, pelican_user_id, idempotency_key,
       name, mission, personality, model, metadata_json, metadata_hash,
       owner_wallet, deposit_wei, fuel_per_mon,
       burn_rate_micro_fuel_per_second, chain_id, contract_address,
       status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'awaiting_transaction', ?, ?)`,
  ).run(
    id,
    agentId,
    args.userId,
    args.pelicanUserId,
    idempotencyKey,
    name,
    mission,
    personality,
    model,
    metadataJson,
    metadataHash,
    ownerWallet,
    depositWei.toString(10),
    args.config.fuelPerMon.toString(10),
    args.config.burnRateMicroFuelPerSecond,
    args.config.chainId,
    contractAddress,
    now,
    now,
  );
  const attempt = getForgeAttempt(id, args.userId);
  return { attempt, transaction: transactionFor(attempt) };
}

export function submitForgeTransaction(args: {
  attemptId: string;
  userId: number;
  txHash: string;
  nowSeconds?: number;
}): ForgeAttemptRow {
  const attempt = getForgeAttempt(args.attemptId, args.userId);
  const txHash = normalizeHash(args.txHash, "transaction hash");
  if (attempt.tx_hash && attempt.tx_hash !== txHash) {
    throw new Error("Forge attempt already has a different transaction");
  }
  if (!attempt.tx_hash) {
    const now = args.nowSeconds ?? unixNow();
    db.prepare(
      `UPDATE forge_attempts
          SET tx_hash = ?, status = 'submitted', last_error = NULL,
              updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'awaiting_transaction'`,
    ).run(txHash, now, attempt.id, args.userId);
  }
  return getForgeAttempt(attempt.id, args.userId);
}

export async function advanceForge(args: {
  attemptId: string;
  userId: number;
  reader: ForgeRegistrationReader;
  provisioner: ForgePodProvisioner;
  config: ForgeConfig;
  nowSeconds?: number;
}): Promise<{
  status: ForgeAttemptRow["status"];
  attempt: ForgeAttemptRow;
  confirmationsRemaining?: bigint;
}> {
  validateConfig(args.config);
  let attempt = getForgeAttempt(args.attemptId, args.userId);
  assertAttemptConfig(attempt, args.config);
  const now = args.nowSeconds ?? unixNow();

  if (attempt.status === "active") {
    return { status: "active", attempt };
  }
  if (attempt.status === "awaiting_transaction" || !attempt.tx_hash) {
    throw new Error("Forge transaction has not been submitted");
  }

  if (attempt.status === "submitted") {
    const rpcChainId = await args.reader.getChainId();
    if (rpcChainId !== attempt.chain_id) {
      throw new Error(
        `RPC chain ID ${rpcChainId} does not match Forge chain ID ${attempt.chain_id}`,
      );
    }
    const registration = await args.reader.getRegistration({
      contractAddress: attempt.contract_address,
      txHash: attempt.tx_hash,
    });
    if (!registration) {
      throw new Error("transaction does not contain an AgentRegistered event");
    }
    assertRegistration(attempt, registration);
    const latestBlock = await args.reader.getBlockNumber();
    const verificationBlock =
      registration.blockNumber + args.config.verificationLagBlocks;
    if (latestBlock < verificationBlock) {
      return {
        status: "submitted",
        attempt,
        confirmationsRemaining: verificationBlock - latestBlock,
      };
    }
    db.prepare(
      `UPDATE forge_attempts
          SET log_index = ?, block_number = ?, block_hash = ?, token_id = ?,
              status = 'chain_verified', last_error = NULL, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'submitted'`,
    ).run(
      registration.logIndex,
      registration.blockNumber.toString(10),
      normalizeHash(registration.blockHash, "block hash"),
      registration.agentId.toString(10),
      now,
      attempt.id,
      args.userId,
    );
    attempt = getForgeAttempt(attempt.id, args.userId);
  }

  if (attempt.status === "chain_verified" || attempt.status === "provisioning") {
    db.prepare(
      `UPDATE forge_attempts
          SET status = 'provisioning', last_error = NULL, updated_at = ?
        WHERE id = ? AND user_id = ?`,
    ).run(now, attempt.id, args.userId);
    try {
      const pod = await args.provisioner.provision(attempt);
      validateProvisionedPod(pod);
      db.prepare(
        `UPDATE forge_attempts
            SET pod_uuid_short = ?, pod_full_uuid = ?, ram_mib = ?,
                disk_mib = ?, cpu_percent = ?, status = 'provisioned',
                last_error = NULL, updated_at = ?
          WHERE id = ? AND user_id = ?`,
      ).run(
        pod.podUuidShort,
        pod.podFullUuid,
        pod.ramMib,
        pod.diskMib,
        pod.cpuPercent,
        now,
        attempt.id,
        args.userId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare(
        `UPDATE forge_attempts
            SET status = 'chain_verified', last_error = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`,
      ).run(message.slice(0, 1_000), now, attempt.id, args.userId);
      throw error;
    }
    attempt = getForgeAttempt(attempt.id, args.userId);
  }

  if (attempt.status === "provisioned") {
    activateAttempt(attempt, now);
    attempt = getForgeAttempt(attempt.id, args.userId);
  }
  return { status: attempt.status, attempt };
}

export function getForgeAttempt(id: string, userId: number): ForgeAttemptRow {
  const attempt = db
    .prepare<[string, number], ForgeAttemptRow>(
      `SELECT * FROM forge_attempts WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId);
  if (!attempt) throw new Error("Forge attempt not found");
  return attempt;
}

export function publicForgeAttempt(attempt: ForgeAttemptRow) {
  return {
    id: attempt.id,
    agent_id: attempt.agent_id,
    status: attempt.status,
    metadata_hash: attempt.metadata_hash,
    owner_wallet: attempt.owner_wallet,
    deposit_wei: attempt.deposit_wei,
    tx_hash: attempt.tx_hash,
    token_id: attempt.token_id,
    pod_uuid_short: attempt.pod_uuid_short,
    last_error: attempt.last_error,
  };
}

function activateAttempt(attempt: ForgeAttemptRow, now: number): void {
  if (
    attempt.token_id == null ||
    attempt.tx_hash == null ||
    attempt.log_index == null ||
    attempt.pod_uuid_short == null ||
    attempt.pod_full_uuid == null ||
    attempt.ram_mib == null ||
    attempt.disk_mib == null ||
    attempt.cpu_percent == null
  ) {
    throw new Error("Forge attempt is missing verified birth or pod data");
  }
  const activate = db.transaction(() => {
    upsertMeterStateFromPelican({
      pod_uuid_short: attempt.pod_uuid_short!,
      pod_full_uuid: attempt.pod_full_uuid!,
      user_id: attempt.user_id,
      ramMib: attempt.ram_mib!,
      diskMib: attempt.disk_mib!,
      cpuPercent: attempt.cpu_percent!,
      economyMode: "fuelborn",
      initialState: "provisioning",
    });
    createAgent({
      id: attempt.agent_id,
      podUuidShort: attempt.pod_uuid_short!,
      userId: attempt.user_id,
      name: attempt.name,
      ownerWallet: attempt.owner_wallet,
      chainId: attempt.chain_id,
      contractAddress: attempt.contract_address,
      tokenId: attempt.token_id!,
      nowSeconds: now,
    });
    configureFuelMeter({
      agentId: attempt.agent_id,
      burnRateMicroFuelPerSecond: attempt.burn_rate_micro_fuel_per_second,
      nowSeconds: now,
    });
    appendFuelEntry({
      agentId: attempt.agent_id,
      deltaMicroFuel: monWeiToMicroFuel(
        BigInt(attempt.deposit_wei),
        BigInt(attempt.fuel_per_mon),
      ),
      reason: "funding",
      refType: "agent_registration",
      refId: attempt.token_id!,
      chainEvent: {
        chainId: attempt.chain_id,
        contractAddress: attempt.contract_address,
        txHash: attempt.tx_hash!,
        logIndex: attempt.log_index!,
      },
      nowSeconds: now,
    });
    db.prepare(
      `UPDATE forge_attempts
          SET status = 'active', last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'provisioned'`,
    ).run(now, attempt.id);
  });
  activate();
}

function transactionFor(attempt: ForgeAttemptRow): ForgeTransactionRequest {
  return {
    chainId: attempt.chain_id,
    address: attempt.contract_address,
    functionName: "registerAgent",
    args: [attempt.metadata_hash],
    value: attempt.deposit_wei,
  };
}

function findByIdempotencyKey(
  userId: number,
  key: string,
): ForgeAttemptRow | null {
  return (
    db
      .prepare<[number, string], ForgeAttemptRow>(
        `SELECT * FROM forge_attempts
          WHERE user_id = ? AND idempotency_key = ?`,
      )
      .get(userId, key) ?? null
  );
}

function assertSameRequest(
  existing: ForgeAttemptRow,
  expected: {
    pelicanUserId: number;
    name: string;
    mission: string;
    personality: string;
    model: string;
    metadataJson: string;
    metadataHash: string;
    ownerWallet: string;
    depositWei: string;
    fuelPerMon: string;
    burnRateMicroFuelPerSecond: number;
    chainId: number;
    contractAddress: string;
  },
): void {
  if (
    existing.pelican_user_id !== expected.pelicanUserId ||
    existing.name !== expected.name ||
    existing.mission !== expected.mission ||
    existing.personality !== expected.personality ||
    existing.model !== expected.model ||
    existing.metadata_json !== expected.metadataJson ||
    existing.metadata_hash !== expected.metadataHash ||
    existing.owner_wallet !== expected.ownerWallet ||
    existing.deposit_wei !== expected.depositWei ||
    existing.fuel_per_mon !== expected.fuelPerMon ||
    existing.burn_rate_micro_fuel_per_second !==
      expected.burnRateMicroFuelPerSecond ||
    existing.chain_id !== expected.chainId ||
    existing.contract_address !== expected.contractAddress
  ) {
    throw new Error(
      "idempotency key already belongs to a different Forge request",
    );
  }
}

function assertRegistration(
  attempt: ForgeAttemptRow,
  registration: ForgeRegistration,
): void {
  if (
    normalizeHash(registration.transactionHash, "transaction hash") !==
    attempt.tx_hash
  ) {
    throw new Error("AgentRegistered transaction does not match");
  }
  if (normalizeEvmAddress(registration.smith) !== attempt.owner_wallet) {
    throw new Error("AgentRegistered smith does not match Forge owner");
  }
  if (
    normalizeHash(registration.metadataHash, "metadata hash") !==
    attempt.metadata_hash
  ) {
    throw new Error("AgentRegistered metadata hash does not match");
  }
  if (registration.depositWei.toString(10) !== attempt.deposit_wei) {
    throw new Error("AgentRegistered deposit does not match");
  }
  if (registration.agentId <= BigInt(0)) {
    throw new Error("AgentRegistered agent ID must be positive");
  }
  if (
    !Number.isSafeInteger(registration.logIndex) ||
    registration.logIndex < 0
  ) {
    throw new Error("AgentRegistered log index is invalid");
  }
  if (registration.blockNumber < BigInt(0)) {
    throw new Error("AgentRegistered block number is invalid");
  }
  normalizeHash(registration.blockHash, "block hash");
}

function assertAttemptConfig(
  attempt: ForgeAttemptRow,
  config: ForgeConfig,
): void {
  if (
    attempt.chain_id !== config.chainId ||
    attempt.contract_address !== normalizeEvmAddress(config.contractAddress)
  ) {
    throw new Error(
      "Forge attempt does not match the active contract configuration",
    );
  }
}

function validateConfig(config: ForgeConfig): void {
  requirePositiveInteger(config.chainId, "chain ID");
  normalizeEvmAddress(config.contractAddress);
  if (config.verificationLagBlocks < BigInt(0)) {
    throw new Error("verification lag must be non-negative");
  }
  if (config.fuelPerMon <= BigInt(0)) {
    throw new Error("FUEL per MON must be positive");
  }
  if (config.minDepositWei <= BigInt(0)) {
    throw new Error("minimum deposit must be positive");
  }
  requirePositiveInteger(config.burnRateMicroFuelPerSecond, "burn rate");
}

function validateProvisionedPod(pod: ForgeProvisionedPod): void {
  requireBoundedText(pod.podUuidShort, "pod UUID", 1, 64);
  requireBoundedText(pod.podFullUuid, "full pod UUID", 1, 128);
  requirePositiveInteger(pod.ramMib, "pod RAM");
  requirePositiveInteger(pod.diskMib, "pod disk");
  requirePositiveInteger(pod.cpuPercent, "pod CPU");
}

function requireBoundedText(
  value: string,
  label: string,
  min: number,
  max: number,
): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${label} must be between ${min} and ${max} characters`);
  }
  return normalized;
}

function parseUnsignedDecimal(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be wei as an unsigned integer`);
  }
  return BigInt(value);
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
  return Math.floor(Date.now() / 1_000);
}
