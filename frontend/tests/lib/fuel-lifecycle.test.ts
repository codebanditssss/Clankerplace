import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "fuelborn-lifecycle-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const meter = await import("../../src/lib/billing/meter");
const ledger = await import("../../src/lib/fuelborn/ledger");
const lifecycle = await import("../../src/lib/fuelborn/lifecycle");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (301, 'life@fuelborn.test', 'x', 9301, datetime('now'))`,
).run();

meter.upsertMeterStateFromPelican({
  pod_uuid_short: "life0001",
  pod_full_uuid: "full-life0001",
  user_id: 301,
  ramMib: 4096,
  diskMib: 20000,
  cpuPercent: 200,
  initialState: "running",
  economyMode: "fuelborn",
});
ledger.createAgent({
  id: "life-agent",
  podUuidShort: "life0001",
  userId: 301,
  name: "Kiln",
  ownerWallet: "0x3333333333333333333333333333333333333333",
  chainId: 10143,
  contractAddress: "0x4444444444444444444444444444444444444444",
  tokenId: "9",
  nowSeconds: 100,
});
lifecycle.configureFuelMeter({
  agentId: "life-agent",
  burnRateMicroFuelPerSecond: 1_000,
  nowSeconds: 100,
});
ledger.appendFuelEntry({
  agentId: "life-agent",
  deltaMicroFuel: 10_000,
  reason: "adjustment",
  nowSeconds: 100,
});

test("fuel lifecycle: running agents burn exact elapsed FUEL", () => {
  const [result] = lifecycle.runFuelTick(103);

  assert.equal(result.agent_id, "life-agent");
  assert.equal(result.burned_micro_fuel, 3_000);
  assert.equal(result.balance_micro_fuel, 7_000);
  assert.equal(result.transition, null);
});

test("fuel lifecycle: reaching zero records one death and one stop effect", () => {
  const [result] = lifecycle.runFuelTick(110);

  assert.equal(result.burned_micro_fuel, 7_000);
  assert.equal(result.balance_micro_fuel, 0);
  assert.equal(result.transition, "died");
  const agent = db
    .prepare(
      `SELECT status, died_at, revival_count FROM fuelborn_agents WHERE id = ?`,
    )
    .get("life-agent") as {
    status: string;
    died_at: number;
    revival_count: number;
  };
  assert.deepEqual(agent, { status: "dead", died_at: 110, revival_count: 0 });
  assert.equal(meter.getMeterState("life0001")?.state, "stopped");
  assert.deepEqual(
    lifecycle.listPendingLifecycleEffects().map((effect) => effect.effect_key),
    ["death:life-agent:0"],
  );

  assert.deepEqual(lifecycle.runFuelTick(111), []);
  assert.equal(lifecycle.listPendingLifecycleEffects().length, 1);
});

test("fuel lifecycle: finalized funding revives once and waits for pod start", () => {
  const funding = {
    agentId: "life-agent",
    deltaMicroFuel: 5_000,
    chainEvent: {
      chainId: 10143,
      contractAddress: "0x4444444444444444444444444444444444444444",
      txHash: `0x${"b".repeat(64)}`,
      logIndex: 4,
    },
    nowSeconds: 120,
  };
  const first = lifecycle.fundAgent(funding);
  const retry = lifecycle.fundAgent({ ...funding, nowSeconds: 121 });

  assert.equal(first.credited, true);
  assert.equal(first.revived, true);
  assert.equal(retry.credited, false);
  assert.equal(retry.revived, false);
  assert.equal(ledger.getFuelBalance("life-agent"), 5_000);
  const agent = db
    .prepare(
      `SELECT status, died_at, revival_count FROM fuelborn_agents WHERE id = ?`,
    )
    .get("life-agent") as {
    status: string;
    died_at: number;
    revival_count: number;
  };
  assert.deepEqual(agent, { status: "alive", died_at: 110, revival_count: 1 });
  assert.equal(meter.getMeterState("life0001")?.state, "provisioning");
  assert.deepEqual(
    lifecycle.listPendingLifecycleEffects().map((effect) => effect.effect_key),
    ["death:life-agent:0", "revival:life-agent:1"],
  );
});

test("fuel lifecycle: completing revival starts a fresh burn window", () => {
  const start = lifecycle
    .listPendingLifecycleEffects()
    .find((effect) => effect.kind === "power_start");
  assert.ok(start);

  lifecycle.markLifecycleEffectCompleted(start.id, 125);

  assert.equal(meter.getMeterState("life0001")?.state, "running");
  const [result] = lifecycle.runFuelTick(126);
  assert.equal(result.burned_micro_fuel, 1_000);
  assert.equal(result.balance_micro_fuel, 4_000);
});

test("fuel lifecycle: refuses to meter a legacy billing pod", () => {
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "legacy301",
    pod_full_uuid: "full-legacy301",
    user_id: 301,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "running",
  });
  ledger.createAgent({
    id: "wrong-economy",
    podUuidShort: "legacy301",
    userId: 301,
    name: "Wrong",
    ownerWallet: "0x3333333333333333333333333333333333333333",
    chainId: 10143,
    contractAddress: "0x4444444444444444444444444444444444444444",
    tokenId: "10",
    nowSeconds: 200,
  });

  assert.throws(
    () =>
      lifecycle.configureFuelMeter({
        agentId: "wrong-economy",
        burnRateMicroFuelPerSecond: 1_000,
      }),
    /not owned by the FuelBorn economy/,
  );
});
