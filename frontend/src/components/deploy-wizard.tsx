"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  PROVIDERS,
  PROVIDER_BY_SLUG,
  PROVIDER_GROUPS,
  type Provider,
} from "@/lib/providers";
import { Sheet } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { PodsLoader } from "@/components/ui/pods-loader";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BrandIcon, providerBrand } from "@/components/brand-icon";
import { cn } from "@/lib/cn";
import {
  DEFAULT_DEPLOY_SIZE_ID,
  type DeploySizeId,
  deploySizeById,
} from "@/lib/deploy-sizes";
import { generatePodName } from "@/lib/pod-names";
import { POD_SETTLING_NOTICE } from "@/lib/pod-settling";

type Step = "provider" | "credentials" | "configure" | "review" | "deploying";
type SubscriptionGateState = {
  subscription: {
    plan: string;
    plan_name?: string;
    status: string;
  } | null;
  active_pod_count: number;
  active_pod_limit: number | null;
  plan_resource_limits: {
    ram_gb: number | null;
    cpu: number | null;
    ram_mib: number | null;
    cpu_percent: number | null;
  } | null;
  can_create_pod: boolean;
  gate_reason: string | null;
  message: string | null;
};

const STEPS: { id: Step; label: string; description?: string }[] = [
  { id: "provider", label: "Provider", description: "Pick an LLM backend" },
  { id: "credentials", label: "Credentials", description: "Drop in an API key" },
  { id: "configure", label: "Configure", description: "Name + resources" },
  { id: "review", label: "Review", description: "Confirm and deploy" },
];

const MANAGED_PROVIDER_SLUG = "pods-ml";
const MANAGED_FEATURES = [
  "AI provider",
  "Fallbacks",
  "Vision",
  "Image generation",
  "Web search",
  "STT/TTS",
];

const QUICK_PICKS = [
  "openrouter",
  "anthropic",
  "openai-codex",
  "gemini",
  "nous",
  "deepseek",
];

type ModelOption = { id: string; name?: string };

