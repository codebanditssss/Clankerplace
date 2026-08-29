"use client";

// DeployHub — top-level "create a new pod" surface. Replaces the old
// "always-Hermes" DeployWizard mount. Two phases:
//
//   1. Type picker: 4 tiles (Hermes / n8n / Code Sandbox / Minecraft).
//      Hermes click delegates to the existing DeployWizard (it has the
//      LLM provider selection + model picker + 30+ provider catalog,
//      not worth re-implementing).
//   2. Generic form: for non-Hermes types, render the type's `fields[]`
//      with optional radio "flavor" selectors and a size picker, then
//      POST /api/deploy with pod_type set.
//
// The Sheet's open state lives here; on close we reset to the picker.

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Boxes,
  Check,
  Code,
  ExternalLink,
  Gamepad2,
  Loader2,
  Sparkles,
  Workflow,
} from "lucide-react";
import { POD_TYPES, type PodType, type PodTypeFlavor } from "@/lib/pod-types";
import {
  PLAN_DETAIL_BY_ID,
  type BillingPlanDetail,
} from "@/lib/billing/plan-details";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PodsLoader } from "@/components/ui/pods-loader";
import { Field, Input, Hint } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { DeployWizard } from "@/components/deploy-wizard";
import { useBillingFetch } from "@/components/billing/use-billing-fetch";
import { cn } from "@/lib/cn";
import { generatePodName } from "@/lib/pod-names";
import { POD_SETTLING_NOTICE } from "@/lib/pod-settling";

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  hermes: Bot,
  n8n: Workflow,
  "code-sandbox": Code,
  "minecraft-paper": Gamepad2,
};

type SubscriptionSummary = {
  subscription: {
    plan: string;
    plan_name?: string;
    status: string;
  } | null;
  payment_attempt?: {
    status: string;
    error_message: string | null;
  } | null;
  active_pod_count: number;
  active_pod_limit: number | null;
  can_create_pod: boolean;
  gate_reason: string | null;
  message: string | null;
};

type BillingRedirectResponse = {
  checkout_url?: string;
  portal_url?: string;
  error?: string;
  message?: string;
};

const NEXT_PLAN_BY_PLAN: Record<string, BillingPlanDetail[]> = {
  developer: [PLAN_DETAIL_BY_ID.pro, PLAN_DETAIL_BY_ID.scale],
  pro: [PLAN_DETAIL_BY_ID.scale],
  scale: [PLAN_DETAIL_BY_ID.enterprise],
};

function promptPlansForBilling(billing: SubscriptionSummary | null): BillingPlanDetail[] {
  const plan = billing?.subscription?.plan;
  if (!plan) {
    return [
      { ...PLAN_DETAIL_BY_ID.developer, badge: "Minimum required" },
      PLAN_DETAIL_BY_ID.pro,
      PLAN_DETAIL_BY_ID.scale,
    ];
  }

  if (billing?.gate_reason === "pod_limit_exceeded") {
    return (NEXT_PLAN_BY_PLAN[plan] ?? [PLAN_DETAIL_BY_ID.enterprise]).map(
      (item, index) =>
        index === 0 && item.id !== "enterprise"
          ? { ...item, badge: "Recommended upgrade" }
          : item,
    );
  }

  const inactive = billing?.gate_reason === "subscription_inactive";
  return [PLAN_DETAIL_BY_ID.developer, PLAN_DETAIL_BY_ID.pro, PLAN_DETAIL_BY_ID.scale].map(
    (item) =>
      item.id === plan
        ? { ...item, badge: inactive ? "Retry this plan" : "Current plan" }
        : item,
  );
}

function compactPlanSummary(plan: BillingPlanDetail): string {
  switch (plan.id) {
    case "developer":
      return "1 pod - 4 GB RAM - 2 vCPU";
    case "pro":
      return "5 pods - 8 GB RAM - 4 vCPU";
    case "scale":
      return "15 pods - 16 GB RAM - 8 vCPU";
    default:
      return `${plan.podLimit} - ${plan.resources}`;
  }
}

function compactPlanFeatures(plan: BillingPlanDetail): string[] {
  if (plan.id === "developer") {
    return [
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
    ];
  }
  if (plan.id === "pro") {
    return [
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
    ];
  }
  if (plan.id === "scale") {
    return [
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
    ];
  }
  return plan.features;
}

