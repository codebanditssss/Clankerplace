import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createPublicClient, http } from "viem";
import {
  assertFuelBornDeployment,
  deploymentRecordFromBroadcast,
  forgeDeploymentArguments,
  formatFuelBornFrontendEnv,
  loadFuelBornDeploymentConfig,
  parseFuelBornDeploymentCliArgs,
  readFuelBornDeploymentState,
  type FuelBornRuntimeArtifact,
} from "../src/lib/fuelborn/deployment";

void (async () => {
  const mode = parseFuelBornDeploymentCliArgs(process.argv.slice(2));
  const config = loadFuelBornDeploymentConfig(process.env, {
    requireDeployerAccount: mode.broadcast,
  });
  const frontendDir = resolve(__dirname, "..");
  const contractsDir = resolve(frontendDir, "..", "contracts");
  const artifactPath = join(
    contractsDir,
    "broadcast",
    "DeployFuelBorn.s.sol",
    String(config.chainId),
    "run-latest.json",
  );
  const compiledArtifactPath = join(
    contractsDir,
    "out",
    "FuelBorn.sol",
    "FuelBorn.json",
  );
  const client = createPublicClient({ transport: http(config.rpcUrl) });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== config.chainId) {
    throw new Error(
      `Monad RPC returned chain ${rpcChainId}; expected ${config.chainId}`,
    );
  }

  const forgeBin =
    process.env.FOUNDRY_BIN?.trim() ||
    join(homedir(), ".foundry", "bin", "forge");
  await access(forgeBin, constants.X_OK).catch(() => {
    throw new Error(
      `Foundry forge was not found at ${forgeBin}; set FOUNDRY_BIN to its executable path`,
    );
  });
  const forgeCommands = [
    ["build"],
    ...(mode.broadcast
      ? [["script", ...forgeDeploymentArguments(config, { resume: mode.resume })]]
      : []),
  ];
  for (const command of forgeCommands) {
    const result = spawnSync(forgeBin, command, {
      cwd: contractsDir,
      env: process.env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Foundry ${command[0]} exited with status ${result.status}`,
      );
    }
  }

  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as unknown;
  const record = deploymentRecordFromBroadcast(artifact);
  const compiledArtifact = JSON.parse(
    await readFile(compiledArtifactPath, "utf8"),
  ) as { deployedBytecode?: FuelBornRuntimeArtifact };
  if (!compiledArtifact.deployedBytecode) {
    throw new Error("compiled FuelBorn runtime bytecode was not found");
  }
  const state = await readFuelBornDeploymentState(
    client,
    record.contractAddress,
  );
  assertFuelBornDeployment(state, config, compiledArtifact.deployedBytecode);

  console.log(
    "\nFuelBorn deployment verified. Add these values to the frontend environment:\n",
  );
  console.log(formatFuelBornFrontendEnv(config, record));
})().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FuelBorn deployment failed: ${message}`);
  process.exitCode = 1;
});
