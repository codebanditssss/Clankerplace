import "server-only";
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  TransactionReceiptNotFoundError,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { deploySizeById, DEFAULT_DEPLOY_SIZE_ID } from "../deploy-sizes";
import { managedDeployEnv } from "../managed-ai";
import { applicationApi } from "../pelican";
import { createRuntimeForgePodFinalizer } from "./forge-finalizer-runtime";
import { normalizeEvmAddress } from "./ledger";
import type {
  ForgeConfig,
  ForgePodProvisioner,
  ForgeRegistrationReader,
  ForgeProvisionedPod,
} from "./forge";

export const AGENT_REGISTERED_EVENT = parseAbiItem(
  "event AgentRegistered(uint256 indexed agentId, address indexed smith, bytes32 metadataHash, uint256 deposit)",
);

type ApplicationApiOpts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

export type ApplicationApi = (
  path: string,
  opts?: ApplicationApiOpts,
) => Promise<any>;

type ForgeRuntimeConfig = {
  rpcUrl: string;
  forge: ForgeConfig;
};

type ForgeEnv = Record<string, string | undefined>;

type PelicanServer = {
  attributes: {
    id: number;
    uuid: string;
    identifier: string;
    user: number;
    limits: { memory: number; disk: number; cpu: number };
  };
};

