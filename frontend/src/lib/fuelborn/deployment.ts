export const MONAD_TESTNET_CHAIN_ID = 10_143;

type DeploymentEnv = Record<string, string | undefined>;

export type FuelBornDeploymentConfig = {
  rpcUrl: string;
  chainId: typeof MONAD_TESTNET_CHAIN_ID;
  deployerAccount: string | null;
  treasury: `0x${string}`;
  relayer: `0x${string}`;
  minForgeDepositWei: bigint;
  fuelPerMon: bigint;
};

export type FuelBornDeploymentRecord = {
  contractAddress: `0x${string}`;
  transactionHash: `0x${string}`;
  deployBlock: bigint;
};

export type FuelBornDeploymentState = {
  chainId: number;
  bytecode: `0x${string}`;
  treasury: string;
  relayer: string;
  minForgeDepositWei: bigint;
};

export type FuelBornRuntimeArtifact = {
  object: string;
  immutableReferences: Record<
    string,
    Array<{ start: number; length: number }>
  >;
};

type FuelBornDeploymentReader = {
  getChainId(): Promise<number>;
  getBytecode(args: {
    address: `0x${string}`;
  }): Promise<`0x${string}` | undefined>;
  readContract(args: {
    address: `0x${string}`;
    abi: typeof FUELBORN_DEPLOYMENT_ABI;
    functionName: "treasury" | "relayer" | "minForgeDeposit";
  }): Promise<unknown>;
};

