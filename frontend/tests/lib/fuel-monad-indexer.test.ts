import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "fuelborn-monad-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const meter = await import("../../src/lib/billing/meter");
const ledger = await import("../../src/lib/fuelborn/ledger");
const chain = await import("../../src/lib/fuelborn/chain-events");
const monad = await import("../../src/lib/fuelborn/monad-indexer");

const contractAddress = "0x8888888888888888888888888888888888888888";

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (501, 'monad@fuelborn.test', 'x', 9501, datetime('now'))`,
).run();
meter.upsertMeterStateFromPelican({
  pod_uuid_short: "monad001",
  pod_full_uuid: "full-monad001",
  user_id: 501,
  ramMib: 4096,
  diskMib: 20000,
  cpuPercent: 200,
  initialState: "running",
  economyMode: "fuelborn",
});
ledger.createAgent({
  id: "monad-agent",
  podUuidShort: "monad001",
  userId: 501,
  name: "Clanker",
  ownerWallet: "0x7777777777777777777777777777777777777777",
  chainId: 10143,
  contractAddress,
  tokenId: "42",
  nowSeconds: 100,
});

let latestBlock = BigInt(110);
const scannedRanges: Array<[bigint, bigint]> = [];
const fundingLog: monad.MonadFundingLog = {
  agentId: BigInt(42),
  amountWei: BigInt("100000000000000000"),
  transactionHash: `0x${"a".repeat(64)}`,
  logIndex: 3,
  blockNumber: BigInt(106),
  blockHash: `0x${"b".repeat(64)}`,
};
const reader: monad.MonadFundingReader = {
  getChainId: async () => 10143,
  getBlockNumber: async () => latestBlock,
  getFundingLogs: async ({ fromBlock, toBlock }) => {
    scannedRanges.push([fromBlock, toBlock]);
    return fromBlock <= fundingLog.blockNumber &&
      fundingLog.blockNumber <= toBlock
      ? [fundingLog]
      : [];
  },
};
const config: monad.MonadFundingConfig = {
  chainId: 10143,
  contractAddress,
  startBlock: BigInt(100),
  verificationLagBlocks: BigInt(5),
  maxBlockRange: BigInt(1_000),
  fuelPerMon: BigInt(100),
};

test("Monad indexer observes funding before it becomes spendable", async () => {
  const result = await monad.syncMonadFunding({
    reader,
    config,
    nowSeconds: 200,
  });

  assert.equal(result.observed, 1);
  assert.equal(result.applied, 0);
  assert.equal(result.verified_through_block, "105");
  assert.deepEqual(scannedRanges, [[BigInt(100), BigInt(110)]]);
  assert.equal(ledger.getFuelBalance("monad-agent"), 0);
  assert.equal(
    chain.getChainEvent({
      chainId: 10143,
      contractAddress,
      txHash: fundingLog.transactionHash,
      logIndex: fundingLog.logIndex,
    })?.status,
    "observed",
  );
});

test("Monad indexer applies at T+5 and never credits a replay twice", async () => {
  latestBlock = BigInt(111);
  const verified = await monad.syncMonadFunding({
    reader,
    config,
    nowSeconds: 201,
  });
  const replay = await monad.syncMonadFunding({
    reader,
    config,
    nowSeconds: 202,
  });

  assert.equal(verified.applied, 1);
  assert.equal(replay.applied, 0);
  assert.equal(ledger.getFuelBalance("monad-agent"), 10_000_000);
  assert.equal(
    chain.getSyncCursor(10143, contractAddress),
    BigInt(111),
  );
});

test("Monad indexer rejects an RPC connected to the wrong chain", async () => {
  await assert.rejects(
    monad.syncMonadFunding({
      reader: { ...reader, getChainId: async () => 143 },
      config,
      nowSeconds: 203,
    }),
    /RPC chain ID 143 does not match configured chain ID 10143/,
  );
});

test("MON converts to exact integer micro-FUEL without float math", () => {
  assert.equal(
    monad.monWeiToMicroFuel(
      BigInt("100000000000000000"),
      BigInt(100),
    ),
    10_000_000,
  );
  assert.throws(
    () => monad.monWeiToMicroFuel(BigInt(1), BigInt(100)),
    /too small to mint one micro-FUEL/,
  );
});
