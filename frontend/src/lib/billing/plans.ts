import "server-only";

export type PlanId = "developer" | "pro" | "scale" | "enterprise";
export type SelfServePlanId = Exclude<PlanId, "enterprise">;
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "cancelled"
  | "expired"
  | "unpaid"
  | "past_due"
  | "suspended"
  | "on_hold"
  | "failed"
  | string;

export type PlanDefinition = {
  id: PlanId;
  name: string;
  monthlyPriceCents: number | null;
  activePodLimit: number | null;
  ramGb: number | null;
  cpu: number | null;
  dodoProductEnv?: string;
};

export type CreditPackId = "credit_10" | "credit_25" | "credit_50" | "credit_100";

export type CreditPackDefinition = {
  id: CreditPackId;
  label: string;
  amountCents: number;
  dodoProductEnv: string;
};

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export const BLOCKED_SUBSCRIPTION_STATUSES = new Set([
  "cancelled",
  "expired",
  "unpaid",
  "past_due",
  "suspended",
  "on_hold",
  "failed",
]);

export const SELF_SERVE_PLANS: Record<SelfServePlanId, PlanDefinition> = {
  developer: {
    id: "developer",
    name: "Developer",
    monthlyPriceCents: 1000,
    activePodLimit: 1,
    ramGb: 4,
    cpu: 2,
    dodoProductEnv: "DODO_PRODUCT_DEVELOPER",
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceCents: 2900,
    activePodLimit: 5,
    ramGb: 8,
    cpu: 4,
    dodoProductEnv: "DODO_PRODUCT_PRO",
  },
  scale: {
    id: "scale",
    name: "Scale",
    monthlyPriceCents: 7900,
    activePodLimit: 15,
    ramGb: 16,
    cpu: 8,
    dodoProductEnv: "DODO_PRODUCT_SCALE",
  },
};

export const ENTERPRISE_PLAN: PlanDefinition = {
  id: "enterprise",
  name: "Enterprise",
  monthlyPriceCents: null,
  activePodLimit: null,
  ramGb: null,
  cpu: null,
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  ...SELF_SERVE_PLANS,
  enterprise: ENTERPRISE_PLAN,
};

export const CREDIT_PACKS: Record<CreditPackId, CreditPackDefinition> = {
  credit_10: {
    id: "credit_10",
    label: "$10 AI Credits",
    amountCents: 1000,
    dodoProductEnv: "DODO_CREDIT_PACK_10",
  },
  credit_25: {
    id: "credit_25",
    label: "$25 AI Credits",
    amountCents: 2500,
    dodoProductEnv: "DODO_CREDIT_PACK_25",
  },
  credit_50: {
    id: "credit_50",
    label: "$50 AI Credits",
    amountCents: 5000,
    dodoProductEnv: "DODO_CREDIT_PACK_50",
  },
  credit_100: {
    id: "credit_100",
    label: "$100 AI Credits",
    amountCents: 10000,
    dodoProductEnv: "DODO_CREDIT_PACK_100",
  },
};

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

export function isSelfServePlanId(value: string): value is SelfServePlanId {
  return value in SELF_SERVE_PLANS;
}

export function isCreditPackId(value: string): value is CreditPackId {
  return value in CREDIT_PACKS;
}

export function isActiveSubscriptionStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

export function isBlockedSubscriptionStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return false;
  if (BLOCKED_SUBSCRIPTION_STATUSES.has(status)) return true;
  return true;
}

export function getPlanResourceLimits(planId: string | null | undefined): {
  ramGb: number | null;
  cpu: number | null;
  ramMib: number | null;
  cpuPercent: number | null;
} | null {
  if (!planId || !isPlanId(planId)) return null;
  const plan = PLANS[planId];
  return {
    ramGb: plan.ramGb,
    cpu: plan.cpu,
    ramMib: plan.ramGb == null ? null : plan.ramGb * 1024,
    cpuPercent: plan.cpu == null ? null : plan.cpu * 100,
  };
}

export function isWithinPlanResourceLimits(
  planId: string | null | undefined,
  resources: { memoryMib: number; cpuPercent: number },
): boolean {
  const limits = getPlanResourceLimits(planId);
  if (!limits) return false;
  if (limits.ramMib != null && resources.memoryMib > limits.ramMib) return false;
  if (limits.cpuPercent != null && resources.cpuPercent > limits.cpuPercent) {
    return false;
  }
  return true;
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getDodoProductForPlan(planId: SelfServePlanId): string {
  const envName = SELF_SERVE_PLANS[planId].dodoProductEnv;
  if (!envName) throw new Error(`plan ${planId} has no Dodo product env`);
  return getRequiredEnv(envName);
}

export function getDodoProductForCreditPack(packId: CreditPackId): string {
  return getRequiredEnv(CREDIT_PACKS[packId].dodoProductEnv);
}

export function planIdForDodoProduct(productId: string | null | undefined): SelfServePlanId | null {
  if (!productId) return null;
  for (const [planId, plan] of Object.entries(SELF_SERVE_PLANS)) {
    const envName = plan.dodoProductEnv;
    if (envName && process.env[envName] === productId) return planId as SelfServePlanId;
  }
  return null;
}

export function creditPackForDodoProduct(productId: string | null | undefined): CreditPackDefinition | null {
  if (!productId) return null;
  for (const pack of Object.values(CREDIT_PACKS)) {
    if (process.env[pack.dodoProductEnv] === productId) return pack;
  }
  return null;
}