export function DeployHub({
  open,
  onOpenChange,
  initialType,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialType?: string | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = React.useState<PodType | null>(null);
  const {
    data: billing,
    error: billingError,
    loading: billingLoading,
  } =
    useBillingFetch<SubscriptionSummary>("/api/billing/subscription", {
      pollMs: 0,
    });
  const billingPending = Boolean(picked && !billing && !billingError);
  const creationBlocked = Boolean(
    picked &&
      (billingPending ||
        billingLoading ||
        billingError ||
        !billing ||
        !billing.can_create_pod),
  );

  // When the wizard opens with an `initialType` hint (deep link from
  // landing site / `/deploy?type=…`), pre-pick that pod type so the user
  // skips the picker. Unknown slugs fall back to the picker.
  React.useEffect(() => {
    if (!open) return;
    if (!initialType) return;
    const match = POD_TYPES.find((t) => t.slug === initialType);
    if (match) setPicked(match);
  }, [open, initialType]);

  React.useEffect(() => {
    if (!open) {
      // Reset after the slide-out animation so the picker is fresh next time.
      const t = setTimeout(() => setPicked(null), 220);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (open && picked?.slug === "hermes" && creationBlocked) {
    return (
      <Sheet
        open={open}
        onOpenChange={(v) => {
          onOpenChange(v);
          if (!v) setPicked(null);
        }}
        width={640}
        title={
          <span className="flex items-center gap-2">
            <button
              onClick={() => setPicked(null)}
              className="inline-flex items-center gap-1 text-[12px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
            >
              <ArrowLeft className="h-3 w-3" /> Pick another type
            </button>
            <span className="text-[color:var(--text-tertiary)]">·</span>
            <span>Deploy {picked.label}</span>
          </span>
        }
      >
        <PlanRequiredPanel
          type={picked}
          billing={billing}
          error={billingError}
          loading={billingLoading || billingPending}
          onBack={() => setPicked(null)}
          onPricing={() => {
            setPicked(null);
            onOpenChange(false);
            router.push("/billing#plans");
          }}
        />
      </Sheet>
    );
  }

  // Hermes uses its own wizard — render that and skip the picker UI.
  if (open && picked?.slug === "hermes") {
    return (
      <DeployWizard
        open={open}
        onOpenChange={(v) => {
          onOpenChange(v);
          if (!v) setPicked(null);
        }}
      />
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width={640}
      title={
        picked ? (
          <span className="flex items-center gap-2">
            <button
              onClick={() => setPicked(null)}
              className="inline-flex items-center gap-1 text-[12px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
            >
              <ArrowLeft className="h-3 w-3" /> Pick another type
            </button>
            <span className="text-[color:var(--text-tertiary)]">·</span>
            <span>Deploy {picked.label}</span>
          </span>
        ) : (
          "Deploy new pod"
        )
      }
    >
      <AnimatePresence mode="wait">
        {!picked ? (
          <motion.div
            key="picker"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.12 }}
            className="space-y-4 px-6 py-5"
          >
            <p className="text-[13px] text-[color:var(--text-tertiary)]">
              What kind of pod are you launching? Each is isolated, gets its own
              public HTTPS URL, persistent disk, and console access.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {POD_TYPES.map((t) => {
                const Icon = TYPE_ICONS[t.slug] ?? Boxes;
                return (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => setPicked(t)}
                    className="group flex flex-col gap-2 border border-[color:var(--border)] bg-[color:var(--bg-1)] p-4 text-left transition-all hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-2)]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex h-9 w-9 items-center justify-center border border-[color:var(--border)] bg-[color:var(--bg-3)]">
                        <Icon
                          className={cn(
                            "h-4 w-4",
                            t.accent ?? "text-[color:var(--text-secondary)]",
                          )}
                        />
                      </div>
                      <KindBadge kind={t.kind} />
                    </div>
                    <div>
                      <div className="text-[14px] font-semibold tracking-tight text-[color:var(--text-primary)]">
                        {t.label}
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
                        {t.blurb}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={`form-${picked.slug}`}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.12 }}
          >
            {creationBlocked ? (
              <PlanRequiredPanel
                type={picked}
                billing={billing}
                error={billingError}
                loading={billingLoading || billingPending}
                onBack={() => setPicked(null)}
                onPricing={() => {
                  setPicked(null);
                  onOpenChange(false);
                  router.push("/billing#plans");
                }}
              />
            ) : (
              <GenericPodForm
                type={picked}
                onCancel={() => setPicked(null)}
                onDeployed={(uuid) => {
                  onOpenChange(false);
                }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

function PlanRequiredPanel({
  type,
  billing,
  error,
  loading,
  onBack,
  onPricing,
}: {
  type: PodType;
  billing: SubscriptionSummary | null;
  error: string | null;
  loading: boolean;
  onBack: () => void;
  onPricing: () => void;
}) {
  const router = useRouter();
  const [pendingPlanId, setPendingPlanId] =
    React.useState<BillingPlanDetail["id"] | null>(null);
  const message =
    error ??
    billing?.message ??
    "Choose a subscription plan to create a new pod.";
  const planName = billing?.subscription?.plan_name ?? billing?.subscription?.plan;
  const hasPlan = Boolean(planName);
  const subscriptionInactive = billing?.gate_reason === "subscription_inactive";
  const promptPlans = promptPlansForBilling(billing);
  const usage =
    billing?.active_pod_limit == null
      ? `${billing?.active_pod_count ?? 0} pods`
      : `${billing.active_pod_count} / ${billing.active_pod_limit} pods`;

  async function handlePlanClick(plan: BillingPlanDetail) {
    if (pendingPlanId) return;
    setPendingPlanId(plan.id);
    try {
      await startPlanCheckout(plan, router);
    } finally {
      setPendingPlanId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {(loading || pendingPlanId) && (
          <div className="border border-[color:var(--border)] bg-[color:var(--bg-1)] px-4 py-5">
            <PodsLoader
              size="sm"
              label={
                pendingPlanId
                  ? "Opening secure checkout..."
                  : "Checking billing status..."
              }
              className="mx-auto"
            />
          </div>
        )}
        <div className="border border-amber-400/30 bg-amber-400/10 p-4 text-[12px] leading-relaxed text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <div className="font-semibold">
                {loading ? "Checking billing status..." : message}
              </div>
              <div className="mt-1 text-amber-100/70">
                {error
                  ? "New pods stay blocked until billing status can be verified. Try again or open pricing."
                  : subscriptionInactive
                  ? "New pod creation stays locked until Dodo confirms an active subscription. Retry checkout below or update your payment method from Billing."
                  : planName
                  ? `${planName} is currently at ${usage}. Upgrade or manage billing to deploy ${type.label}.`
                  : `${type.label} requires an active plan. Existing pods remain available, but new pods and resource upgrades require billing.`}
              </div>
            </div>
          </div>
        </div>

        <section>
          <div className="text-[12px] uppercase tracking-wider text-[color:var(--text-quaternary)]">
            {subscriptionInactive ? "Retry plan" : hasPlan ? "Upgrade plan" : "Minimum plan"}
          </div>
          <h3 className="mt-1 text-[18px] font-semibold tracking-tight text-[color:var(--text-primary)]">
            {subscriptionInactive
              ? "Retry payment to unlock pod creation"
              : hasPlan
              ? "Upgrade your plan to deploy another pod"
              : "Developer starts pod deployments at $10/mo"}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
            {subscriptionInactive
              ? "Your previous checkout did not produce an active subscription. Pick the same plan or another tier to start a new secure checkout."
              : hasPlan
              ? "Compare the higher tiers, then open full pricing when you are ready to change plans."
              : "Pick any plan below to unlock pod creation. You can still review full pricing before checkout."}
          </p>
        </section>

        <div className="grid gap-3 lg:grid-cols-3">
          {promptPlans.map((plan) => (
            <button
              type="button"
              onClick={() => void handlePlanClick(plan)}
              disabled={Boolean(pendingPlanId)}
              aria-busy={pendingPlanId === plan.id}
              key={plan.id}
              className="border border-[color:var(--border)] bg-[color:var(--bg-1)] p-3 text-left transition-colors hover:border-signal/50 hover:bg-[color:var(--bg-2)] disabled:cursor-wait disabled:opacity-70"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold tracking-tight text-[color:var(--text-primary)]">
                    {plan.name}
                  </div>
                  <div className="mt-1 whitespace-nowrap text-[11px] text-[color:var(--text-tertiary)]">
                    {compactPlanSummary(plan)}
                  </div>
                  <div className="mt-2 space-y-1.5 text-[11px] text-[color:var(--text-quaternary)]">
                    {compactPlanFeatures(plan).map((feature) => (
                      <span
                        key={feature}
                        className="flex min-w-0 items-center gap-1 whitespace-nowrap"
                        title={feature}
                      >
                        <Check className="h-3 w-3 flex-none text-live" />
                        <span className="min-w-0 truncate">{feature}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex-none text-right font-mono text-[12px] text-[color:var(--text-secondary)]">
                  {pendingPlanId === plan.id ? (
                    <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />
                  ) : (
                    plan.price
                  )}
                </div>
              </div>
              {plan.badge && (
                <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-live">
                  <Check className="h-3 w-3" /> {plan.badge}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-6 py-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="button" variant="primary" onClick={onPricing}>
          See full pricing <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

async function startPlanCheckout(
  plan: BillingPlanDetail,
  router: ReturnType<typeof useRouter>,
) {
  if (plan.id === "enterprise") {
    window.location.href = "https://github.com/codebanditssss/FuelBorn/issues";
    return;
  }
  try {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: plan.id }),
    });
    if (redirectToLoginOnUnauthorized(res, router)) return;
    const json = (await res.json().catch(() => ({}))) as BillingRedirectResponse;
    if (res.status === 409 && json.error === "billing_portal_required") {
      await startBillingPortal(router);
      return;
    }
    if (!res.ok) {
      throw new Error(json.message ?? json.error ?? `Checkout failed (${res.status})`);
    }
    if (!json.checkout_url) {
      throw new Error("Payment session did not include a redirect URL.");
    }
    window.location.href = json.checkout_url;
  } catch (err) {
    toast.error("Checkout failed", {
      description: err instanceof Error ? err.message : String(err),
    });
  }
}

async function startBillingPortal(router: ReturnType<typeof useRouter>) {
  const res = await fetch("/api/billing/portal", { method: "POST" });
  if (redirectToLoginOnUnauthorized(res, router)) return;
  const json = (await res.json().catch(() => ({}))) as BillingRedirectResponse;
  if (!res.ok) {
    throw new Error(json.message ?? json.error ?? `Billing portal failed (${res.status})`);
  }
  if (!json.portal_url) {
    throw new Error("Billing portal did not include a redirect URL.");
  }
  window.location.href = json.portal_url;
}

function redirectToLoginOnUnauthorized(
  res: Response,
  router: ReturnType<typeof useRouter>,
): boolean {
  if (res.status !== 401) return false;
  const next = `${window.location.pathname}${window.location.search}`;
  router.push(`/login?next=${encodeURIComponent(next)}`);
  return true;
}

function KindBadge({ kind }: { kind: PodType["kind"] }) {
  const map: Record<PodType["kind"], { label: string; cls: string }> = {
    agent: {
      label: "AI agent",
      cls: "border-[#e2c170]/30 bg-[#e2c170]/10 text-[#e2c170]",
    },
    automation: {
      label: "Automation",
      cls: "border-[#ea4b71]/30 bg-[#ea4b71]/10 text-[#ea4b71]",
    },
    sandbox: {
      label: "Dev",
      cls: "border-[#3b82f6]/30 bg-[#3b82f6]/10 text-[#3b82f6]",
    },
    game: {
      label: "Game server",
      cls: "border-[#5b9c4a]/30 bg-[#5b9c4a]/10 text-[#5b9c4a]",
    },
  };
  const s = map[kind];
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider",
        s.cls,
      )}
    >
      {s.label}
    </span>
  );
}

function GenericPodForm({
  type,
  onCancel,
  onDeployed,
}: {
  type: PodType;
  onCancel: () => void;
  onDeployed: (uuid: string) => void;
}) {
  const router = useRouter();
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [name, setName] = React.useState("");
  const [generatedName, setGeneratedName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Initialise default flavor selection so radios start active.
  React.useEffect(() => {
    const seed: Record<string, string> = {};
    for (const f of type.fields ?? []) {
      if (f.flavors?.length) seed[f.env] = f.flavors[0].id;
    }
    setFields(seed);
    setName("");
    setGeneratedName(generatePodName());
  }, [type]);

  const fieldValid = (f: PodType["fields"] extends infer A
    ? A extends Array<infer X>
      ? X
      : never
    : never): boolean => {
    if (f.flavors) return !!fields[f.env];
    if (f.optional) return true;
    return (fields[f.env]?.trim().length ?? 0) > 0;
  };
  const canSubmit =
    (type.fields ?? []).every((f) => fieldValid(f as never)) && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pod_type: type.slug,
          fields,
          name: name.trim() || generatedName || generatePodName(),
        }),
      });
      const d = (await r.json()) as {
        uuid?: string;
        identifier?: string;
        error?: string;
        message?: string;
      };
      if (!r.ok || d.error) {
        const message = d.message ?? d.error ?? `HTTP ${r.status}`;
        toast.error(message, {
          action:
            r.status === 402
              ? {
                  label: "View pricing",
                  onClick: () => router.push("/billing#plans"),
                }
              : undefined,
        });
        return;
      }
      toast.success(`${type.label} deploying — opening the pod page…`, {
        description: POD_SETTLING_NOTICE,
        duration: 8000,
      });
      if (d.identifier) router.push(`/pods/${d.identifier}`);
      onDeployed(d.uuid ?? "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {busy && (
          <div className="border border-[color:var(--border)] bg-[color:var(--bg-1)] px-4 py-6">
            <PodsLoader
              size="md"
              label={`Provisioning ${type.label}.`}
              className="mx-auto"
            />
          </div>
        )}
        <Card className="bg-[color:var(--bg-2)] p-4">
          <div className="text-[12px] uppercase tracking-wider text-[color:var(--text-quaternary)]">
            {type.kind} pod · {type.defaults.memoryMib}MB · {type.defaults.cpuPercent}% CPU
          </div>
          <h3 className="mt-1 text-[14px] font-semibold tracking-tight">
            {type.label}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
            {type.blurb}
          </p>
          <p className="mt-2 text-[11px] text-[color:var(--text-quaternary)]">
            Surface:{" "}
            {type.surface.kind === "http"
              ? `HTTPS at <slug>.bigcat.pw → :${type.surface.defaultPort}`
              : type.surface.kind === "tcp"
                ? `TCP ${type.surface.protocol} on vm:<allocated-port>`
                : "console only"}
          </p>
        </Card>

        <Field
          label="Pod name"
          optional
          hint={`Leave empty to use ${generatedName || "a generated pod name"}.`}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={generatedName || "fresh-pod"}
            autoComplete="off"
            maxLength={40}
          />
        </Field>

        {(type.fields ?? []).map((f) => (
          <div key={f.env}>
            {f.flavors ? (
              <FlavorPicker
                label={f.label}
                value={fields[f.env] ?? f.flavors[0].id}
                flavors={f.flavors}
                onChange={(v) => setFields((p) => ({ ...p, [f.env]: v }))}
              />
            ) : (
              <Field label={f.label} optional={f.optional} hint={f.hint}>
                <Input
                  type={f.secret ? "password" : "text"}
                  value={fields[f.env] ?? ""}
                  onChange={(e) =>
                    setFields((p) => ({ ...p, [f.env]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  required={!f.optional}
                  autoComplete="off"
                  spellCheck={false}
                />
                {f.hint && <Hint>{f.hint}</Hint>}
              </Field>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-6 py-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!canSubmit}
          loading={busy}
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Provisioning…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" /> Deploy {type.label}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function FlavorPicker({
  label,
  value,
  flavors,
  onChange,
}: {
  label: string;
  value: string;
  flavors: PodTypeFlavor[];
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-[12px] font-medium text-[color:var(--text-secondary)]">
        {label}
      </div>
      <div className="grid gap-2">
        {flavors.map((f) => {
          const active = value === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange(f.id)}
              className={cn(
                "border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-[color:var(--acc-blue)]/60 bg-[color:var(--acc-blue-soft)]/20"
                  : "border-[color:var(--border)] bg-[color:var(--bg-1)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-2)]",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-[13px] font-semibold tracking-tight",
                    f.accent ?? "text-[color:var(--text-primary)]",
                  )}
                >
                  {f.label}
                </span>
                {active && (
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--acc-blue)]">
                    selected
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[color:var(--text-tertiary)]">
                {f.blurb}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
