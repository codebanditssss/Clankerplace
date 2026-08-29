import "server-only";
import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Hash,
} from "viem";
import db, { type FuelbornAgentRow } from "../db";
import {
  applyVerifiedFunding,
  getSyncCursor,
  listObservedFundingEventsThrough,
  markFundingVerified,
  observeFundingEvent,
  setSyncCursor,
} from "./chain-events";
import { normalizeEvmAddress } from "./ledger";

const WEI_PER_MON = BigInt("1000000000000000000");
const MICRO_FUEL_PER_FUEL = BigInt("1000000");

export const AGENT_FUNDED_EVENT = parseAbiItem(
  "event AgentFunded(uint256 indexed agentId, address indexed funder, uint256 amount)",
);

export type MonadFundingLog = {
  agentId: bigint;
  amountWei: bigint;
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
};

export type MonadFundingReader = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getFundingLogs(args: {
    contractAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<MonadFundingLog[]>;
};

export type MonadFundingConfig = {
  chainId: number;
  contractAddress: string;
  startBlock: bigint;
  verificationLagBlocks: bigint;
  maxBlockRange: bigint;
  fuelPerMon: bigint;
};

export type MonadSyncResult = {
  latest_block: string;
  scanned_from_block: string | null;
  scanned_through_block: string | null;
  verified_through_block: string;
  observed: number;
  unknown_agents: number;
  applied: number;
};

export async function syncMonadFunding(args: {
  reader: MonadFundingReader;
  config: MonadFundingConfig;
  nowSeconds?: number;
}): Promise<MonadSyncResult> {
  validateConfig(args.config);
  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const rpcChainId = await args.reader.getChainId();
  if (rpcChainId !== args.config.chainId) {
    throw new Error(
      `RPC chain ID ${rpcChainId} does not match configured chain ID ${args.config.chainId}`,
    );
  }

  const latestBlock = await args.reader.getBlockNumber();
  if (latestBlock < BigInt(0)) {
    throw new Error("RPC returned a negative block number");
  }
  const verifiedThrough =
    latestBlock >= args.config.verificationLagBlocks
      ? latestBlock - args.config.verificationLagBlocks
      : BigInt(0);
  const cursor = getSyncCursor(
    args.config.chainId,
    args.config.contractAddress,
  );
  const fromBlock =
    cursor == null ? args.config.startBlock : cursor + BigInt(1);
  let scannedThrough: bigint | null = null;
  let observed = 0;
  let unknownAgents = 0;

  if (fromBlock <= latestBlock) {
    scannedThrough = minBigInt(
      latestBlock,
      fromBlock + args.config.maxBlockRange - BigInt(1),
    );
    const logs = await args.reader.getFundingLogs({
      contractAddress: args.config.contractAddress,
      fromBlock,
      toBlock: scannedThrough,
    });
    for (const log of logs) {
      const agent = findAgent(
        args.config.chainId,
        args.config.contractAddress,
        log.agentId,
      );
      if (!agent) {
        unknownAgents += 1;
        console.warn(
          `[fuelborn] ignoring AgentFunded for unknown token ${log.agentId.toString(10)}`,
        );
        continue;
      }
      const result = observeFundingEvent({
        agentId: agent.id,
        deltaMicroFuel: monWeiToMicroFuel(
          log.amountWei,
          args.config.fuelPerMon,
        ),
        chainEvent: {
          chainId: args.config.chainId,
          contractAddress: args.config.contractAddress,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        },
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        nowSeconds,
      });
      if (result.created) observed += 1;
    }
  }

  let applied = 0;
  const ready = listObservedFundingEventsThrough({
    chainId: args.config.chainId,
    contractAddress: args.config.contractAddress,
    blockNumber: verifiedThrough,
  });
  for (const event of ready) {
    const chainEvent = {
      chainId: event.chain_id,
      contractAddress: event.contract_address,
      txHash: event.tx_hash,
      logIndex: event.log_index,
    };
    markFundingVerified(chainEvent, nowSeconds);
    const result = applyVerifiedFunding(chainEvent, nowSeconds);
    if (result.applied) applied += 1;
  }

  if (scannedThrough != null) {
    setSyncCursor({
      chainId: args.config.chainId,
      contractAddress: args.config.contractAddress,
      blockNumber: scannedThrough,
      nowSeconds,
    });
  }
  return {
    latest_block: latestBlock.toString(10),
    scanned_from_block: scannedThrough == null ? null : fromBlock.toString(10),
    scanned_through_block: scannedThrough?.toString(10) ?? null,
    verified_through_block: verifiedThrough.toString(10),
    observed,
    unknown_agents: unknownAgents,
    applied,
  };
}

export function monWeiToMicroFuel(
  amountWei: bigint,
  fuelPerMon: bigint,
): number {
  if (amountWei <= BigInt(0)) {
    throw new Error("funding amount must be positive");
  }
  if (fuelPerMon <= BigInt(0)) {
    throw new Error("FUEL per MON must be positive");
  }
  const microFuel =
    (amountWei * fuelPerMon * MICRO_FUEL_PER_FUEL) / WEI_PER_MON;
  if (microFuel === BigInt(0)) {
    throw new Error("funding amount is too small to mint one micro-FUEL");
  }
  if (microFuel > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("funding amount exceeds the safe micro-FUEL range");
  }
  return Number(microFuel);
}

export async function syncMonadFundingFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<
  | { configured: false }
  | ({ configured: true } & MonadSyncResult)
> {
  const loaded = loadMonadFundingConfig(env);
  if (!loaded) return { configured: false };
  const reader = createViemFundingReader(loaded.rpcUrl);
  return {
    configured: true,
    ...(await syncMonadFunding({ reader, config: loaded })),
  };
}

export function loadMonadFundingConfig(
  env: NodeJS.ProcessEnv = process.env,
): (MonadFundingConfig & { rpcUrl: string }) | null {
  const keys = [
    "MONAD_RPC_URL",
    "MONAD_CHAIN_ID",
    "FUELBORN_CONTRACT_ADDRESS",
    "FUELBORN_CONTRACT_DEPLOY_BLOCK",
    "FUEL_PER_MON",
  ] as const;
  const present = keys.filter((key) => env[key]?.trim());
  if (present.length === 0) return null;
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`incomplete Monad configuration: missing ${missing.join(", ")}`);
  }

  const rpcUrl = env.MONAD_RPC_URL!.trim();
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("MONAD_RPC_URL must use http or https");
  }
  const config = {
    rpcUrl,
    chainId: parseSafePositiveInteger(env.MONAD_CHAIN_ID!, "MONAD_CHAIN_ID"),
    contractAddress: normalizeEvmAddress(
      env.FUELBORN_CONTRACT_ADDRESS!,
    ),
    startBlock: parseUnsignedBigInt(
      env.FUELBORN_CONTRACT_DEPLOY_BLOCK!,
      "FUELBORN_CONTRACT_DEPLOY_BLOCK",
    ),
    verificationLagBlocks: parseUnsignedBigInt(
      env.MONAD_VERIFICATION_LAG_BLOCKS ?? "5",
      "MONAD_VERIFICATION_LAG_BLOCKS",
    ),
    maxBlockRange: parsePositiveBigInt(
      env.MONAD_MAX_BLOCK_RANGE ?? "1000",
      "MONAD_MAX_BLOCK_RANGE",
    ),
    fuelPerMon: parsePositiveBigInt(env.FUEL_PER_MON!, "FUEL_PER_MON"),
  };
  validateConfig(config);
  return config;
}

