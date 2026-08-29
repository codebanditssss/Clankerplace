"use client";

// Compact card for a connector that's already configured + connected.
// Sits in the Connectors tab's "Connected" list. Click "Manage" → expand
// inline to show the token form (re-uses the same POST endpoint as initial
// setup). "Disconnect" wipes the connector's env keys.
//
// WhatsApp is NOT handled by this component — it gets its own full-width
// WhatsAppConnector card because its state model is much richer (paired
// vs not, mode, allowed users, prefix, debug, unauthorized DM behavior).
import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  PowerOff,
  Settings as SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Connector } from "@/lib/connectors";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Hint } from "@/components/ui/input";
import { BrandIcon, connectorBrand } from "@/components/brand-icon";
import { POD_SETTLING_NOTICE } from "@/lib/pod-settling";
import WebhookEventsLog from "./WebhookEventsLog";

type Status = { configured: boolean; running: boolean };

export default function ConfiguredConnectorCard({
  identifier,
  connector,
  status,
  domainHost,
  onChange,
}: {
  identifier: string;
  connector: Connector;
  status?: Status;
  domainHost?: string | null;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const webhookUrl =
    connector.webhookPath && domainHost
      ? `https://${domainHost}${connector.webhookPath}`
      : null;

  async function disconnect() {
    if (
      !confirm(
        `Disconnect ${connector.label}? Credentials will be wiped from the pod's .env and the gateway will restart.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/pods/${identifier}/connectors/${connector.slug}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? `HTTP ${r.status}`);
        return;
      }
      toast.success(`${connector.label} disconnected`);
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
        {webhookUrl && <WebhookUrlBlock url={webhookUrl} />}
        {connector.webhookPath && (
          <WebhookEventsLog
            identifier={identifier}
            pathPrefix={connector.webhookPath}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setExpanded((v) => !v)}
          >
            <SettingsIcon className="h-3 w-3" />
            {expanded ? "Hide credentials" : "Manage"}
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={disconnect}
            disabled={busy}
          >
            <PowerOff className="h-3 w-3" /> Disconnect
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

        {expanded && (
          <ReconfigureForm
            identifier={identifier}
            connector={connector}
            webhookUrl={webhookUrl}
            onSaved={() => {
              setExpanded(false);
              onChange();
            }}
          />
        )}
      </CardBody>
    </Card>
  );
}

function ReconfigureForm({
  identifier,
  connector,
  webhookUrl,
  onSaved,
}: {
  identifier: string;
  connector: Connector;
  webhookUrl: string | null;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
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
      const d = (await r.json().catch(() => ({}))) as {
        ok?: true;
        error?: string;
      };
      if (!r.ok || !d.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      toast.success(`${connector.label} updated — gateway restarting`, {
        description: POD_SETTLING_NOTICE,
        duration: 8000,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 border-t border-[color:var(--border-subtle)] pt-3">
      <Hint>
        Re-saving overwrites the stored credentials in the pod&apos;s{" "}
        <code className="bg-[color:var(--bg-3)] px-1 py-0.5 text-[11px]">
          ~/.hermes/.env
        </code>{" "}
        and bounces the gateway.
      </Hint>
      {(connector.fields ?? []).map((f) => (
        <Field key={f.env} label={f.label} optional={f.optional} hint={f.hint}>
          <Input
            type={f.secret ? "password" : "text"}
            value={fields[f.env] ?? ""}
            onChange={(e) =>
              setFields((p) => ({ ...p, [f.env]: e.target.value }))
            }
            placeholder={f.secret ? "•••••••• (unchanged)" : f.placeholder}
            autoComplete="off"
            spellCheck={false}
          />
          {f.hint && <Hint>{f.hint}</Hint>}
        </Field>
      ))}
      {error && (
        <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-2.5 py-1.5 text-[12px] text-[color:var(--acc-red)]">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="primary" loading={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
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
      /* clipboard unavailable */
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

function StatusBadge({ status }: { status?: Status }) {
  if (!status) return <Badge tone="neutral">loading…</Badge>;
  if (status.running) {
    return (
      <Badge tone="green">
        <StatusDot tone="green" pulse /> running
      </Badge>
    );
  }
  return (
    <Badge tone="amber">
      <StatusDot tone="amber" /> configured · idle
    </Badge>
  );
}