export function DeployWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("provider");
  const [providerSlug, setProviderSlug] = React.useState(MANAGED_PROVIDER_SLUG);
  const provider = PROVIDER_BY_SLUG[providerSlug];
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [model, setModel] = React.useState("");
  const [name, setName] = React.useState("");
  const [generatedName, setGeneratedName] = React.useState("");
  const size: DeploySizeId = DEFAULT_DEPLOY_SIZE_ID;
  const [models, setModels] = React.useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState(false);
  const [modelsError, setModelsError] = React.useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [showAllProviders, setShowAllProviders] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [subscriptionGate, setSubscriptionGate] =
    React.useState<SubscriptionGateState | null>(null);
  const [subscriptionGateLoading, setSubscriptionGateLoading] =
    React.useState(false);
  const [subscriptionGateError, setSubscriptionGateError] =
    React.useState<string | null>(null);

  // Reset wizard state when the sheet opens.
  React.useEffect(() => {
    if (!open) return;
    setStep("provider");
    setError(null);
    setSubscriptionGateError(null);
    setName("");
    setGeneratedName(generatePodName());
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSubscriptionGateLoading(true);
    setSubscriptionGateError(null);
    fetch("/api/billing/subscription", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Billing check failed (${res.status})`);
        return res.json();
      })
      .then((data: SubscriptionGateState | null) => {
        if (!cancelled) {
          setSubscriptionGate(data);
          setSubscriptionGateError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSubscriptionGate(null);
          setSubscriptionGateError(
            err instanceof Error ? err.message : "Billing check failed",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSubscriptionGateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  React.useEffect(() => {
    if (!provider) return;
    const next: Record<string, string> = {};
    for (const f of provider.fields ?? []) {
      if (f.default) next[f.env] = f.default;
    }
    setFields(next);
    setModel(provider.defaultModel ?? "");
    setModels([]);
    setModelsError(null);
  }, [providerSlug, provider]);

  const primaryKeyField = React.useMemo(
    () =>
      provider?.fields?.find((f) => f.secret && !f.advanced) ?? provider?.fields?.[0],
    [provider],
  );
  const primaryKey = primaryKeyField ? fields[primaryKeyField.env] ?? "" : "";

  React.useEffect(() => {
    if (!provider || provider.mode !== "key") return;
    const ep = provider.modelsEndpoint;
    if (!ep) return;
    const needsKey = ep.auth !== "none";
    if (needsKey && primaryKey.length < 8) {
      setModels([]);
      setModelsError(null);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);
    fetch(`/api/models?provider=${encodeURIComponent(provider.slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: primaryKey }),
    })
      .then((r) => r.json())
      .then((data: { models?: ModelOption[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setModelsError(data.error);
          setModels([]);
        } else {
          const list = data.models ?? [];
          setModels(list);
          const preferred =
            list.find((m) => /hermes-?(3|4)/i.test(m.id) && /nous/i.test(m.id)) ??
            list.find((m) => /hermes/i.test(m.id));
          if (preferred && !model) setModel(preferred.id);
        }
      })
      .catch((err) => {
        if (!cancelled) setModelsError(err.message ?? "fetch failed");
      })
      .finally(() => !cancelled && setModelsLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, primaryKey]);

  function setField(env: string, value: string) {
    setFields((p) => ({ ...p, [env]: value }));
  }

  function goToBillingPlans() {
    onOpenChange(false);
    router.push("/billing#plans");
  }

  React.useEffect(() => {
    if (provider?.managed && step === "credentials") setStep("configure");
  }, [provider?.managed, step]);

  const activeSteps = React.useMemo(
    () => (provider?.managed ? STEPS.filter((s) => s.id !== "credentials") : STEPS),
    [provider?.managed],
  );
  const stepNumbers = React.useMemo(
    () =>
      Object.fromEntries(
        activeSteps.map((s, i) => [s.id, String(i + 1).padStart(2, "0")]),
      ) as Partial<Record<Step, string>>,
    [activeSteps],
  );
  const deployingStepNumber = String(activeSteps.length + 1).padStart(2, "0");
  const stepIndex = activeSteps.findIndex((s) => s.id === step);
  const isLastStep = step === "review";
  const isHandoff = provider && provider.mode !== "key";
  const providerNeedsCredentials = Boolean(
    provider && provider.mode === "key" && !provider.managed,
  );
  const subscriptionGatePending = Boolean(
    open && !subscriptionGate && !subscriptionGateError,
  );
  const subscriptionGateChecking =
    subscriptionGateLoading || subscriptionGatePending;
  const deployBlocked = Boolean(
    subscriptionGateChecking ||
      subscriptionGateError ||
      !subscriptionGate ||
      !subscriptionGate.can_create_pod,
  );
  function canAdvance(): boolean {
    if (step === "provider") return !!provider && (provider.managed || provider.mode === "key");
    if (step === "credentials")
      return (
        providerNeedsCredentials &&
        (provider.fields ?? [])
          .filter((f) => !f.advanced)
          .every((f) => (fields[f.env]?.trim().length ?? 0) > 0)
      );
    if (step === "configure") return !deployBlocked;
    if (step === "review") return !submitting;
    return false;
  }

  function next() {
    if (!canAdvance()) return;
    const idx = activeSteps.findIndex((s) => s.id === step);
    const nextStep = activeSteps[idx + 1];
    if (nextStep) setStep(nextStep.id);
  }
  function back() {
    const idx = activeSteps.findIndex((s) => s.id === step);
    const prev = activeSteps[idx - 1];
    if (prev) setStep(prev.id);
  }

  async function handleDeploy() {
    if (!provider || (!provider.managed && provider.mode !== "key")) return;
    setError(null);
    setSubmitting(true);
    setStep("deploying");
    const deployName = name.trim() || generatedName || generatePodName();
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.slug,
          fields,
          model,
          name: deployName,
          size,
        }),
      });
      const data = (await res.json()) as
        | { uuid: string; identifier: string; name: string }
          | {
              error: string;
              message?: string;
            };
      if (res.status === 402 && "error" in data) {
        const msg = data.message || "Choose a subscription plan to create a new pod.";
        setError(msg);
        setStep("review");
        setSubmitting(false);
        toast.error("Subscription required", {
          description: msg,
          action: {
            label: "View pricing",
            onClick: goToBillingPlans,
          },
        });
        return;
      }
      if (!res.ok || "error" in data) {
        const msg =
          ("error" in data && (data.message || data.error)) ||
          `HTTP ${res.status}`;
        setError(msg);
        setStep("review");
        setSubmitting(false);
        toast.error("Deploy failed", { description: msg });
        return;
      }
      toast.success("Pod deployed", {
        description: `Provisioning ${data.name} now. ${POD_SETTLING_NOTICE}`,
        duration: 8000,
      });
      onOpenChange(false);
      router.push(`/pods/${data.identifier}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep("review");
      setSubmitting(false);
      toast.error("Deploy failed", { description: msg });
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v && submitting) return; // prevent close while deploying
        onOpenChange(v);
      }}
      title="Deploy a pod"
      description="Spin up a new Ubuntu sandbox with Hermes Agent in ~3 minutes."
      width={680}
      footer={
        step !== "deploying" && (
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="md"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={back}
                  disabled={submitting}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </Button>
              )}
              {!isLastStep ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={next}
                  disabled={!canAdvance()}
                >
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleDeploy}
                  loading={submitting}
                  disabled={!canAdvance() || isHandoff || deployBlocked}
                >
                  {submitting ? "" : "Deploy pod"}
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      <div className="grid grid-cols-[160px_1fr] gap-6 px-6 py-6">
        <aside className="hidden md:block">
          <Stepper steps={activeSteps} current={stepIndex >= 0 ? stepIndex : 0} />
        </aside>
        <div className="min-w-0">
          <SubscriptionGatePanel
            gate={subscriptionGate}
            loading={subscriptionGateChecking}
            error={subscriptionGateError}
            onPricing={goToBillingPlans}
          />
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {step === "provider" && (
                <ProviderStep
                  stepNumber={stepNumbers.provider ?? "01"}
                  selected={providerSlug}
                  onSelect={setProviderSlug}
                  showAll={showAllProviders}
                  setShowAll={setShowAllProviders}
                />
              )}
              {step === "credentials" && provider && (
                <CredentialsStep
                  stepNumber={stepNumbers.credentials ?? "02"}
                  provider={provider}
                  fields={fields}
                  setField={setField}
                  model={model}
                  setModel={setModel}
                  models={models}
                  modelsLoading={modelsLoading}
                  modelsError={modelsError}
                  showAdvanced={showAdvanced}
                  setShowAdvanced={setShowAdvanced}
                />
              )}
              {step === "configure" && (
                <ConfigureStep
                  stepNumber={stepNumbers.configure ?? "03"}
                  name={name}
                  setName={setName}
                  generatedName={generatedName}
                />
              )}
              {step === "review" && provider && (
                <ReviewStep
                  stepNumber={stepNumbers.review ?? "04"}
                  provider={provider}
                  fields={fields}
                  model={model}
                  name={name}
                  generatedName={generatedName}
                  size={size}
                  error={error}
                />
              )}
              {step === "deploying" && (
                <DeployingStep stepNumber={deployingStepNumber} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Sheet>
  );
}

function SubscriptionGatePanel({
  gate,
  loading,
  error,
  onPricing,
}: {
  gate: SubscriptionGateState | null;
  loading: boolean;
  error: string | null;
  onPricing: () => void;
}) {
  if (loading) {
    return (
      <div className="mb-5 border border-hairline bg-neutral-900 p-3 text-[12px] text-neutral-300">
        Checking subscription status...
      </div>
    );
  }
  if (error || !gate) {
    return (
      <div className="mb-5 border border-amber-400/30 bg-amber-400/10 p-3 text-[12px] leading-relaxed text-amber-100">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <div>
            <div className="font-medium">
              Could not verify billing status.
            </div>
            <div className="mt-1 text-amber-100/70">
              New pod creation stays blocked until your subscription can be checked.
            </div>
          </div>
        </div>
      </div>
    );
  }
  const usage =
    gate.active_pod_limit == null
      ? `${gate.active_pod_count} pods`
      : `${gate.active_pod_count} / ${gate.active_pod_limit} pods`;
  if (gate.can_create_pod) {
    return (
      <div className="mb-5 border border-live/25 bg-live/5 p-3 text-[12px] text-live">
        {gate.subscription?.plan_name ?? gate.subscription?.plan} plan active. {usage} used.
      </div>
    );
  }
  return (
    <div className="mb-5 border border-amber-400/30 bg-amber-400/10 p-3 text-[12px] leading-relaxed text-amber-100">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
        <div>
          <div className="font-medium">
            {gate.message ?? "Choose a subscription plan to create a new pod."}
          </div>
          <div className="mt-1 text-amber-100/70">
            Existing pods remain available. New pods and resource upgrades require an active plan.
          </div>
          <button
            type="button"
            onClick={onPricing}
            className="mt-2 font-mono text-[11px] uppercase tracking-wider underline-offset-2 hover:underline"
          >
            View pricing
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderStep({
  stepNumber,
  selected,
  onSelect,
  showAll,
  setShowAll,
}: {
  stepNumber: string;
  selected: string;
  onSelect: (s: string) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
}) {
  const managed = PROVIDER_BY_SLUG[MANAGED_PROVIDER_SLUG];
  const quick = QUICK_PICKS.map((s) => PROVIDER_BY_SLUG[s]).filter(Boolean) as Provider[];
  const provider = PROVIDER_BY_SLUG[selected];
  const [advancedOpen, setAdvancedOpen] = React.useState(true);
  const listedProviders = PROVIDERS.filter((p) => !p.managed);

  return (
    <div className="space-y-6">
      <header>
        <div className="micro text-neutral-500">{stepNumber} / Provider</div>
        <h3 className="mt-2 font-display text-[22px] leading-tight tracking-tight text-foreground">
          Pick your model provider<span className="text-signal">.</span>
        </h3>
        <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
          Use Pods Managed with no API key, or bring your own provider key.
          Switch providers anytime from the pod&apos;s Settings tab.
        </p>
      </header>

      {managed && (
        <div className="space-y-2">
          <div className="micro text-neutral-500">Pods Managed</div>
          <button
            type="button"
            onClick={() => onSelect(managed.slug)}
            className={cn(
              "group w-full border p-4 text-left transition-colors",
              selected === managed.slug
                ? "border-signal/70 bg-signal/5 ring-1 ring-inset ring-signal/40"
                : "border-hairline bg-neutral-950 hover:bg-neutral-900",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-hairline bg-neutral-900">
                  <BrandIcon slug={providerBrand(managed.slug)} size={18} />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold tracking-tight text-foreground">
                      {managed.label}
                    </span>
                    <span className="border border-signal/30 bg-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-signal">
                      no api key
                    </span>
                  </span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-neutral-300">
                    Managed by clankerplace: AI provider routing, model fallbacks,
                    vision, image generation, web search/extract, and speech
                    tools are already wired into the pod.
                  </span>
                </span>
              </div>
              {selected === managed.slug && (
                <Check className="mt-1 h-4 w-4 shrink-0 text-signal" strokeWidth={2.5} />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {MANAGED_FEATURES.map((feature) => (
                <span
                  key={feature}
                  className="border border-hairline bg-neutral-900 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-neutral-400"
                >
                  {feature}
                </span>
              ))}
            </div>
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-neutral-500 transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", advancedOpen && "rotate-180")}
        />
        Provider options
      </button>

      {advancedOpen && (
        <div className="space-y-6 border-l border-hairline pl-4">
          <div className="micro text-neutral-500">Bring your own key</div>
          <div className="grid gap-px border border-hairline bg-hairline grid-cols-2 sm:grid-cols-3">
            {quick.map((p, i) => {
              const active = p.slug === selected;
              return (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => onSelect(p.slug)}
                  className={cn(
                    "group relative flex flex-col items-start gap-2.5 p-3.5 text-left transition-colors",
                    active
                      ? "bg-neutral-900 ring-1 ring-inset ring-signal"
                      : "bg-neutral-950 hover:bg-neutral-900",
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "font-mono text-[10px] tabular",
                          active ? "text-signal" : "text-neutral-600",
                        )}
                      >
                        {(i + 1).toString().padStart(2, "0")}
                      </span>
                      <BrandIcon slug={providerBrand(p.slug)} size={18} />
                    </span>
                    {active && (
                      <Check className="h-3.5 w-3.5 text-signal" strokeWidth={2.5} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                      {p.label.replace(/\s*\(.*\)$/, "")}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-neutral-400">
                      {p.blurb}
                    </div>
                  </div>
                  {p.mode !== "key" && (
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 border border-hairline bg-neutral-950 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neutral-400">
                      <Wrench className="h-2.5 w-2.5" /> terminal
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-neutral-500 transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", showAll && "rotate-180")}
            />
            See all BYOK providers ({listedProviders.length})
          </button>

          {showAll && (
            <Select
              value={selected === MANAGED_PROVIDER_SLUG ? "" : selected}
              onChange={(e) => onSelect(e.target.value)}
            >
              <option value="" disabled>
                Select a BYOK provider
              </option>
              {PROVIDER_GROUPS.map((g) => {
                const items = listedProviders.filter((p) => p.group === g.id);
                if (items.length === 0) return null;
                return (
                  <optgroup key={g.id} label={g.label}>
                    {items.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.label}
                        {p.mode !== "key" ? "  ·  needs terminal" : ""}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
          )}

          {provider && provider.mode !== "key" && (
            <div className="border border-hairline bg-neutral-900 p-4">
              <div className="micro flex items-center gap-2 text-signal">
                <Sparkles className="h-3 w-3" />
                Setup requires the pod terminal
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-300">
                {provider.oauthHint}
              </p>
              <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
                Deploy first with another provider (e.g. OpenRouter), then run
                this provider&apos;s OAuth or CLI flow inside the pod.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CredentialsStep({
  stepNumber,
  provider,
  fields,
  setField,
  model,
  setModel,
  models,
  modelsLoading,
  modelsError,
  showAdvanced,
  setShowAdvanced,
}: {
  stepNumber: string;
  provider: Provider;
  fields: Record<string, string>;
  setField: (k: string, v: string) => void;
  model: string;
  setModel: (m: string) => void;
  models: ModelOption[];
  modelsLoading: boolean;
  modelsError: string | null;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
}) {
  const visible = (provider.fields ?? []).filter(
    (f) => !f.advanced || showAdvanced,
  );
  return (
    <div className="space-y-6">
      <header>
        <div className="micro text-neutral-500">{stepNumber} / Credentials</div>
        <h3 className="mt-2 font-display text-[22px] leading-tight tracking-tight text-foreground">
          Provider credentials<span className="text-signal">.</span>
        </h3>
        <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
          Stored only inside your pod — never in our database.{" "}
          {provider.homepage && (
            <>
              Get a key from{" "}
              <a
                href={provider.homepage}
                target="_blank"
                rel="noreferrer"
                className="text-signal underline-offset-2 hover:underline"
              >
                {new URL(provider.homepage).hostname.replace("www.", "")}
              </a>
              .
            </>
          )}
        </p>
      </header>

      {visible.map((f) => (
        <Field
          key={f.env}
          label={f.label}
          hint={f.advanced ? "advanced" : undefined}
        >
          {f.options ? (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                {f.options.map((opt) => {
                  const current = fields[f.env] ?? f.default ?? "";
                  const selected = current === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setField(f.env, opt.value)}
                      className={cn(
                        "border p-3 text-left transition-colors",
                        selected
                          ? "border-signal/60 bg-signal/5"
                          : "border-hairline bg-neutral-900 hover:bg-neutral-800",
                      )}
                    >
                      <div className="text-[12px] font-medium text-foreground">
                        {opt.label}
                      </div>
                      {opt.hint && (
                        <p className="mt-1 text-[11px] leading-snug text-neutral-400">
                          {opt.hint}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
              {f.help && (
                <p className="text-[11px] leading-snug text-neutral-500">
                  {f.help}
                </p>
              )}
            </div>
          ) : (
            <>
              <Input
                type={f.secret ? "password" : "text"}
                value={fields[f.env] ?? ""}
                onChange={(e) => setField(f.env, e.target.value)}
                placeholder={f.placeholder}
                required={!f.advanced && !f.default}
                autoFocus={f === visible[0]}
              />
              {f.help && (
                <p className="mt-1 text-[11px] leading-snug text-neutral-500">
                  {f.help}
                </p>
              )}
            </>
          )}
        </Field>
      ))}

      <Field
        label="Model"
        hint={
          modelsLoading
            ? "fetching models…"
            : modelsError
              ? "couldn't fetch list"
              : models.length > 0
                ? `${models.length} models available`
                : undefined
        }
      >
        {models.length > 0 ? (
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ? `${m.id} — ${m.name}` : m.id}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={provider.defaultModel ?? "model-id"}
            className="font-mono"
          />
        )}
      </Field>

      {(provider.fields ?? []).some((f) => f.advanced) && (
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-neutral-500 transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-180")}
          />
          {showAdvanced ? "Hide" : "Show"} advanced fields
        </button>
      )}
    </div>
  );
}

function ConfigureStep({
  stepNumber,
  name,
  setName,
  generatedName,
}: {
  stepNumber: string;
  name: string;
  setName: (s: string) => void;
  generatedName: string;
}) {
  const instance = deploySizeById(DEFAULT_DEPLOY_SIZE_ID);
  return (
    <div className="space-y-6">
      <header>
        <div className="micro text-neutral-500">{stepNumber} / Configure</div>
        <h3 className="mt-2 font-display text-[22px] leading-tight tracking-tight text-foreground">
          Configure your pod<span className="text-signal">.</span>
        </h3>
        <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
          Name the pod. The instance is selected automatically for this template.
        </p>
      </header>

      <Field
        label="Name"
        optional
        hint={`Leave empty to use ${generatedName || "a generated pod name"}.`}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={generatedName || "fresh-pod"}
          maxLength={40}
          autoFocus
        />
      </Field>

      {instance && (
        <div className="border border-hairline bg-neutral-950 p-4">
          <div className="micro text-neutral-500">Deploying on instance</div>
          <div className="mt-2 font-mono text-[13px] text-foreground">
            {formatInstanceSpec(instance)}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            Instance resources are fixed for this deploy flow and checked against
            your active plan at deploy time.
          </p>
        </div>
      )}
    </div>
  );
}

function ReviewStep({
  stepNumber,
  provider,
  fields,
  model,
  name,
  generatedName,
  size,
  error,
}: {
  stepNumber: string;
  provider: Provider;
  fields: Record<string, string>;
  model: string;
  name: string;
  generatedName: string;
  size: DeploySizeId;
  error: string | null;
}) {
  const sizeSpec = deploySizeById(size);
  const keyField = provider.fields?.find((f) => f.secret);
  const keyValue = keyField ? fields[keyField.env] ?? "" : "";
  const managed = Boolean(provider.managed);
  const podName = name.trim() || generatedName || "fresh-pod";
  return (
    <div className="space-y-6">
      <header>
        <div className="micro text-neutral-500">{stepNumber} / Review</div>
        <h3 className="mt-2 font-display text-[22px] leading-tight tracking-tight text-foreground">
          Review and deploy<span className="text-signal">.</span>
        </h3>
        <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
          Pod creation runs <span className="font-mono text-neutral-300">hermes install</span>, syncs env vars, and starts a fresh
          shell. Takes ~3 minutes.
        </p>
      </header>

      <div className="divide-y divide-hairline border border-hairline bg-neutral-950">
        <Row label="Pod name" value={podName} mono />
        <Row label="Template" value="Hermes Agent" />
        <Row
          label="Provider"
          value={
            <span className="inline-flex items-center gap-1.5">
              <BrandIcon slug={providerBrand(provider.slug)} size={14} />
              {provider.label}
            </span>
          }
        />
        <Row
          label="Model"
          value={managed ? "Managed defaults" : model || provider.defaultModel || "—"}
          mono
        />
        {managed && (
          <Row
            label="Included"
            value="AI provider, fallbacks, image generation, web search, vision, speech"
            wrap
          />
        )}
        {keyField && (
          <Row
            label={keyField.label}
            value={keyValue ? maskKey(keyValue) : "—"}
            mono
          />
        )}
        {sizeSpec && (
          <Row
            label="Instance"
            value={formatInstanceSpec(sizeSpec)}
            mono
            wrap
          />
        )}
      </div>

      {error && (
        <div className="border border-error/30 bg-error/5 p-3 text-[12px] text-error">
          {error}
        </div>
      )}
    </div>
  );
}

function DeployingStep({ stepNumber }: { stepNumber: string }) {
  return (
    <div className="flex h-[320px] flex-col items-center justify-center text-center">
      <PodsLoader
        size="lg"
        label="Allocating, installing Hermes, and seeding provider configuration."
        className="mb-4"
      />
      <div className="micro text-neutral-500">{stepNumber} / Deploying</div>
      <h3 className="mt-2 font-display text-[20px] leading-tight tracking-tight text-foreground">
        Provisioning your sandbox<span className="text-signal">...</span>
      </h3>
      <p className="mt-3 max-w-[340px] text-[11px] leading-relaxed text-neutral-500">
        {POD_SETTLING_NOTICE}
      </p>
    </div>
  );
}

function formatInstanceSpec(size: {
  memoryMib: number;
  cpuPercent: number;
  diskMib: number;
}): string {
  const memory =
    size.memoryMib >= 1024 ? `${size.memoryMib / 1024} GB RAM` : `${size.memoryMib} MB RAM`;
  return `${memory} · ${(size.cpuPercent / 100).toFixed(size.cpuPercent < 100 ? 1 : 0)} vCPU · ${(size.diskMib / 1024).toFixed(0)} GB disk`;
}

function Row({
  label,
  value,
  mono,
  wrap,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <span className="micro text-neutral-500">{label}</span>
      <span
        className={cn(
          "min-w-0 max-w-[60%] text-right text-[13px] text-foreground",
          wrap ? "whitespace-normal leading-relaxed" : "truncate",
          mono && "font-mono text-[12px] tabular",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function maskKey(k: string): string {
  if (k.length <= 8) return "•".repeat(k.length);
  return k.slice(0, 4) + "•".repeat(8) + k.slice(-4);
}
