"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Cpu,
  HardDrive,
  MemoryStick,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  PROVIDERS,
  PROVIDER_BY_SLUG,
  PROVIDER_GROUPS,
  type Provider,
} from "@/lib/providers";
import { Button } from "@/components/ui/button";
import { Input, Field, Hint } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BrandIcon, providerBrand } from "@/components/brand-icon";
import { cn } from "@/lib/cn";

type DeployResponse = {
  uuid: string;
  identifier: string;
  name: string;
};

type ModelOption = { id: string; name?: string };
type Mode = "basic" | "advanced";

// Pinned in the basic-mode quick-pick. The rest are accessible via the dropdown.
const QUICK_PICK = ["openrouter", "anthropic", "openai-codex", "gemini", "nous"];

const DEFAULT_PROVIDER = "openrouter";

export default function DeployForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("basic");
  const [providerSlug, setProviderSlug] = useState(DEFAULT_PROVIDER);
  const provider = PROVIDER_BY_SLUG[providerSlug];
  const [fields, setFields] = useState<Record<string, string>>({});
  const [model, setModel] = useState("");
  const [name, setName] = useState("");
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider) return;
    const next: Record<string, string> = {};
    for (const f of provider.fields ?? []) {
      if (f.default) next[f.env] = f.default;
    }
    setFields(next);
    setModel(provider.defaultModel ?? "");
    setModels([]);
    setModelsError(null);
    setError(null);
  }, [providerSlug, provider]);

  const primaryKeyField = useMemo(
    () =>
      provider?.fields?.find((f) => f.secret && !f.advanced) ??
      provider?.fields?.[0],
    [provider],
  );
  const primaryKey = primaryKeyField ? fields[primaryKeyField.env] ?? "" : "";

  useEffect(() => {
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
            list.find(
              (m) => /hermes-?(3|4)/i.test(m.id) && /nous/i.test(m.id),
            ) ?? list.find((m) => /hermes/i.test(m.id));
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
    setFields((prev) => ({ ...prev, [env]: value }));
  }

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();
    if (!provider || provider.mode !== "key") return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.slug,
          fields,
          model,
          name,
        }),
      });
      const data = (await res.json()) as DeployResponse | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || `HTTP ${res.status}`);
        return;
      }
      router.push(`/pods/${data.identifier}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!provider) return null;
  const isHandoff = provider.mode !== "key";
  const isComingSoon = provider.mode === "cloud" && provider.slug === "pods-ml";

  const basicFields = (provider.fields ?? []).filter(
    (f) => !f.advanced || showAdvancedFields,
  );
  const advancedFields = (provider.fields ?? []).filter((f) => f.advanced);

  return (
    <div className="overflow-hidden border border-hairline bg-neutral-950">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
        <div>
          <div className="micro text-neutral-500">Deploy</div>
          <h2 className="mt-1 font-display text-[18px] leading-tight tracking-tight text-foreground">
            Hermes Agent<span className="text-signal">.</span>
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-neutral-400">
            Pick a provider, bring a key, get a sandbox in ~3&nbsp;min.
          </p>
        </div>
        <ModeToggle value={mode} onChange={setMode} />
      </div>

      <form onSubmit={handleDeploy} className="space-y-5 px-5 py-5">
        <Field
          label="Pod name"
          optional
          hint="defaults to a friendly random id"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="hermes-1"
          />
        </Field>

        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="micro text-neutral-500">Provider</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
              {PROVIDERS.length} providers · {provider.blurb}
            </span>
          </div>
          {mode === "basic" ? (
            <ProviderTiles
              value={providerSlug}
              onChange={setProviderSlug}
              filter={QUICK_PICK}
              dropdown={
                <ProviderSelect
                  value={providerSlug}
                  onChange={setProviderSlug}
                />
              }
            />
          ) : (
            <ProviderSelect value={providerSlug} onChange={setProviderSlug} />
          )}
        </div>

        {isHandoff ? (
          <HandoffNotice
            provider={provider}
            disabledReason={isComingSoon ? "coming-soon" : undefined}
          />
        ) : (
          <div className="space-y-3">
            {basicFields.map((f) => (
              <Field
                key={f.env}
                label={f.label}
                hint={f.advanced ? "advanced" : undefined}
              >
                <Input
                  type={f.secret ? "password" : "text"}
                  value={fields[f.env] ?? ""}
                  onChange={(e) => setField(f.env, e.target.value)}
                  placeholder={f.placeholder}
                  required={!f.advanced && !f.default}
                />
              </Field>
            ))}

            <Field
              label="Model"
              hint={
                modelsLoading
                  ? "loading models…"
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

            {advancedFields.length > 0 && mode === "advanced" && (
              <button
                type="button"
                onClick={() => setShowAdvancedFields((v) => !v)}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-neutral-500 transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showAdvancedFields ? "rotate-180" : "",
                  )}
                />
                {showAdvancedFields ? "Hide" : "Show"} advanced fields
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="border border-error/30 bg-error/5 px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <ResourcesRow />
          <Button
            type="submit"
            variant="signal"
            size="md"
            loading={submitting}
            disabled={
              isHandoff ||
              (provider.mode === "key" &&
                primaryKeyField &&
                (fields[primaryKeyField.env] ?? "").length < 8) ||
              undefined
            }
          >
            {submitting ? "" : "Deploy Hermes Agent"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ModeToggle({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="inline-flex border border-hairline bg-neutral-900 p-0.5 font-mono text-[10px] uppercase tracking-wider">
      {(["basic", "advanced"] as Mode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 transition-colors",
            m === value
              ? "bg-neutral-950 text-foreground"
              : "text-neutral-500 hover:text-foreground",
          )}
        >
          {m === "basic" ? (
            <Zap className="h-3 w-3" />
          ) : (
            <Settings2 className="h-3 w-3" />
          )}
          {m === "basic" ? "Basic" : "Advanced"}
        </button>
      ))}
    </div>
  );
}

function ProviderTiles({
  value,
  onChange,
  filter,
  dropdown,
}: {
  value: string;
  onChange: (slug: string) => void;
  filter: string[];
  dropdown: React.ReactNode;
}) {
  const items = filter
    .map((s) => PROVIDER_BY_SLUG[s])
    .filter(Boolean) as Provider[];
  return (
    <div className="space-y-2.5">
      <div className="grid gap-px border border-hairline bg-hairline grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((p, i) => {
          const active = p.slug === value;
          return (
            <button
              key={p.slug}
              type="button"
              onClick={() => onChange(p.slug)}
              className={cn(
                "group relative flex flex-col items-start gap-2 p-3 text-left transition-colors",
                active
                  ? "bg-neutral-900 ring-1 ring-inset ring-signal"
                  : "bg-neutral-950 hover:bg-neutral-900",
              )}
            >
              <div className="flex w-full items-center gap-2">
                <span
                  className={cn(
                    "font-mono text-[10px] tabular",
                    active ? "text-signal" : "text-neutral-600",
                  )}
                >
                  {(i + 1).toString().padStart(2, "0")}
                </span>
                <BrandIcon slug={providerBrand(p.slug)} size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold tracking-tight text-foreground">
                  {p.label.replace(/\s*\(.*\)$/, "")}
                </div>
                {p.mode !== "key" && (
                  <span className="mt-1 inline-flex border border-hairline bg-neutral-950 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neutral-400">
                    needs terminal
                  </span>
                )}
              </div>
              {active && (
                <span className="absolute right-2 top-2 inline-block h-1.5 w-1.5 bg-signal" />
              )}
            </button>
          );
        })}
      </div>
      <details className="group">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-neutral-500 transition-colors hover:text-foreground">
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
          See all providers ({PROVIDERS.length})
        </summary>
        <div className="mt-2">{dropdown}</div>
      </details>
    </div>
  );
}

function ProviderSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (slug: string) => void;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {PROVIDER_GROUPS.map((g) => {
        const items = PROVIDERS.filter((p) => p.group === g.id);
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
  );
}

function HandoffNotice({
  provider,
  disabledReason,
}: {
  provider: Provider;
  disabledReason?: "coming-soon";
}) {
  return (
    <div className="border border-warning/30 bg-warning/5 px-3 py-3 text-[12px]">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-warning">
        <Sparkles className="h-3 w-3" />
        {disabledReason === "coming-soon"
          ? "Coming soon"
          : "Setup requires the pod terminal"}
      </div>
      <p className="mt-1.5 leading-relaxed text-neutral-300">
        {provider.oauthHint}
      </p>
      {disabledReason !== "coming-soon" && (
        <Hint className="mt-2">
          Deploy first with another provider (e.g. OpenRouter), then run this
          provider&apos;s setup from inside the pod.
        </Hint>
      )}
    </div>
  );
}

function ResourcesRow() {
  return (
    <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
      <span className="inline-flex items-center gap-1.5">
        <MemoryStick className="h-3 w-3" />
        2 GB
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Cpu className="h-3 w-3" />
        1 vCPU
      </span>
      <span className="inline-flex items-center gap-1.5">
        <HardDrive className="h-3 w-3" />
        15 GB
      </span>
    </div>
  );
}
