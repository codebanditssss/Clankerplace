export type DeploySizeId = "nano" | "small" | "medium" | "large" | "xlarge";

export type DeploySize = {
  id: DeploySizeId;
  label: string;
  memoryMib: number;
  cpuPercent: number;
  diskMib: number;
  desc: string;
};

export const DEPLOY_SIZES: readonly DeploySize[] = [
  {
    id: "nano",
    label: "Nano",
    memoryMib: 1024,
    cpuPercent: 50,
    diskMib: 5 * 1024,
    desc: "Idle agents, hobby bots",
  },
  {
    id: "small",
    label: "Small",
    memoryMib: 2 * 1024,
    cpuPercent: 100,
    diskMib: 10 * 1024,
    desc: "Hermes default, recommended",
  },
  {
    id: "medium",
    label: "Medium",
    memoryMib: 4 * 1024,
    cpuPercent: 200,
    diskMib: 20 * 1024,
    desc: "Busy agents, heavier tools",
  },
  {
    id: "large",
    label: "Large",
    memoryMib: 8 * 1024,
    cpuPercent: 400,
    diskMib: 40 * 1024,
    desc: "Heavy agents, Minecraft",
  },
  {
    id: "xlarge",
    label: "Xlarge",
    memoryMib: 16 * 1024,
    cpuPercent: 800,
    diskMib: 80 * 1024,
    desc: "Multi-connector workloads",
  },
];

export const DEFAULT_DEPLOY_SIZE_ID: DeploySizeId = "small";

export function deploySizeById(
  value: string | null | undefined,
): DeploySize | null {
  if (!value) return null;
  return DEPLOY_SIZES.find((size) => size.id === value) ?? null;
}

export function deploySizeFromRequest(value: unknown): DeploySize | null {
  if (typeof value === "string") return deploySizeById(value);
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") return deploySizeById(id);
  }
  return null;
}

export function canSelectDeploySizeForPodType(podTypeSlug: string): boolean {
  return podTypeSlug === "hermes";
}

export function sizeFitsPlan(
  size: Pick<DeploySize, "memoryMib" | "cpuPercent">,
  plan: { ramGb: number | null | undefined; cpu: number | null | undefined },
): boolean {
  if (plan.ramGb != null && size.memoryMib > plan.ramGb * 1024) return false;
  if (plan.cpu != null && size.cpuPercent > plan.cpu * 100) return false;
  return true;
}