export function loadForgeRuntimeConfig(
  env: ForgeEnv = process.env,
): ForgeRuntimeConfig {
  const required = [
    "MONAD_RPC_URL",
    "MONAD_CHAIN_ID",
    "FUELBORN_CONTRACT_ADDRESS",
    "FUEL_PER_MON",
    "FUELBORN_MIN_FORGE_DEPOSIT_WEI",
  ] as const;
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Forge configuration is missing ${missing.join(", ")}`);
  }
  const rpcUrl = env.MONAD_RPC_URL!.trim();
  const parsedUrl = new URL(rpcUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("MONAD_RPC_URL must use http or https");
  }
  return {
    rpcUrl,
    forge: {
      chainId: parseSafePositiveInteger(env.MONAD_CHAIN_ID!, "MONAD_CHAIN_ID"),
      contractAddress: normalizeEvmAddress(
        env.FUELBORN_CONTRACT_ADDRESS!,
      ),
      fuelPerMon: parsePositiveBigInt(env.FUEL_PER_MON!, "FUEL_PER_MON"),
      minDepositWei: parsePositiveBigInt(
        env.FUELBORN_MIN_FORGE_DEPOSIT_WEI!,
        "FUELBORN_MIN_FORGE_DEPOSIT_WEI",
      ),
      verificationLagBlocks: parseUnsignedBigInt(
        env.MONAD_VERIFICATION_LAG_BLOCKS ?? "5",
        "MONAD_VERIFICATION_LAG_BLOCKS",
      ),
      burnRateMicroFuelPerSecond: parseSafePositiveInteger(
        env.FUELBORN_IDLE_BURN_MICRO_FUEL_PER_SECOND ?? "278",
        "FUELBORN_IDLE_BURN_MICRO_FUEL_PER_SECOND",
      ),
    },
  };
}

export function createViemForgeRegistrationReader(
  rpcUrl: string,
): ForgeRegistrationReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber(),
    getRegistration: async ({ contractAddress, txHash }) => {
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: txHash as Hash });
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
      if (receipt.status !== "success") {
        throw new Error("Forge transaction reverted");
      }
      const expectedAddress = normalizeEvmAddress(contractAddress);
      for (const log of receipt.logs) {
        if (normalizeEvmAddress(log.address) !== expectedAddress) continue;
        const decoded = decodeAgentRegisteredLog({
          data: log.data,
          topics: log.topics,
        });
        if (decoded) {
          return {
            ...decoded,
            transactionHash: receipt.transactionHash,
            logIndex: log.logIndex,
            blockNumber: receipt.blockNumber,
            blockHash: receipt.blockHash,
          };
        }
      }
      return null;
    },
  };
}

export function decodeAgentRegisteredLog(log: {
  data: Hex;
  topics: readonly Hex[];
}): {
  agentId: bigint;
  smith: Address;
  metadataHash: Hex;
  depositWei: bigint;
} | null {
  try {
    const signature = log.topics[0];
    if (!signature) return null;
    const decoded = decodeEventLog({
      abi: [AGENT_REGISTERED_EVENT],
      data: log.data,
      topics: [signature, ...log.topics.slice(1)],
      strict: true,
    });
    return {
      agentId: decoded.args.agentId,
      smith: decoded.args.smith,
      metadataHash: decoded.args.metadataHash,
      depositWei: decoded.args.deposit,
    };
  } catch {
    return null;
  }
}

export function createPelicanForgeProvisioner(args: {
  api?: ApplicationApi;
  env?: ForgeEnv;
  environmentForUser?: (userId: number) => Record<string, string>;
  finalizePod?: (
    attempt: Parameters<ForgePodProvisioner["provision"]>[0],
    server: PelicanServer,
  ) => Promise<void>;
} = {}): ForgePodProvisioner {
  const api = args.api ?? (applicationApi as ApplicationApi);
  const env = args.env ?? process.env;
  const environmentForUser = args.environmentForUser ?? managedDeployEnv;
  const runtimeFinalizer = createRuntimeForgePodFinalizer(api);
  const finalizePod =
    args.finalizePod ??
    ((attempt: Parameters<ForgePodProvisioner["provision"]>[0], server: PelicanServer) =>
      runtimeFinalizer(attempt, {
        serverId: server.attributes.id,
        podFullUuid: server.attributes.uuid,
      }));

  return {
    provision: async (attempt) => {
      const egg = parseEggId(env.PELICAN_HERMES_EGG_ID);
      const sizeId = env.FUELBORN_FORGE_SIZE ?? DEFAULT_DEPLOY_SIZE_ID;
      const size = deploySizeById(sizeId);
      if (!size) throw new Error(`invalid FUELBORN_FORGE_SIZE: ${sizeId}`);
      const externalId = forgeExternalId(attempt.id);

      const existing = await findExistingServer(api, externalId);
      if (existing) {
        if (existing.attributes.user !== attempt.pelican_user_id) {
          throw new Error("existing Forge server belongs to another Pelican user");
        }
        await finalizePod(attempt, existing);
        return provisionedPod(existing);
      }

      const environment = {
        ...environmentForUser(attempt.user_id),
        HERMES_INFERENCE_MODEL: attempt.model,
      };
      await applyEggDefaults(api, egg, environment);
      const allocationId = await selectAllocation(api, env, {
        memoryMib: size.memoryMib,
        diskMib: size.diskMib,
      });
      const created = await api("/servers", {
        method: "POST",
        body: {
          external_id: externalId,
          name: attempt.name,
          user: attempt.pelican_user_id,
          egg,
          docker_image:
            env.PELICAN_HERMES_IMAGE ?? "pods-ml/sandbox-ubuntu:1.0",
          environment,
          limits: {
            memory: size.memoryMib,
            swap: 0,
            disk: size.diskMib,
            io: 500,
            cpu: size.cpuPercent,
          },
          feature_limits: { databases: 0, allocations: 1, backups: 0 },
          allocation: { default: allocationId },
          start_on_completion: true,
          skip_scripts: false,
          oom_killer: true,
        },
      }) as PelicanServer;
      await finalizePod(attempt, created);
      return provisionedPod(created);
    },
  };
}

async function findExistingServer(
  api: ApplicationApi,
  externalId: string,
): Promise<PelicanServer | null> {
  try {
    return (await api(
      `/servers/external/${encodeURIComponent(externalId)}`,
    )) as PelicanServer;
  } catch (error) {
    if (isHttpStatus(error, 404)) return null;
    throw error;
  }
}

async function applyEggDefaults(
  api: ApplicationApi,
  egg: number,
  environment: Record<string, string>,
): Promise<void> {
  const response = (await api(`/eggs/${egg}?include=variables`)) as {
    attributes: {
      relationships?: {
        variables?: {
          data?: Array<{
            attributes: { env_variable: string; default_value: string };
          }>;
        };
      };
    };
  };
  const variables =
    response.attributes.relationships?.variables?.data ?? [];
  for (const variable of variables) {
    const key = variable.attributes.env_variable;
    if (!(key in environment)) {
      environment[key] = variable.attributes.default_value;
    }
  }
}

async function selectAllocation(
  api: ApplicationApi,
  env: ForgeEnv,
  required: { memoryMib: number; diskMib: number },
): Promise<number> {
  const nodeIds = parseNodeIds(env);
  type NodeCapacity = {
    id: number;
    freeMemory: number;
    freeDisk: number | null;
  };
  const nodes: NodeCapacity[] = [];
  for (const id of nodeIds) {
    const response = (await api(`/nodes/${id}`)) as {
      attributes: {
        id: number;
        memory: number;
        memory_overallocate?: number;
        disk?: number;
        disk_overallocate?: number;
        allocated_resources: { memory: number; disk?: number };
      };
    };
    const node = response.attributes;
    const memoryCapacity = capacity(
      node.memory,
      node.memory_overallocate ?? 0,
    );
    const diskCapacity =
      node.disk == null
        ? null
        : capacity(node.disk, node.disk_overallocate ?? 0);
    nodes.push({
      id: node.id,
      freeMemory: memoryCapacity - node.allocated_resources.memory,
      freeDisk:
        diskCapacity == null
          ? null
          : diskCapacity - (node.allocated_resources.disk ?? 0),
    });
  }
  nodes.sort((left, right) => right.freeMemory - left.freeMemory);
  for (const node of nodes) {
    if (node.freeMemory < required.memoryMib) continue;
    if (node.freeDisk != null && node.freeDisk < required.diskMib) continue;
    const allocations = (await api(
      `/nodes/${node.id}/allocations?per_page=200`,
    )) as {
      data: Array<{ attributes: { id: number; assigned: boolean } }>;
    };
    const free = allocations.data.find((item) => !item.attributes.assigned);
    if (free) return free.attributes.id;
  }
  throw new Error("no Pelican capacity is available for a Forge pod");
}

function provisionedPod(server: PelicanServer): ForgeProvisionedPod {
  const attributes = server.attributes;
  return {
    podUuidShort: attributes.identifier,
    podFullUuid: attributes.uuid,
    ramMib: attributes.limits.memory,
    diskMib: attributes.limits.disk,
    cpuPercent: attributes.limits.cpu,
  };
}

function forgeExternalId(attemptId: string): string {
  return `fuelborn-${attemptId}`;
}

function parseEggId(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error("PELICAN_HERMES_EGG_ID must be configured for Forge");
  }
  return parseSafePositiveInteger(value, "PELICAN_HERMES_EGG_ID");
}

function parseNodeIds(env: ForgeEnv): number[] {
  const ids = (env.PELICAN_NODE_IDS ?? env.PELICAN_NODE_ID ?? "1")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  if (ids.length === 0) throw new Error("no valid Pelican node IDs configured");
  return ids;
}

function capacity(limit: number, overallocate: number): number {
  return overallocate === -1
    ? Number.POSITIVE_INFINITY
    : limit * (1 + overallocate / 100);
}

function isHttpStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
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