function createViemFundingReader(rpcUrl: string): MonadFundingReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber(),
    getFundingLogs: async ({ contractAddress, fromBlock, toBlock }) => {
      const logs = await client.getLogs({
        address: contractAddress as Address,
        event: AGENT_FUNDED_EVENT,
        fromBlock,
        toBlock,
        strict: true,
      });
      return logs.map((log) => {
        if (
          log.transactionHash == null ||
          log.blockHash == null ||
          log.blockNumber == null ||
          log.logIndex == null
        ) {
          throw new Error("RPC returned an unmined AgentFunded log");
        }
        return {
          agentId: log.args.agentId,
          amountWei: log.args.amount,
          transactionHash: log.transactionHash as Hash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash as Hash,
        };
      });
    },
  };
}

function findAgent(
  chainId: number,
  contractAddress: string,
  tokenId: bigint,
): FuelbornAgentRow | null {
  return (
    db
      .prepare<[number, string, string], FuelbornAgentRow>(
        `SELECT * FROM fuelborn_agents
          WHERE chain_id = ? AND contract_address = ? AND token_id = ?`,
      )
      .get(
        chainId,
        normalizeEvmAddress(contractAddress),
        tokenId.toString(10),
      ) ?? null
  );
}

function validateConfig(config: MonadFundingConfig): void {
  if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) {
    throw new Error("chain ID must be a positive integer");
  }
  normalizeEvmAddress(config.contractAddress);
  if (config.startBlock < BigInt(0)) {
    throw new Error("start block must be non-negative");
  }
  if (config.verificationLagBlocks < BigInt(0)) {
    throw new Error("verification lag must be non-negative");
  }
  if (config.maxBlockRange <= BigInt(0)) {
    throw new Error("maximum block range must be positive");
  }
  if (config.fuelPerMon <= BigInt(0)) {
    throw new Error("FUEL per MON must be positive");
  }
}

function parseSafePositiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return parsed;
}

function parseUnsignedBigInt(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return BigInt(value);
}

function parsePositiveBigInt(value: string, label: string): bigint {
  const parsed = parseUnsignedBigInt(value, label);
  if (parsed <= BigInt(0)) throw new Error(`${label} must be positive`);
  return parsed;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
