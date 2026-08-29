import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const deployment = await import("../../src/lib/fuelborn/deployment");

const treasury = "0x1111111111111111111111111111111111111111";
const relayer = "0x2222222222222222222222222222222222222222";
const contractAddress = "0x3333333333333333333333333333333333333333";
const transactionHash = `0x${"a".repeat(64)}` as `0x${string}`;
const foundryBroadcastFixture = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      "tests",
      "fixtures",
      "foundry-fuelborn-broadcast.json",
    ),
    "utf8",
  ),
) as unknown;

const env = {
  MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
  MONAD_CHAIN_ID: "10143",
  FUELBORN_DEPLOYER_ACCOUNT: "fuelborn-testnet",
  FUELBORN_TREASURY_ADDRESS: treasury,
  FUELBORN_RELAYER_ADDRESS: relayer,
  FUELBORN_MIN_FORGE_DEPOSIT_WEI: "100000000000000000",
  FUEL_PER_MON: "100",
};

test("FuelBorn deployment: loads a safe Monad testnet configuration", () => {
  assert.deepEqual(deployment.loadFuelBornDeploymentConfig(env), {
    rpcUrl: "https://testnet-rpc.monad.xyz/",
    chainId: 10143,
    deployerAccount: "fuelborn-testnet",
    treasury,
    relayer,
    minForgeDepositWei: BigInt("100000000000000000"),
    fuelPerMon: BigInt(100),
  });
});

test("FuelBorn deployment: verification-only mode does not require a signer", () => {
  const { FUELBORN_DEPLOYER_ACCOUNT: _account, ...withoutAccount } = env;

  assert.equal(
    deployment.loadFuelBornDeploymentConfig(withoutAccount, {
      requireDeployerAccount: false,
    }).deployerAccount,
    null,
  );
});

test("FuelBorn deployment: rejects wrong-chain, raw-key, and unsafe constructor input", () => {
  assert.throws(
    () =>
      deployment.loadFuelBornDeploymentConfig({
        ...env,
        MONAD_CHAIN_ID: "1",
      }),
    /must be Monad testnet chain 10143/,
  );
  assert.throws(
    () =>
      deployment.loadFuelBornDeploymentConfig({
        ...env,
        FUELBORN_DEPLOYER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
      }),
    /raw deployer private keys are not accepted/,
  );
  assert.throws(
    () =>
      deployment.loadFuelBornDeploymentConfig({
        ...env,
        FUELBORN_TREASURY_ADDRESS:
          "0x0000000000000000000000000000000000000000",
      }),
    /treasury address cannot be zero/,
  );
  assert.throws(
    () =>
      deployment.loadFuelBornDeploymentConfig({
        ...env,
        FUELBORN_DEPLOYER_ACCOUNT: "../../wallet",
      }),
    /invalid Foundry account name/,
  );
});

test("FuelBorn deployment: reads the successful FuelBorn creation receipt", () => {
  const record = deployment.deploymentRecordFromBroadcast(
    foundryBroadcastFixture,
  );

  assert.deepEqual(record, {
    contractAddress: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    transactionHash:
      "0x9d82d770d30a7736ea136624db67ef90b7496ebf59732caefb65e9ff0bffc9de",
    deployBlock: BigInt(1),
  });
});

test("FuelBorn deployment: rejects failed or ambiguous broadcast artifacts", () => {
  assert.throws(
    () =>
      deployment.deploymentRecordFromBroadcast({
        transactions: [
          {
            hash: transactionHash,
            transactionType: "CREATE",
            contractName: "FuelBorn",
            contractAddress,
          },
        ],
        receipts: [
          {
            transactionHash,
            contractAddress,
            status: "0x0",
            blockNumber: "0x1234",
          },
        ],
      }),
    /deployment transaction did not succeed/,
  );
  assert.throws(
    () =>
      deployment.deploymentRecordFromBroadcast({
        transactions: [
          {
            hash: transactionHash,
            transactionType: "CREATE",
            contractName: "FuelBorn",
            contractAddress,
          },
          {
            hash: `0x${"b".repeat(64)}`,
            transactionType: "CREATE",
            contractName: "FuelBorn",
            contractAddress: "0x4444444444444444444444444444444444444444",
          },
        ],
        receipts: [],
      }),
    /expected exactly one FuelBorn deployment/,
  );
  assert.throws(
    () =>
      deployment.deploymentRecordFromBroadcast({
        transactions: [
          {
            hash: transactionHash,
            transactionType: "CREATE",
            contractName: "FuelBorn",
            contractAddress,
          },
        ],
        receipts: [
          {
            transactionHash,
            contractAddress,
            status: "0x1",
            blockNumber: "0x1234",
          },
          {
            transactionHash,
            contractAddress,
            status: "0x1",
            blockNumber: "0x1234",
          },
        ],
      }),
    /expected exactly one FuelBorn deployment receipt/,
  );
});

