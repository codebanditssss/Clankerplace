import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodeFunctionData } from "viem";

const client = await import("../../src/lib/forge-client");

test("forge client: MON input converts to exact wei, FUEL, and idle lifetime", () => {
  assert.deepEqual(client.quoteForgeDeposit("0.1"), {
    wei: BigInt("100000000000000000"),
    fuelMicro: BigInt("10000000"),
    fuelLabel: "10",
    idleLifetimeSeconds: BigInt(36_000),
  });
  assert.deepEqual(client.quoteForgeDeposit("1.23456789"), {
    wei: BigInt("1234567890000000000"),
    fuelMicro: BigInt("123456789"),
    fuelLabel: "123.456789",
    idleLifetimeSeconds: BigInt(444_444),
  });
});

test("forge client: malformed, zero, and over-precise MON inputs are rejected", () => {
  for (const value of ["", "0", "-0.1", "1e2", ".1", "1.0000000000000000001"]) {
    assert.throws(() => client.quoteForgeDeposit(value), /valid positive MON amount/);
  }
});

test("forge client: wallet transaction encodes the backend-approved registerAgent call", () => {
  const metadataHash = `0x${"a".repeat(64)}`;
  const transaction = client.buildRegisterAgentTransaction({
    from: "0x2222222222222222222222222222222222222222",
    request: {
      chainId: 10143,
      address: "0x1111111111111111111111111111111111111111",
      functionName: "registerAgent",
      args: [metadataHash],
      value: "100000000000000000",
    },
  });

  assert.equal(transaction.from, "0x2222222222222222222222222222222222222222");
  assert.equal(transaction.to, "0x1111111111111111111111111111111111111111");
  assert.equal(transaction.value, "0x16345785d8a0000");
  assert.deepEqual(
    decodeFunctionData({ abi: client.FORGE_ABI, data: transaction.data }),
    {
      functionName: "registerAgent",
      args: [metadataHash],
    },
  );
  assert.equal(client.chainIdHex(10143), "0x279f");
});

test("forge client: backend status maps to truthful ignition copy", () => {
  assert.deepEqual(client.ignitionStage("submitted"), {
    index: 0,
    label: "Verifying birth",
  });
  assert.deepEqual(client.ignitionStage("provisioning"), {
    index: 1,
    label: "Allocating pod",
  });
  assert.deepEqual(client.ignitionStage("provisioned"), {
    index: 2,
    label: "Loading FUEL",
  });
  assert.deepEqual(client.ignitionStage("active"), {
    index: 3,
    label: "Ignition ready",
  });
});

test("forge client: pod installation retries keep the allocation stage visible", () => {
  assert.equal(client.pendingIgnitionIndex("forge_pod_pending"), 1);
  assert.equal(client.pendingIgnitionIndex("forge_not_ready"), 0);
});
