"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { Connector } from "@/lib/connectors";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Hint } from "@/components/ui/input";
import { BrandIcon, connectorBrand } from "@/components/brand-icon";
import WebhookEventsLog from "./WebhookEventsLog";

type ConnectorStatus = {
  id: string;
  configured: boolean;
  running: boolean;
};

export default function ConnectorCard({
  identifier,
  connector,
  status,
  disabled,
  domainHost,
  onChange,
}: {
  identifier: string;
  connector: Connector;
  status: ConnectorStatus | undefined;
  disabled?: boolean;
  /** auto-domain host for this pod (`<slug>.bigcat.pw`); enables webhook URL render */
  domainHost?: string | null;
  onChange: () => void;
}) {
  const webhookUrl =
    connector.webhookPath && domainHost
      ? `https://${domainHost}${connector.webhookPath}`
      : null;
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing && status?.configured) return;
    setFields({});
    setError(null);
  }, [connector.slug, editing, status?.configured]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Auto-populate the {webhookUrlEnv} field with the path-routed URL
      // so the Hermes adapter receives the right value without the user
      // having to copy-paste the URL back into the form.
      const submission =
        connector.webhookUrlEnv && webhookUrl
          ? { ...fields, [connector.webhookUrlEnv]: webhookUrl }
          : fields;
      const r = await fetch(
        `/api/pods/${identifier}/connectors/${connector.slug}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: submission }),
        },
      );
      const d = (await r.json()) as { ok?: true; error?: string };
      if (!r.ok || !d.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setFields({});
      setEditing(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${connector.label} and stop the gateway?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/pods/${identifier}/connectors/${connector.slug}`, {
        method: "DELETE",
      });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const primary = connector.fields?.[0];
  const canSubmit = primary && (fields[primary.env]?.trim().length ?? 0) >= 4;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 flex-none items-center justify-center border border-[color:var(--border)] bg-[color:var(--bg-3)]">
            <BrandIcon slug={connectorBrand(connector.slug)} size={16} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold tracking-tight text-[color:var(--text-primary)]">
              {connector.label}
            </div>
            <p className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">
              {connector.blurb}
            </p>
          </div>
        </div>
        <StatusBadge status={status} />
      </CardHeader>

      <CardBody>
        {webhookUrl && !disabled && (
          <>
            <WebhookUrlBlock url={webhookUrl} />
            {connector.webhookPath && (
              <WebhookEventsLog
                identifier={identifier}
                pathPrefix={connector.webhookPath}
              />
            )}
          </>
        )}
        {disabled ? (
          <p className="text-[12px] text-[color:var(--text-tertiary)]">
            Pod is still installing — connectors unlock when the console is live.
          </p>
        ) : status?.configured && !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Reconfigure
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={disconnect}
              disabled={busy}
            >
              Disconnect
            </Button>
            {connector.docs && (
              <a
                href={connector.docs}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
              >
                docs <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <form onSubmit={save} className="space-y-3">
            {(connector.fields ?? []).map((f) => (
              <Field
                key={f.env}
                label={f.label}
                optional={f.optional}
                hint={f.hint}
              >
                <Input
                  type={f.secret ? "password" : "text"}
                  value={fields[f.env] ?? ""}
                  onChange={(e) =>
                    setFields((p) => ({ ...p, [f.env]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  required={!f.optional}
                />
                {f.hint && <Hint>{f.hint}</Hint>}
              </Field>
            ))}
            {error && (
              <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-2.5 py-1.5 text-[12px] text-[color:var(--acc-red)]">
                {error}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!canSubmit}
                loading={busy}
              >
                {busy ? "" : "Connect"}
              </Button>
              {editing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              )}
              {connector.docs && (
                <a
                  href={connector.docs}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
                >
                  docs <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function WebhookUrlBlock({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }
  return (
    <div className="mb-3 border border-[color:var(--border)] bg-[color:var(--bg-2)] px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[color:var(--text-quaternary)]">
        <span>Webhook URL</span>
        <span className="bg-[color:var(--bg-3)] px-1.5 py-0.5 font-mono text-[9px] tracking-normal text-[color:var(--text-tertiary)]">
          paste into platform dashboard
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[color:var(--acc-blue)]">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex flex-none items-center gap-1 border border-[color:var(--border)] bg-[color:var(--bg-3)] px-2 py-1 text-[10px] text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)]"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ConnectorStatus | undefined }) {
  if (!status) {
    return <Badge tone="neutral">loading…</Badge>;
  }
  if (status.running) {
    return (
      <Badge tone="green">
        <StatusDot tone="green" pulse />
        running
      </Badge>
    );
  }
  if (status.configured) {
    return (
      <Badge tone="amber">
        <StatusDot tone="amber" />
        stopped
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <StatusDot tone="neutral" />
      not connected
    </Badge>
  );
}
