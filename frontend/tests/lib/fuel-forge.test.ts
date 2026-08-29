import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import type {
  ForgeConfig,
  ForgePodProvisioner,
  ForgeRegistrationReader,
} from "../../src/lib/fuelborn/forge";

const dir = mkdtempSync(join(tmpdir(), "fuelborn-forge-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const forge = await import("../../src/lib/fuelborn/forge");
const ledger = await import("../../src/lib/fuelborn/ledger");
const meter = await import("../../src/lib/billing/meter");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (601, 'forge@fuelborn.test', 'x', 9601, datetime('now'))`,
).run();

const contractAddress = "0x1111111111111111111111111111111111111111";
const ownerWallet = "0x2222222222222222222222222222222222222222";
const txHash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const config: ForgeConfig = {
  chainId: 10143,
  contractAddress,
  verificationLagBlocks: BigInt(5),
  fuelPerMon: BigInt(100),
  minDepositWei: BigInt("10000000000000000"),
  burnRateMicroFuelPerSecond: 278,
};

const prepared = forge.prepareForge({
  userId: 601,
  pelicanUserId: 9601,
  idempotencyKey: "forge-request-one",
  name: "Ember",
  mission: "Research Monad ecosystem projects",
  personality: "Precise, curious, and concise",
  model: "glm-5.2",
  ownerWallet: ownerWallet.toUpperCase(),
  depositWei: "100000000000000000",
  config,
  nowSeconds: 1_000,
});

test("forge: prepare returns one stable contract call for idempotent retries", () => {
  const retry = forge.prepareForge({
    userId: 601,
    pelicanUserId: 9601,
    idempotencyKey: "forge-request-one",
    name: "Ember",
    mission: "Research Monad ecosystem projects",
    personality: "Precise, curious, and concise",
    model: "glm-5.2",
    ownerWallet,
    depositWei: "100000000000000000",
    config,
    nowSeconds: 1_001,
  });

  assert.equal(retry.attempt.id, prepared.attempt.id);
  assert.deepEqual(retry.transaction, prepared.transaction);
  assert.deepEqual(retry.transaction, {
    chainId: 10143,
    address: contractAddress,
    functionName: "registerAgent",
    args: [prepared.attempt.metadata_hash],
    value: "100000000000000000",
  });
  const count = db
    .prepare(`SELECT COUNT(*) AS count FROM forge_attempts`)
    .get() as { count: number };
  assert.equal(count.count, 1);
});

test("forge: reusing an idempotency key for different content is rejected", () => {
  assert.throws(
    () =>
      forge.prepareForge({
        userId: 601,
        pelicanUserId: 9601,
        idempotencyKey: "forge-request-one",
        name: "Different",
        mission: "Research Monad ecosystem projects",
        personality: "Precise, curious, and concise",
        model: "glm-5.2",
        ownerWallet,
        depositWei: "100000000000000000",
        config,
      }),
    /idempotency key already belongs to a different Forge request/,
  );
});

test("forge: transaction submission is stable and conflicting hashes fail", () => {
  const first = forge.submitForgeTransaction({
    attemptId: prepared.attempt.id,
    userId: 601,
    txHash: txHash.toUpperCase(),
    nowSeconds: 1_010,
  });
  const retry = forge.submitForgeTransaction({
    attemptId: prepared.attempt.id,
    userId: 601,
    txHash,
    nowSeconds: 1_011,
  });

  assert.equal(first.status, "submitted");
  assert.equal(retry.tx_hash, txHash);
  assert.throws(
    () =>
      forge.submitForgeTransaction({
        attemptId: prepared.attempt.id,
        userId: 601,
        txHash: `0x${"c".repeat(64)}`,
      }),
    /different transaction/,
  );
});

let latestBlock = BigInt(104);
let provisionCalls = 0;
const reader: ForgeRegistrationReader = {
  getChainId: async () => 10143,
  getBlockNumber: async () => latestBlock,
  getRegistration: async () => ({
    agentId: BigInt(77),
    smith: ownerWallet,
    metadataHash: prepared.attempt.metadata_hash,
    depositWei: BigInt("100000000000000000"),
    transactionHash: txHash,
    logIndex: 2,
    blockNumber: BigInt(100),
    blockHash,
  }),
};
const provisioner: ForgePodProvisioner = {
  provision: async () => {
    provisionCalls += 1;
    return {
      podUuidShort: "forge077",
      podFullUuid: "full-forge-077",
      ramMib: 2048,
      diskMib: 10240,
      cpuPercent: 100,
    };
  },
};

test("forge: birth waits for the configured confirmation lag", async () => {
  const result = await forge.advanceForge({
    attemptId: prepared.attempt.id,
    userId: 601,
    reader,
    provisioner,
    config,
    nowSeconds: 1_020,
  });

  assert.equal(result.status, "submitted");
  assert.equal(result.confirmationsRemaining, BigInt(1));
  assert.equal(provisionCalls, 0);
});

test("forge: a verified birth provisions and activates exactly once", async () => {
  latestBlock = BigInt(105);
  const active = await forge.advanceForge({
    attemptId: prepared.attempt.id,
    userId: 601,
    reader,
    provisioner,
    config,
    nowSeconds: 1_030,
  });
  const replay = await forge.advanceForge({
    attemptId: prepared.attempt.id,
    userId: 601,
    reader,
    provisioner,
    config,
    nowSeconds: 1_031,
  });

  assert.equal(active.status, "active");
  assert.equal(replay.status, "active");
  assert.equal(provisionCalls, 1);
  assert.equal(active.attempt.token_id, "77");
  assert.equal(active.attempt.pod_uuid_short, "forge077");
  assert.equal(ledger.getFuelBalance(prepared.attempt.agent_id), 10_000_000);
  assert.equal(meter.getMeterState("forge077")?.economy_mode, "fuelborn");
  const agent = db
    .prepare(`SELECT status FROM fuelborn_agents WHERE id = ?`)
    .get(prepared.attempt.agent_id) as { status: string };
  assert.equal(agent.status, "alive");
  const entries = db
    .prepare(`SELECT COUNT(*) AS count FROM fuel_ledger WHERE agent_id = ?`)
    .get(prepared.attempt.agent_id) as { count: number };
  assert.equal(entries.count, 1);
});

test("forge: exact registration fields are required", async () => {
  const second = forge.prepareForge({
    userId: 601,
    pelicanUserId: 9601,
    idempotencyKey: "forge-request-two",
    name: "Cinder",
    mission: "Watch contract activity",
    personality: "Direct",
    model: "glm-5.2",
    ownerWallet,
    depositWei: "100000000000000000",
    config,
  });
  forge.submitForgeTransaction({
    attemptId: second.attempt.id,
    userId: 601,
    txHash: `0x${"d".repeat(64)}`,
  });

  await assert.rejects(
    forge.advanceForge({
      attemptId: second.attempt.id,
      userId: 601,
      reader: {
        ...reader,
        getRegistration: async () => ({
          agentId: BigInt(78),
          smith: "0x9999999999999999999999999999999999999999",
          metadataHash: second.attempt.metadata_hash,
          depositWei: BigInt("100000000000000000"),
          transactionHash: `0x${"d".repeat(64)}`,
          logIndex: 1,
          blockNumber: BigInt(100),
          blockHash,
        }),
      },
      provisioner,
      config,
    }),
    /smith does not match/,
  );
});