export const FUELBORN_DEPLOYMENT_ABI = [
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "relayer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "minForgeDeposit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function loadFuelBornDeploymentConfig(
  env: DeploymentEnv,
  options: { requireDeployerAccount?: boolean } = {},
): FuelBornDeploymentConfig {
  if (env.FUELBORN_DEPLOYER_PRIVATE_KEY?.trim()) {
    throw new Error(
      "raw deployer private keys are not accepted; use a named Foundry keystore account",
    );
  }
  const required = [
    "MONAD_RPC_URL",
    "MONAD_CHAIN_ID",
    "FUELBORN_TREASURY_ADDRESS",
    "FUELBORN_RELAYER_ADDRESS",
    "FUELBORN_MIN_FORGE_DEPOSIT_WEI",
    "FUEL_PER_MON",
  ] as const;
  const missing: string[] = required.filter((key) => !env[key]?.trim());
  if (
    options.requireDeployerAccount !== false &&
    !env.FUELBORN_DEPLOYER_ACCOUNT?.trim()
  ) {
    missing.push("FUELBORN_DEPLOYER_ACCOUNT");
  }
  if (missing.length > 0) {
    throw new Error(`FuelBorn deployment is missing ${missing.join(", ")}`);
  }

  const rpc = new URL(env.MONAD_RPC_URL!.trim());
  if (rpc.protocol !== "https:" && rpc.protocol !== "http:") {
    throw new Error("MONAD_RPC_URL must use http or https");
  }
  const chainId = parseSafePositiveInteger(
    env.MONAD_CHAIN_ID!,
    "MONAD_CHAIN_ID",
  );
  if (chainId !== MONAD_TESTNET_CHAIN_ID) {
    throw new Error(
      `MONAD_CHAIN_ID must be Monad testnet chain ${MONAD_TESTNET_CHAIN_ID}`,
    );
  }
  const deployerAccount = env.FUELBORN_DEPLOYER_ACCOUNT?.trim() || null;
  if (
    deployerAccount !== null &&
    !/^[A-Za-z0-9._-]{1,64}$/.test(deployerAccount)
  ) {
    throw new Error("invalid Foundry account name");
  }
  const treasury = normalizeAddress(
    env.FUELBORN_TREASURY_ADDRESS!,
    "treasury",
  );
  const relayer = normalizeAddress(
    env.FUELBORN_RELAYER_ADDRESS!,
    "relayer",
  );

  return {
    rpcUrl: rpc.toString(),
    chainId: MONAD_TESTNET_CHAIN_ID,
    deployerAccount,
    treasury,
    relayer,
    minForgeDepositWei: parsePositiveBigInt(
      env.FUELBORN_MIN_FORGE_DEPOSIT_WEI!,
      "FUELBORN_MIN_FORGE_DEPOSIT_WEI",
    ),
    fuelPerMon: parsePositiveBigInt(env.FUEL_PER_MON!, "FUEL_PER_MON"),
  };
}

export function deploymentRecordFromBroadcast(
  artifact: unknown,
): FuelBornDeploymentRecord {
  if (!isRecord(artifact)) throw new Error("invalid Foundry broadcast artifact");
  const transactions = Array.isArray(artifact.transactions)
    ? artifact.transactions.filter(
        (entry): entry is Record<string, unknown> =>
          isRecord(entry) &&
          entry.transactionType === "CREATE" &&
          entry.contractName === "FuelBorn",
      )
    : [];
  if (transactions.length !== 1) {
    throw new Error("expected exactly one FuelBorn deployment");
  }

  const transaction = transactions[0];
  const transactionHash = normalizeHash(transaction.hash);
  const contractAddress = normalizeAddress(
    requireString(transaction.contractAddress, "deployment contract address"),
    "deployment contract",
  );
  const receipts = Array.isArray(artifact.receipts) ? artifact.receipts : [];
  const matchingReceipts = receipts.filter(
    (entry) =>
      isRecord(entry) &&
      typeof entry.transactionHash === "string" &&
      entry.transactionHash.toLowerCase() === transactionHash,
  );
  if (matchingReceipts.length !== 1) {
    throw new Error("expected exactly one FuelBorn deployment receipt");
  }
  const receipt = matchingReceipts[0];
  if (!isRecord(receipt)) throw new Error("invalid FuelBorn deployment receipt");
  if (receipt.status !== "0x1" && receipt.status !== 1) {
    throw new Error("FuelBorn deployment transaction did not succeed");
  }
  const receiptAddress = normalizeAddress(
    requireString(receipt.contractAddress, "receipt contract address"),
    "receipt contract",
  );
  if (receiptAddress !== contractAddress) {
    throw new Error("FuelBorn deployment receipt address does not match");
  }

  return {
    contractAddress,
    transactionHash,
    deployBlock: parseUnsignedBigInt(receipt.blockNumber, "deployment block"),
  };
}

export function assertFuelBornDeployment(
  state: FuelBornDeploymentState,
  expected: FuelBornDeploymentConfig,
  runtimeArtifact: FuelBornRuntimeArtifact,
): void {
  if (state.chainId !== expected.chainId) {
    throw new Error(
      `deployed chain ${state.chainId} does not match ${expected.chainId}`,
    );
  }
  if (state.bytecode === "0x" || state.bytecode === "0x0") {
    throw new Error("FuelBorn deployment has no bytecode");
  }
  if (
    maskImmutableBytecode(state.bytecode, runtimeArtifact) !==
    maskImmutableBytecode(runtimeArtifact.object, runtimeArtifact)
  ) {
    throw new Error(
      "FuelBorn runtime bytecode does not match the compiled contract",
    );
  }
  if (
    normalizeAddress(state.treasury, "deployed treasury") !== expected.treasury
  ) {
    throw new Error("deployed treasury does not match");
  }
  if (normalizeAddress(state.relayer, "deployed relayer") !== expected.relayer) {
    throw new Error("deployed relayer does not match");
  }
  if (state.minForgeDepositWei !== expected.minForgeDepositWei) {
    throw new Error("deployed minimum Forge deposit does not match");
  }
}

export function formatFuelBornFrontendEnv(
  config: FuelBornDeploymentConfig,
  record: FuelBornDeploymentRecord,
): string {
  return [
    `MONAD_RPC_URL=${config.rpcUrl}`,
    `MONAD_CHAIN_ID=${config.chainId}`,
    `FUELBORN_CONTRACT_ADDRESS=${record.contractAddress}`,
    `FUELBORN_CONTRACT_DEPLOY_BLOCK=${record.deployBlock}`,
    `FUEL_PER_MON=${config.fuelPerMon}`,
    `FUELBORN_MIN_FORGE_DEPOSIT_WEI=${config.minForgeDepositWei}`,
    "MONAD_VERIFICATION_LAG_BLOCKS=5",
    "FUELBORN_IDLE_BURN_MICRO_FUEL_PER_SECOND=278",
  ].join("\n");
}

export function forgeDeploymentArguments(
  config: FuelBornDeploymentConfig,
  options: { resume?: boolean } = {},
): string[] {
  if (!config.deployerAccount) {
    throw new Error("a Foundry deployer account is required to broadcast");
  }
  const args = [
    "script/DeployFuelBorn.s.sol:DeployFuelBorn",
    "--rpc-url",
    config.rpcUrl,
    "--chain-id",
    String(config.chainId),
    "--account",
    config.deployerAccount,
    "--broadcast",
    "--slow",
  ];
  if (options.resume) args.push("--resume");
  return args;
}

export function parseFuelBornDeploymentCliArgs(args: string[]): {
  broadcast: boolean;
  resume: boolean;
} {
  if (args.length === 0) return { broadcast: true, resume: false };
  if (args.length === 1 && args[0] === "--verify-only") {
    return { broadcast: false, resume: false };
  }
  if (args.length === 1 && args[0] === "--resume") {
    return { broadcast: true, resume: true };
  }
  throw new Error("usage: pnpm contract:deploy [--verify-only|--resume]");
}

export async function readFuelBornDeploymentState(
  reader: FuelBornDeploymentReader,
  address: string,
): Promise<FuelBornDeploymentState> {
  const contractAddress = normalizeAddress(address, "FuelBorn contract");
  const chainId = await reader.getChainId();
  const bytecode = (await reader.getBytecode({ address: contractAddress })) ??
    "0x";
  if (bytecode === "0x" || bytecode === "0x0") {
    throw new Error("FuelBorn deployment has no bytecode");
  }
  const treasury = await reader.readContract({
    address: contractAddress,
    abi: FUELBORN_DEPLOYMENT_ABI,
    functionName: "treasury",
  });
  const relayer = await reader.readContract({
    address: contractAddress,
    abi: FUELBORN_DEPLOYMENT_ABI,
    functionName: "relayer",
  });
  const minForgeDepositWei = await reader.readContract({
    address: contractAddress,
    abi: FUELBORN_DEPLOYMENT_ABI,
    functionName: "minForgeDeposit",
  });
  if (typeof treasury !== "string" || typeof relayer !== "string") {
    throw new Error("FuelBorn deployment returned invalid address state");
  }
  if (typeof minForgeDepositWei !== "bigint") {
    throw new Error("FuelBorn deployment returned an invalid minimum deposit");
  }
  return {
    chainId,
    bytecode,
    treasury: normalizeAddress(treasury, "deployed treasury"),
    relayer: normalizeAddress(relayer, "deployed relayer"),
    minForgeDepositWei,
  };
}

function normalizeAddress(value: string, label: string): `0x${string}` {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`invalid ${label} address`);
  }
  if (normalized === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${label} address cannot be zero`);
  }
  return normalized as `0x${string}`;
}

function normalizeHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("invalid deployment transaction hash");
  }
  return value.toLowerCase() as `0x${string}`;
}

function parseSafePositiveInteger(value: string, label: string): number {
  if (!/^[1-9]\d*$/.test(value.trim())) throw new Error(`invalid ${label}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid ${label}`);
  return parsed;
}

function parsePositiveBigInt(value: string, label: string): bigint {
  if (!/^[1-9]\d*$/.test(value.trim())) throw new Error(`invalid ${label}`);
  return BigInt(value);
}

function parseUnsignedBigInt(value: unknown, label: string): bigint {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error(`invalid ${label}`);
  }
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^(?:0x[0-9a-fA-F]+|\d+)$/.test(String(value))
  ) {
    throw new Error(`invalid ${label}`);
  }
  return BigInt(value);
}

function maskImmutableBytecode(
  bytecode: string,
  artifact: FuelBornRuntimeArtifact,
): string {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode)) {
    throw new Error("invalid FuelBorn runtime bytecode");
  }
  if (!isRecord(artifact.immutableReferences)) {
    throw new Error("invalid FuelBorn immutable references");
  }
  const chars = [...bytecode.slice(2).toLowerCase()];
  for (const references of Object.values(artifact.immutableReferences)) {
    if (!Array.isArray(references)) {
      throw new Error("invalid FuelBorn immutable references");
    }
    for (const reference of references) {
      if (
        !isRecord(reference) ||
        !Number.isSafeInteger(reference.start) ||
        !Number.isSafeInteger(reference.length) ||
        reference.start < 0 ||
        reference.length <= 0 ||
        (reference.start + reference.length) * 2 > chars.length
      ) {
        throw new Error("invalid FuelBorn immutable reference range");
      }
      chars.fill(
        "0",
        reference.start * 2,
        (reference.start + reference.length) * 2,
      );
    }
  }
  return `0x${chars.join("")}`;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`invalid ${label}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
