import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "fuelborn-chain-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const meter = await import("../../src/lib/billing/meter");
const ledger = await import("../../src/lib/fuelborn/ledger");
const lifecycle = await import("../../src/lib/fuelborn/lifecycle");
const chain = await import("../../src/lib/fuelborn/chain-events");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (401, 'chain@fuelborn.test', 'x', 9401, datetime('now'))`,
).run();
meter.upsertMeterStateFromPelican({
  pod_uuid_short: "chain001",
  pod_full_uuid: "full-chain001",
  user_id: 401,
  ramMib: 4096,
  diskMib: 20000,
  cpuPercent: 200,
  initialState: "running",
  economyMode: "fuelborn",
});
ledger.createAgent({
  id: "chain-agent",
  podUuidShort: "chain001",
  userId: 401,
  name: "Relay",
  ownerWallet: "0x5555555555555555555555555555555555555555",
  chainId: 10143,
  contractAddress: "0x6666666666666666666666666666666666666666",
  tokenId: "12",
  nowSeconds: 100,
});
lifecycle.configureFuelMeter({
  agentId: "chain-agent",
  burnRateMicroFuelPerSecond: 1_000,
  nowSeconds: 100,
});
ledger.appendFuelEntry({
  agentId: "chain-agent",
  deltaMicroFuel: 1_000,
  reason: "adjustment",
  nowSeconds: 100,
});
lifecycle.runFuelTick(101);

const event = {
  agentId: "chain-agent",
  deltaMicroFuel: 5_000,
  chainEvent: {
    chainId: 10143,
    contractAddress: "0x6666666666666666666666666666666666666666",
    txHash: `0x${"c".repeat(64)}`,
    logIndex: 2,
  },
  blockNumber: BigInt(12_345),
  blockHash: `0x${"d".repeat(64)}`,
  nowSeconds: 110,
};

test("chain projection: observed funding is pending and idempotent", () => {
  const first = chain.observeFundingEvent(event);
  const retry = chain.observeFundingEvent({ ...event, nowSeconds: 111 });

  assert.equal(first.created, true);
  assert.equal(first.event.status, "observed");
  assert.equal(retry.created, false);
  assert.equal(retry.event.id, first.event.id);
  assert.equal(ledger.getFuelBalance("chain-agent"), 0);
});

test("chain projection: conflicting replay is rejected", () => {
  assert.throws(
    () =>
      chain.observeFundingEvent({
        ...event,
        deltaMicroFuel: 50_000,
      }),
    /chain event conflict/,
  );
});

test("chain projection: only verified funding becomes spendable", () => {
  chain.markFundingVerified(event.chainEvent, 120);
  assert.equal(ledger.getFuelBalance("chain-agent"), 0);

  const first = chain.applyVerifiedFunding(event.chainEvent, 121);
  const retry = chain.applyVerifiedFunding(event.chainEvent, 122);

  assert.equal(first.applied, true);
  assert.equal(first.credited, true);
  assert.equal(first.revived, true);
  assert.deepEqual(retry, {
    applied: false,
    credited: false,
    revived: false,
  });
  assert.equal(ledger.getFuelBalance("chain-agent"), 5_000);
  assert.equal(chain.getChainEvent(event.chainEvent)?.status, "applied");
});

test("chain projection: sync cursor is monotonic and stored exactly", () => {
  assert.equal(
    chain.getSyncCursor(10143, event.chainEvent.contractAddress),
    null,
  );
  chain.setSyncCursor({
    chainId: 10143,
    contractAddress: event.chainEvent.contractAddress,
    blockNumber: BigInt(12_345),
    nowSeconds: 130,
  });
  chain.setSyncCursor({
    chainId: 10143,
    contractAddress: event.chainEvent.contractAddress,
    blockNumber: BigInt(12_345),
    nowSeconds: 131,
  });
  assert.equal(
    chain.getSyncCursor(10143, event.chainEvent.contractAddress),
    BigInt(12_345),
  );
  assert.throws(
    () =>
      chain.setSyncCursor({
        chainId: 10143,
        contractAddress: event.chainEvent.contractAddress,
        blockNumber: BigInt(12_344),
      }),
    /cannot move backwards/,
  );
});
