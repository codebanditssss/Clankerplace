"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import {
  PROVIDERS,
  PROVIDER_BY_SLUG,
  PROVIDER_GROUPS,
} from "@/lib/providers";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PodsLoader } from "@/components/ui/pods-loader";
import { Field, Input, Hint } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BrandIcon, providerBrand } from "@/components/brand-icon";
import { POD_SETTLING_NOTICE } from "@/lib/pod-settling";

type ModelOption = { id: string; name?: string };

export default function ProviderSettings({
  identifier,
  currentProvider,
  currentModel,
}: {
  identifier: string;
  currentProvider: string;
  currentModel: string;
}) {
  const [providerSlug, setProviderSlug] = useState(currentProvider);
  const provider = PROVIDER_BY_SLUG[providerSlug];
  const [fields, setFields] = useState<Record<string, string>>({});
  const [model, setModel] = useState(currentModel);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  // Last-saved provider/model, so the "Currently …" line updates instantly
  // on save (optimistic) while router.refresh() re-pulls the SSR props.
  const [saved, setSaved] = useState<{ provider: string; model: string } | null>(
    null,
  );
  const router = useRouter();

  useEffect(() => {
    if (!provider) return;
    const next: Record<string, string> = {};
    for (const f of provider.fields ?? []) if (f.default) next[f.env] = f.default;
    setFields(next);
    setModels([]);
    setModelsError(null);
    setError(null);
    setOkMessage(null);
    if (providerSlug !== currentProvider) {
      setModel(provider.defaultModel ?? "");
    }
  }, [providerSlug, provider, currentProvider]);

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
    if (ep.auth !== "none" && primaryKey.length < 8) {
      setModels([]);
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
          setModels(data.models ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) setModelsError(err.message ?? "fetch failed");
      })
      .finally(() => !cancelled && setModelsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [provider, primaryKey]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!provider || provider.mode !== "key") return;
    setError(null);
    setOkMessage(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/pods/${identifier}/provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.slug, fields, model }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: true;
        error?: string;
        provider?: string;
        model?: string;
      };
      if (!r.ok || !d.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      // Reflect the saved values immediately, then re-render the server
      // component so the header strip + Settings cards (SSR-bound to Pelican
      // env, now synced by the route) update without a manual reload.
      setSaved({ provider: d.provider ?? provider.slug, model: d.model ?? model });
      setOkMessage(
        `Saved. Restart any active hermes session in the Console to pick up the new provider. ${POD_SETTLING_NOTICE}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!provider) return null;
  const isHandoff = provider.mode !== "key";
  const visibleFields = (provider.fields ?? []).filter(
    (f) => showAdvanced || !f.advanced,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 flex-none items-center justify-center border border-[color:var(--border)] bg-[color:var(--bg-3)]">
            <BrandIcon slug={providerBrand(providerSlug)} size={16} />
          </div>
          <div className="min-w-0">
            <CardTitle>Inference provider</CardTitle>
            <CardDescription>
              Currently{" "}
              <span className="font-mono text-[color:var(--text-secondary)]">
                {saved?.provider ?? currentProvider}
              </span>{" "}
              ·{" "}
              <span className="font-mono text-[color:var(--text-secondary)]">
                {saved?.model ?? currentModel}
              </span>
              . Writes to{" "}
              <code className="font-mono">~/.hermes/.env</code> and{" "}
              <code className="font-mono">config.yaml</code>.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <form onSubmit={save}>
        <CardBody className="space-y-3">
          {busy && (
            <div className="border border-[color:var(--border)] bg-[color:var(--bg-1)] px-4 py-5">
              <PodsLoader
                size="sm"
                label="Saving provider configuration..."
                className="mx-auto"
              />
            </div>
          )}
          <Field label="Provider" hint={provider.blurb}>
            <Select
              value={providerSlug}
              onChange={(e) => setProviderSlug(e.target.value)}
            >
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
          </Field>

          {isHandoff ? (
            <div className="border border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)] px-3 py-2 text-[12px] text-[color:var(--acc-amber)]">
              {provider.oauthHint}
            </div>
          ) : (
            <>
              {visibleFields.map((f) => (
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
                              onClick={() =>
                                setFields((p) => ({ ...p, [f.env]: opt.value }))
                              }
                              className={
                                "border p-2.5 text-left transition-colors " +
                                (selected
                                  ? "border-[color:var(--acc-blue)]/50 bg-[color:var(--acc-blue-soft)]"
                                  : "border-[color:var(--border)] bg-[color:var(--bg-1)] hover:bg-[color:var(--bg-3)]")
                              }
                            >
                              <div className="text-[12px] font-medium text-[color:var(--text-primary)]">
                                {opt.label}
                              </div>
                              {opt.hint && (
                                <p className="mt-0.5 text-[11px] leading-snug text-[color:var(--text-tertiary)]">
                                  {opt.hint}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {f.help && (
                        <p className="text-[11px] leading-snug text-[color:var(--text-quaternary)]">
                          {f.help}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <Input
                        type={f.secret ? "password" : "text"}
                        value={fields[f.env] ?? ""}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, [f.env]: e.target.value }))
                        }
                        placeholder={f.placeholder}
                        required={!f.advanced && !f.default}
                      />
                      {f.help && (
                        <p className="mt-1 text-[11px] leading-snug text-[color:var(--text-quaternary)]">
                          {f.help}
                        </p>
                      )}
                    </>
                  )}
                </Field>
              ))}

              <Field
                label="Model"
                hint={modelsLoading ? "loading…" : modelsError ? "couldn't fetch list" : undefined}
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
                  />
                )}
              </Field>

              {(provider.fields ?? []).some((f) => f.advanced) && (
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
                >
                  <ChevronDown
                    className={`mr-1 inline h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                  />
                  {showAdvanced ? "Hide advanced" : "Show advanced"}
                </button>
              )}
            </>
          )}

          {error && (
            <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-3 py-2 text-[12px] text-[color:var(--acc-red)]">
              {error}
            </div>
          )}
          {okMessage && (
            <div className="flex items-start gap-2 border border-[color:var(--acc-green)]/30 bg-[color:var(--acc-green-soft)] px-3 py-2 text-[12px] text-[color:var(--acc-green)]">
              <Check className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>{okMessage}</span>
            </div>
          )}
        </CardBody>

        <div className="border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-1)]/40 px-5 py-3">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isHandoff}
            loading={busy}
          >
            {busy ? "" : "Save provider"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