test("FuelBorn deployment: verifies runtime bytecode and immutable constructor state", () => {
  const runtimeArtifact = {
    object: "0x60010000000055",
    immutableReferences: {
      treasury: [{ start: 2, length: 4 }],
    },
  };
  assert.doesNotThrow(() =>
    deployment.assertFuelBornDeployment(
      {
        chainId: 10143,
        bytecode: "0x6001aabbccdd55",
        treasury,
        relayer,
        minForgeDepositWei: BigInt("100000000000000000"),
      },
      deployment.loadFuelBornDeploymentConfig(env),
      runtimeArtifact,
    ),
  );
  assert.throws(
    () =>
      deployment.assertFuelBornDeployment(
        {
          chainId: 10143,
          bytecode: "0x6001aabbccdd55",
          treasury,
          relayer,
          minForgeDepositWei: BigInt(1),
        },
        deployment.loadFuelBornDeploymentConfig(env),
        runtimeArtifact,
      ),
    /minimum Forge deposit does not match/,
  );
  assert.throws(
    () =>
      deployment.assertFuelBornDeployment(
        {
          chainId: 10143,
          bytecode: "0x",
          treasury,
          relayer,
          minForgeDepositWei: BigInt("100000000000000000"),
        },
        deployment.loadFuelBornDeploymentConfig(env),
        runtimeArtifact,
      ),
    /has no bytecode/,
  );
  assert.throws(
    () =>
      deployment.assertFuelBornDeployment(
        {
          chainId: 10143,
          bytecode: "0x6001aabbccdd56",
          treasury,
          relayer,
          minForgeDepositWei: BigInt("100000000000000000"),
        },
        deployment.loadFuelBornDeploymentConfig(env),
        runtimeArtifact,
      ),
    /runtime bytecode does not match/,
  );
});

test("FuelBorn deployment: prints the complete frontend Forge environment", () => {
  const config = deployment.loadFuelBornDeploymentConfig(env);
  const output = deployment.formatFuelBornFrontendEnv(config, {
    contractAddress,
    transactionHash,
    deployBlock: BigInt(0x1234),
  });

  assert.equal(
    output,
    [
      "MONAD_RPC_URL=https://testnet-rpc.monad.xyz/",
      "MONAD_CHAIN_ID=10143",
      `FUELBORN_CONTRACT_ADDRESS=${contractAddress}`,
      "FUELBORN_CONTRACT_DEPLOY_BLOCK=4660",
      "FUEL_PER_MON=100",
      "FUELBORN_MIN_FORGE_DEPOSIT_WEI=100000000000000000",
      "MONAD_VERIFICATION_LAG_BLOCKS=5",
      "FUELBORN_IDLE_BURN_MICRO_FUEL_PER_SECOND=278",
    ].join("\n"),
  );
});

test("FuelBorn deployment: builds a keystore-only Foundry broadcast command", () => {
  const config = deployment.loadFuelBornDeploymentConfig(env);

  assert.deepEqual(deployment.forgeDeploymentArguments(config), [
    "script/DeployFuelBorn.s.sol:DeployFuelBorn",
    "--rpc-url",
    "https://testnet-rpc.monad.xyz/",
    "--chain-id",
    "10143",
    "--account",
    "fuelborn-testnet",
    "--broadcast",
    "--slow",
  ]);
  assert.deepEqual(
    deployment.forgeDeploymentArguments(config, { resume: true }).slice(-3),
    ["--broadcast", "--slow", "--resume"],
  );
});

test("FuelBorn deployment: reads the live contract state through its public ABI", async () => {
  const calls: string[] = [];
  const state = await deployment.readFuelBornDeploymentState(
    {
      getChainId: async () => 10143,
      getBytecode: async ({ address }) => {
        calls.push(`code:${address}`);
        return "0x6001600055";
      },
      readContract: async ({ address, functionName }) => {
        calls.push(`${functionName}:${address}`);
        if (functionName === "treasury") return treasury;
        if (functionName === "relayer") return relayer;
        if (functionName === "minForgeDeposit") {
          return BigInt("100000000000000000");
        }
        throw new Error(`unexpected function ${functionName}`);
      },
    },
    contractAddress,
  );

  assert.deepEqual(state, {
    chainId: 10143,
    bytecode: "0x6001600055",
    treasury,
    relayer,
    minForgeDepositWei: BigInt("100000000000000000"),
  });
  assert.deepEqual(calls, [
    `code:${contractAddress}`,
    `treasury:${contractAddress}`,
    `relayer:${contractAddress}`,
    `minForgeDeposit:${contractAddress}`,
  ]);
});

test("FuelBorn deployment: supports explicit broadcast and verification-only modes", () => {
  assert.deepEqual(deployment.parseFuelBornDeploymentCliArgs([]), {
    broadcast: true,
    resume: false,
  });
  assert.deepEqual(
    deployment.parseFuelBornDeploymentCliArgs(["--verify-only"]),
    { broadcast: false, resume: false },
  );
  assert.deepEqual(
    deployment.parseFuelBornDeploymentCliArgs(["--resume"]),
    { broadcast: true, resume: true },
  );
  assert.throws(
    () => deployment.parseFuelBornDeploymentCliArgs(["--private-key", "secret"]),
    /usage: pnpm contract:deploy \[--verify-only\|--resume\]/,
  );
});

test("FuelBorn deployment: stops before getter calls when no code is deployed", async () => {
  const calls: string[] = [];

  await assert.rejects(
    deployment.readFuelBornDeploymentState(
      {
        getChainId: async () => 10143,
        getBytecode: async () => {
          calls.push("code");
          return undefined;
        },
        readContract: async () => {
          calls.push("getter");
          throw new Error("getter should not run");
        },
      },
      contractAddress,
    ),
    /has no bytecode/,
  );
  assert.deepEqual(calls, ["code"]);
});
