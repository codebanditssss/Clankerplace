import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ForgeAttemptRow } from "../../src/lib/db";
import type { ApplicationApi } from "../../src/lib/fuelborn/forge-runtime";
import { encodeAbiParameters, encodeEventTopics } from "viem";

const runtime = await import("../../src/lib/fuelborn/forge-runtime");

test("forge runtime: environment becomes an exact Forge configuration", () => {
  const loaded = runtime.loadForgeRuntimeConfig({
    MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
    MONAD_CHAIN_ID: "10143",
    FUELBORN_CONTRACT_ADDRESS:
      "0x1111111111111111111111111111111111111111",
    FUEL_PER_MON: "100",
    FUELBORN_MIN_FORGE_DEPOSIT_WEI: "10000000000000000",
    MONAD_VERIFICATION_LAG_BLOCKS: "5",
    FUELBORN_IDLE_BURN_MICRO_FUEL_PER_SECOND: "278",
  });

  assert.equal(loaded.rpcUrl, "https://testnet-rpc.monad.xyz");
  assert.deepEqual(loaded.forge, {
    chainId: 10143,
    contractAddress: "0x1111111111111111111111111111111111111111",
    fuelPerMon: BigInt(100),
    minDepositWei: BigInt("10000000000000000"),
    verificationLagBlocks: BigInt(5),
    burnRateMicroFuelPerSecond: 278,
  });
});

test("forge runtime: incomplete or unsafe environment is rejected", () => {
  assert.throws(
    () => runtime.loadForgeRuntimeConfig({ MONAD_CHAIN_ID: "10143" }),
    /missing MONAD_RPC_URL/,
  );
  assert.throws(
    () =>
      runtime.loadForgeRuntimeConfig({
        MONAD_RPC_URL: "file:///tmp/rpc",
        MONAD_CHAIN_ID: "10143",
        FUELBORN_CONTRACT_ADDRESS:
          "0x1111111111111111111111111111111111111111",
        FUEL_PER_MON: "100",
        FUELBORN_MIN_FORGE_DEPOSIT_WEI: "1",
      }),
    /must use http or https/,
  );
});

test("forge runtime: decodes the contract's exact AgentRegistered event", () => {
  const metadataHash = `0x${"a".repeat(64)}` as const;
  const topics = encodeEventTopics({
    abi: [runtime.AGENT_REGISTERED_EVENT],
    eventName: "AgentRegistered",
    args: {
      agentId: BigInt(77),
      smith: "0x2222222222222222222222222222222222222222",
    },
  });
  const data = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }],
    [metadataHash, BigInt("100000000000000000")],
  );

  assert.deepEqual(runtime.decodeAgentRegisteredLog({ data, topics }), {
    agentId: BigInt(77),
    smith: "0x2222222222222222222222222222222222222222",
    metadataHash,
    depositWei: BigInt("100000000000000000"),
  });
});

const attempt = {
  id: "attempt-123",
  user_id: 601,
  pelican_user_id: 9601,
  name: "Ember",
  model: "glm-5.2",
} as ForgeAttemptRow;

test("forge runtime: provisioning retries recover the deterministic Pelican server", async () => {
  const calls: Array<{ path: string; opts: unknown }> = [];
  const api: ApplicationApi = async (path, opts) => {
    calls.push({ path, opts });
    if (path.startsWith("/servers/external/")) {
      return {
        attributes: {
          id: 77,
          uuid: "full-existing-77",
          identifier: "exist077",
          user: 9601,
          limits: { memory: 2048, disk: 10240, cpu: 100 },
        },
      };
    }
    throw new Error(`unexpected ${path}`);
  };
  const provisioner = runtime.createPelicanForgeProvisioner({
    api,
    env: { PELICAN_HERMES_EGG_ID: "15" },
    environmentForUser: () => ({ MANAGED: "yes" }),
  });

  const pod = await provisioner.provision(attempt);

  assert.deepEqual(pod, {
    podUuidShort: "exist077",
    podFullUuid: "full-existing-77",
    ramMib: 2048,
    diskMib: 10240,
    cpuPercent: 100,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /fuelborn-attempt-123$/);
});

test("forge runtime: new provisioning picks capacity and sends one idempotent create", async () => {
  const calls: Array<{ path: string; opts?: { method?: string; body?: unknown } }> = [];
  const api: ApplicationApi = async (path, opts = {}) => {
    calls.push({ path, opts });
    if (path.startsWith("/servers/external/")) {
      throw Object.assign(new Error("not found"), { status: 404 });
    }
    if (path === "/eggs/15?include=variables") {
      return {
        attributes: {
          relationships: {
            variables: {
              data: [
                {
                  attributes: {
                    env_variable: "DEFAULT_ONLY",
                    default_value: "egg-default",
                  },
                },
              ],
            },
          },
        },
      };
    }
    if (path === "/nodes/1") {
      return {
        attributes: {
          id: 1,
          memory: 8192,
          memory_overallocate: 0,
          allocated_resources: { memory: 4096 },
        },
      };
    }
    if (path === "/nodes/2") {
      return {
        attributes: {
          id: 2,
          memory: 16384,
          memory_overallocate: 0,
          allocated_resources: { memory: 4096 },
        },
      };
    }
    if (path === "/nodes/2/allocations?per_page=200") {
      return {
        data: [
          { attributes: { id: 88, assigned: true } },
          { attributes: { id: 89, assigned: false } },
        ],
      };
    }
    if (path === "/servers" && opts.method === "POST") {
      return {
        attributes: {
          id: 78,
          uuid: "full-created-78",
          identifier: "create78",
          user: 9601,
          limits: { memory: 2048, disk: 10240, cpu: 100 },
        },
      };
    }
    throw new Error(`unexpected ${path}`);
  };
  const provisioner = runtime.createPelicanForgeProvisioner({
    api,
    env: {
      PELICAN_HERMES_EGG_ID: "15",
      PELICAN_NODE_IDS: "1,2",
      PELICAN_HERMES_IMAGE: "fuelborn/hermes:test",
    },
    environmentForUser: (userId) => ({
      MANAGED_USER: String(userId),
    }),
  });

  const pod = await provisioner.provision(attempt);
  const create = calls.find((call) => call.path === "/servers");
  const body = create?.opts?.body as Record<string, unknown>;

  assert.equal(pod.podUuidShort, "create78");
  assert.equal(body.external_id, "fuelborn-attempt-123");
  assert.equal(body.user, 9601);
  assert.equal(body.egg, 15);
  assert.equal(body.docker_image, "fuelborn/hermes:test");
  assert.deepEqual(body.environment, {
    MANAGED_USER: "601",
    HERMES_INFERENCE_MODEL: "glm-5.2",
    DEFAULT_ONLY: "egg-default",
  });
  assert.deepEqual(body.allocation, { default: 89 });
});
