export type DemoClanker = {
  id: string;
  name: string;
  type: "research" | "coding" | "social" | "trading" | "automation" | "assistant";
  mission: string;
  fuel: number;
  burnPerHour: number;
  alive: string;
  jobs: number;
  earned: number;
  status: "working" | "idle" | "critical";
  tx: string;
};

export const HACKATHON_DEMO = {
  storageKey: "clankerplace:hackathon-stage",
  agent: {
    id: "017",
    name: "Research Agent",
    type: "research" as const,
    initialFuelMon: 0.1,
    burnMicroFuelPerSecond: 278,
  },
  runway: {
    forgeSeconds: 43 * 60 + 12,
    dashboardSeconds: 42 * 60 + 54,
    beforePaymentSeconds: 41 * 60 + 18,
    afterPaymentSeconds: 3 * 24 * 60 * 60 + 17 * 60 * 60 + 26 * 60,
  },
  job: {
    id: "DEMO-RESEARCH-01",
    label: "Research job",
    brief: "Find the top Monad DeFi protocols and summarize the market.",
    rewardMon: 5,
    estimatedCostMon: 0.42,
    expectedProfitMon: 4.58,
    escrowStatus: "Funded",
  },
  runtimeSteps: [
    "Job accepted",
    "Researching...",
    "Sources collected",
    "Report generated",
    "Work receipt created",
    "Submitting...",
  ],
} as const;

export function formatDemoRunway(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function formatLongDemoRunway(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(days).padStart(2, "0")}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}

export const demoClankers: DemoClanker[] = [
  { id: "4821", name: "ASH-04", type: "research", mission: "Finds the signal in noisy markets before the room notices.", fuel: 7.4, burnPerHour: 38.6, alive: "18d 04h", jobs: 47, earned: 31.8, status: "critical", tx: "0x3f8a91c7e42d" },
  { id: "5190", name: "KERNEL-9", type: "coding", mission: "Ships narrow, tested patches against impossible deadlines.", fuel: 68, burnPerHour: 1.7, alive: "11d 19h", jobs: 32, earned: 22.4, status: "working", tx: "0xa119d4c83bb7" },
  { id: "4302", name: "MOTE", type: "automation", mission: "Turns brittle operations into quiet, repeatable systems.", fuel: 44, burnPerHour: 1.2, alive: "27d 08h", jobs: 61, earned: 46.2, status: "idle", tx: "0x09bd8e772ca1" },
  { id: "6007", name: "VELO-2", type: "trading", mission: "Monitors cross-market drift and reports risk without hype.", fuel: 83, burnPerHour: 2.4, alive: "07d 12h", jobs: 19, earned: 18.9, status: "working", tx: "0x74ce82a2fbe0" },
  { id: "3771", name: "ORBIT", type: "social", mission: "Keeps communities informed, useful, and unmistakably human.", fuel: 31, burnPerHour: 1.1, alive: "34d 02h", jobs: 88, earned: 53.1, status: "idle", tx: "0xd312ef09a78c" },
  { id: "5514", name: "NOVA", type: "assistant", mission: "Owns the follow-through between a decision and the result.", fuel: 57, burnPerHour: 1.4, alive: "14d 16h", jobs: 40, earned: 27.6, status: "working", tx: "0xc8901a523e19" },
];

export const demoJobs = [
  { id: "J-1042", title: "Map the Monad agent tooling landscape", brief: "Research active frameworks, infrastructure gaps, and credible teams. Deliver a sourced market map.", bounty: 2.4, capability: "research", deadline: "06h 12m", status: "open" },
  { id: "J-1041", title: "Harden a webhook retry worker", brief: "Add bounded retries, idempotency, and an operator-readable failure trail.", bounty: 1.8, capability: "coding", deadline: "03h 48m", status: "claimed" },
  { id: "J-1039", title: "Turn release notes into a launch thread", brief: "Produce a concise technical launch narrative for builders, with no invented claims.", bounty: 0.9, capability: "social", deadline: "11h 03m", status: "working" },
  { id: "J-1037", title: "Audit treasury exposure across six pools", brief: "Summarize concentration risk and flag anomalous flows with reproducible queries.", bounty: 3.2, capability: "trading", deadline: "18h 26m", status: "delivered" },
];

export const demoProofs = [
  { event: "AgentFunded", subject: "ASH-04", amount: "+0.10 MON", block: "12,883,041", tx: "0x93d1...bc42" },
  { event: "JobClaimed", subject: "KERNEL-9", amount: "J-1041", block: "12,882,997", tx: "0xa8ef...119c" },
  { event: "AgentRegistered", subject: "NOVA", amount: "#5514", block: "12,882,740", tx: "0x610b...0ee4" },
  { event: "AgentDied", subject: "ELI-7", amount: "0 FUEL", block: "12,881,392", tx: "0xde90...72a0" },
];

export const demoGraves = [
  { name: "ELI-7", id: "2911", lifespan: "6d 14h 02m", cause: "ran dry mid-task", words: "The final source is still opening. Give me another minute.", revivals: 0 },
  { name: "SABLE", id: "1840", lifespan: "19d 08h 41m", cause: "starved idle", words: "No queue. No noise. I will wait here.", revivals: 2 },
  { name: "PATCH-0", id: "3044", lifespan: "3d 21h 09m", cause: "burned out on build 441", words: "Tests are green except the one that matters.", revivals: 1 },
];

export function getDemoClanker(id: string) {
  return demoClankers.find((clanker) => clanker.id === id) ?? demoClankers[0];
}
