import { encodeFunctionData, toHex, type Hex } from "viem";

const WEI_PER_MON = BigInt("1000000000000000000");
const MICRO_FUEL_PER_FUEL = BigInt("1000000");
const FUEL_PER_MON = BigInt(100);
const IDLE_MICRO_FUEL_PER_HOUR = BigInt("1000000");

export const FORGE_ABI = [
  {
    type: "function",
    name: "registerAgent",
    stateMutability: "payable",
    inputs: [{ name: "metadataHash", type: "bytes32" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
] as const;

export type ForgeTransactionRequest = {
  chainId: number;
  address: string;
  functionName: "registerAgent";
  args: [string];
  value: string;
};

export function quoteForgeDeposit(mon: string): {
  wei: bigint;
  fuelMicro: bigint;
  fuelLabel: string;
  idleLifetimeSeconds: bigint;
} {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(mon)) {
    throw new Error("Enter a valid positive MON amount");
  }
  const [whole, fraction = ""] = mon.split(".");
  const wei =
    BigInt(whole) * WEI_PER_MON +
    BigInt((fraction + "0".repeat(18)).slice(0, 18));
  if (wei <= BigInt(0)) {
    throw new Error("Enter a valid positive MON amount");
  }
  const fuelMicro =
    (wei * FUEL_PER_MON * MICRO_FUEL_PER_FUEL) / WEI_PER_MON;
  if (fuelMicro <= BigInt(0)) {
    throw new Error("Enter a valid positive MON amount");
  }
  return {
    wei,
    fuelMicro,
    fuelLabel: formatMicroFuel(fuelMicro),
    idleLifetimeSeconds:
      (fuelMicro * BigInt(3_600)) / IDLE_MICRO_FUEL_PER_HOUR,
  };
}

export function buildRegisterAgentTransaction(args: {
  from: string;
  request: ForgeTransactionRequest;
}): { from: string; to: string; value: Hex; data: Hex } {
  if (args.request.functionName !== "registerAgent") {
    throw new Error("Unsupported Forge contract call");
  }
  const metadataHash = args.request.args[0] as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(metadataHash)) {
    throw new Error("Invalid Forge metadata hash");
  }
  return {
    from: args.from,
    to: args.request.address,
    value: toHex(BigInt(args.request.value)),
    data: encodeFunctionData({
      abi: FORGE_ABI,
      functionName: "registerAgent",
      args: [metadataHash],
    }),
  };
}

export function chainIdHex(chainId: number): Hex {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Invalid Forge chain ID");
  }
  return toHex(chainId);
}

export function ignitionStage(status: string): {
  index: number;
  label: string;
} {
  if (status === "active") return { index: 3, label: "Ignition ready" };
  if (status === "provisioned") return { index: 2, label: "Loading FUEL" };
  if (status === "chain_verified" || status === "provisioning") {
    return { index: 1, label: "Allocating pod" };
  }
  return { index: 0, label: "Verifying birth" };
}

export function pendingIgnitionIndex(errorCode: string): number {
  return errorCode === "forge_pod_pending" ? 1 : 0;
}

function formatMicroFuel(value: bigint): string {
  const whole = value / MICRO_FUEL_PER_FUEL;
  const fraction = (value % MICRO_FUEL_PER_FUEL)
    .toString(10)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString(10);
}
