import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "fuelborn-ledger-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const fuel = await import("../../src/lib/fuelborn/ledger");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (201, 'smith@fuelborn.test', 'x', 9201, datetime('now'))`,
).run();

const contract = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";

fuel.createAgent({
  id: "agent-one",
  podUuidShort: "fuel0001",
  userId: 201,
  name: "Ember",
  ownerWallet: wallet,
  chainId: 10143,
  contractAddress: contract,
  tokenId: "1",
  nowSeconds: 1_000,
});

test("fuel ledger: integer credits and burns produce an exact balance", () => {
  fuel.appendFuelEntry({
    agentId: "agent-one",
    deltaMicroFuel: 10_000_000,
    reason: "funding",
    nowSeconds: 1_001,
  });
  fuel.appendFuelEntry({
    agentId: "agent-one",
    deltaMicroFuel: -1_250_000,
    reason: "idle_burn",
    nowSeconds: 1_002,
  });

  assert.equal(fuel.getFuelBalance("agent-one"), 8_750_000);
  assert.deepEqual(
    fuel.listFuelEntries("agent-one").map((entry) => entry.delta_micro_fuel),
    [-1_250_000, 10_000_000],
  );
});

test("fuel ledger: the same finalized chain log credits only once", () => {
  const chainEvent = {
    chainId: 10143,
    contractAddress: contract.toUpperCase(),
    txHash: `0x${"a".repeat(64)}`,
    logIndex: 7,
  };
  const first = fuel.appendFuelEntry({
    agentId: "agent-one",
    deltaMicroFuel: 5_000_000,
    reason: "funding",
    chainEvent,
    nowSeconds: 1_003,
  });
  const retry = fuel.appendFuelEntry({
    agentId: "agent-one",
    deltaMicroFuel: 5_000_000,
    reason: "funding",
    chainEvent,
    nowSeconds: 1_004,
  });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.entry.id, first.entry.id);
  assert.equal(fuel.getFuelBalance("agent-one"), 13_750_000);
});

test("fuel ledger: conflicting reuse of a chain log is rejected", () => {
  assert.throws(
    () =>
      fuel.appendFuelEntry({
        agentId: "agent-one",
        deltaMicroFuel: 99_000_000,
        reason: "funding",
        chainEvent: {
          chainId: 10143,
          contractAddress: contract,
          txHash: `0x${"a".repeat(64)}`,
          logIndex: 7,
        },
      }),
    /chain event conflict/,
  );
});

test("fuel ledger: rejects fractional micro-FUEL values", () => {
  assert.throws(
    () =>
      fuel.appendFuelEntry({
        agentId: "agent-one",
        deltaMicroFuel: 0.5,
        reason: "adjustment",
      }),
    /safe non-zero integer/,
  );
});

test("fuel ledger: balances are isolated per agent", () => {
  fuel.createAgent({
    id: "agent-two",
    podUuidShort: "fuel0002",
    userId: 201,
    name: "Cinder",
    ownerWallet: wallet,
    chainId: 10143,
    contractAddress: contract,
    tokenId: "2",
    nowSeconds: 2_000,
  });
  fuel.appendFuelEntry({
    agentId: "agent-two",
    deltaMicroFuel: 2_000_000,
    reason: "funding",
  });

  assert.equal(fuel.getFuelBalance("agent-two"), 2_000_000);
  assert.equal(fuel.getFuelBalance("agent-one"), 13_750_000);
});

test("fuel ledger: hard-deleting an owner removes their agent journals", () => {
  db.prepare(`DELETE FROM users WHERE id = ?`).run(201);

  const agents = db
    .prepare(`SELECT COUNT(*) AS count FROM fuelborn_agents`)
    .get() as { count: number };
  const entries = db
    .prepare(`SELECT COUNT(*) AS count FROM fuel_ledger`)
    .get() as { count: number };
  assert.equal(agents.count, 0);
  assert.equal(entries.count, 0);
});
