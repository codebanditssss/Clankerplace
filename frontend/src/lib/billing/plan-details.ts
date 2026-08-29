export type BillingPlanDetail = {
  id: "developer" | "pro" | "scale" | "enterprise";
  name: string;
  price: string;
  audience: string;
  podLimit: string;
  resources: string;
  badge?: string;
  cta: string;
  features: string[];
};

export type SelfServePlanDetail = BillingPlanDetail & {
  id: "developer" | "pro" | "scale";
};

export function isSelfServePlanDetail(
  plan: BillingPlanDetail,
): plan is SelfServePlanDetail {
  return plan.id !== "enterprise";
}

export const PLAN_DETAILS: BillingPlanDetail[] = [
  {
    id: "developer",
    name: "Developer",
    price: "$10/month",
    audience: "For personal agents and side projects.",
    podLimit: "1 Active Pod",
    resources: "4 GB RAM - 2 vCPU",
    cta: "Start Developer",
    features: [
      "1 Active Pod",
      "4 GB RAM",
      "2 vCPU",
      "Public URL",
      "Managed Email Inbox",
      "Custom Domain Support",
      "Persistent Storage",
      "Browser Terminal",
      "Live Metrics Dashboard",
      "HTTPS Included",
      "Restart & Power Controls",
      "Logs & Monitoring",
      "BYOK Provider Support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29/month",
    audience: "For builders running multiple agents.",
    podLimit: "5 Active Pods",
    resources: "8 GB RAM per Pod - 4 vCPU per Pod",
    badge: "Popular",
    cta: "Start Pro",
    features: [
      "5 Active Pods",
      "8 GB RAM per Pod",
      "4 vCPU per Pod",
      "Public URLs",
      "Managed Email Inboxes",
      "Custom Domain Support",
      "Persistent Storage",
      "Browser Terminal",
      "Live Metrics Dashboard",
      "HTTPS Included",
      "Restart & Power Controls",
      "Logs & Monitoring",
      "BYOK Provider Support",
      "Credit Wallet Access",
      "Priority Deployments",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    price: "$79/month",
    audience: "For startups, agencies, and power users.",
    podLimit: "15 Active Pods",
    resources: "16 GB RAM per Pod - 8 vCPU per Pod",
    cta: "Start Scale",
    features: [
      "15 Active Pods",
      "16 GB RAM per Pod",
      "8 vCPU per Pod",
      "Public URLs",
      "Managed Email Inboxes",
      "Custom Domain Support",
      "Persistent Storage",
      "Browser Terminal",
      "Advanced Metrics",
      "HTTPS Included",
      "Restart & Power Controls",
      "Logs & Monitoring",
      "BYOK Provider Support",
      "Credit Wallet Access",
      "API Access",
      "Priority Support",
      "Faster Deployments",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Contact Sales",
    audience: "For large-scale deployments.",
    podLimit: "Custom Pod Limits",
    resources: "Dedicated infrastructure and private nodes",
    cta: "Contact Sales",
    features: [
      "Custom Pod Limits",
      "Dedicated Infrastructure",
      "Private Nodes",
      "Custom Resource Allocation",
      "SLA",
      "Dedicated Support",
      "Enterprise Onboarding",
      "Custom Billing Agreements",
      "Priority Feature Requests",
    ],
  },
];

export const SELF_SERVE_PLAN_DETAILS = PLAN_DETAILS.filter(isSelfServePlanDetail);

export const PLAN_DETAIL_BY_ID: Record<BillingPlanDetail["id"], BillingPlanDetail> =
  Object.fromEntries(PLAN_DETAILS.map((plan) => [plan.id, plan])) as Record<
    BillingPlanDetail["id"],
    BillingPlanDetail
  >;
