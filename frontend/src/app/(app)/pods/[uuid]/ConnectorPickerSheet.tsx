"use client";

// ConnectorPickerSheet — a two-stage Sheet for adding a new connector.
//
// Design borrows from Linear/Vercel/Slack integration directories: a
// logo-forward grid grouped into a few well-known categories, a search
// box, and an inline transition to a per-connector setup view in the same
// panel (no modal-in-modal). Already-connected connectors are still shown
// in the grid but dimmed with a "connected" pill — a deliberate
// discoverability choice (vs. hiding) so users see the full ecosystem.
//
// Setup-view dispatch by connector kind:
//   - token  → form with the connector's declared fields, POSTs to
//              /api/pods/<uuid>/connectors/<slug>.
//   - oauth + whatsapp → the embeddable WhatsAppPairingFlow (xterm + QR).
//   - oauth + other → console-handoff card.
//   - infra  → "needs ingress, coming soon" — no setup possible yet.
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Search,
  Terminal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { CONNECTORS, type Connector } from "@/lib/connectors";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PodsLoader } from "@/components/ui/pods-loader";
import { Field, Input, Hint } from "@/components/ui/input";
import { BrandIcon, connectorBrand } from "@/components/brand-icon";
import { cn } from "@/lib/cn";
import { POD_SETTLING_NOTICE } from "@/lib/pod-settling";
import { WhatsAppPairingFlow } from "./WhatsAppPairing";
import WebhookEventsLog from "./WebhookEventsLog";

type Status = { configured: boolean; running: boolean };

type Category = {
  id: string;
  label: string;
  hint?: string;
  slugs: string[];
};

// Hand-curated categories so the grid is scannable. Anything not in any
// category falls into "other" (currently empty — the catalog is fully
// classified). Webhook-based connectors get their own dimmed section.
const CATEGORIES: Category[] = [
  {
    id: "popular",
    label: "Popular",
    slugs: ["telegram", "discord", "slack", "whatsapp"],
  },
  {
    id: "messaging",
    label: "Messaging",
    slugs: ["signal", "matrix", "mattermost", "email", "bluebubbles"],
  },
  {
    id: "asia-enterprise",
    label: "Asia & Enterprise",
    slugs: [
      "google-chat",
      "dingtalk",
      "feishu",
      "wecom",
      "qq-bot",
      "yuanbao",
      "weixin",
    ],
  },
  {
    id: "productivity",
    label: "Productivity",
    slugs: ["home-assistant", "open-webui"],
  },
  {
    id: "webhook",
    label: "Webhook-based",
    hint: "Needs per-pod public ingress — tracked in RUNBOOK.md",
    slugs: CONNECTORS.filter((c) => c.kind === "infra").map((c) => c.slug),
  },
];

const SLUG_TO_CONNECTOR: Record<string, Connector> = Object.fromEntries(
  CONNECTORS.map((c) => [c.slug, c]),
);

export default function ConnectorPickerSheet({
  open,
  onOpenChange,
  identifier,
  statuses,
  domainHost,
  onConnected,
  onSwitchToConsole,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  identifier: string;
  statuses: Record<string, Status>;
  domainHost?: string | null;
  onConnected: () => void;
  onSwitchToConsole: () => void;
}) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<"pick" | "setup">("pick");
  const [picked, setPicked] = useState<Connector | null>(null);

  // Reset when the sheet closes so re-opening starts clean.
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStage("pick");
        setPicked(null);
        setSearch("");
      }, 200); // wait for slide-out anim
      return () => clearTimeout(t);
    }
  }, [open]);

  const filteredByCategory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CATEGORIES.map((cat) => {
      const connectors = cat.slugs
        .map((s) => SLUG_TO_CONNECTOR[s])
        .filter(Boolean)
        .filter((c) => {
          if (!q) return true;
          return (
            c.slug.includes(q) ||
            c.label.toLowerCase().includes(q) ||
            c.blurb.toLowerCase().includes(q)
          );
        });
      return { ...cat, connectors };
    }).filter((c) => c.connectors.length > 0);
  }, [search]);

  const handlePick = (c: Connector) => {
    // Already-configured WhatsApp must NOT enter the pairing flow — the
    // wizard sees the existing session, exits immediately as "already
    // paired", our poll detects paired:true, fires onPairingComplete,
    // closes the sheet. To the user this looks like the picker opens
    // and instantly closes again. Short-circuit: bounce them to the
    // main connectors list where the full WhatsAppConnector card lives.
    if (c.slug === "whatsapp" && statuses[c.slug]?.configured) {
      toast.info(
        "WhatsApp is already paired — manage from the Connected list below.",
      );
      onOpenChange(false);
      return;
    }
    setPicked(c);
    setStage("setup");
  };

  const handleSuccess = () => {
    onConnected();
    onOpenChange(false);
  };

  const handleBack = () => {
    setStage("pick");
    setPicked(null);
  };

  // Show the back button in the header by overriding the default Sheet
  // title with a custom node containing it.
  const titleNode =
    stage === "setup" && picked ? (
      <button
        onClick={handleBack}
        className="inline-flex items-center gap-2 py-1 text-[14px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-[18px] font-semibold tracking-tight text-[color:var(--text-primary)]">
          {picked.label}
        </span>
      </button>
    ) : (
      <span>Add connector</span>
    );

  const description =
    stage === "setup" && picked
      ? picked.blurb
      : "Wire Hermes up to a messaging platform — token or QR pairing, no terminal needed.";

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={titleNode}
      description={description}
      width={640}
    >
      {stage === "pick" ? (
        <PickerView
          search={search}
          onSearch={setSearch}
          categories={filteredByCategory}
          statuses={statuses}
          onPick={handlePick}
        />
      ) : picked ? (
        <SetupView
          connector={picked}
          identifier={identifier}
          status={statuses[picked.slug]}
          domainHost={domainHost}
          onSuccess={handleSuccess}
          onSwitchToConsole={() => {
            onOpenChange(false);
            onSwitchToConsole();
          }}
        />
      ) : null}
    </Sheet>
  );
}

// ------------------------------ picker grid -------------------------------

function PickerView({
  search,
  onSearch,
  categories,
  statuses,
  onPick,
}: {
  search: string;
  onSearch: (v: string) => void;
  categories: (Category & { connectors: Connector[] })[];
  statuses: Record<string, Status>;
  onPick: (c: Connector) => void;
}) {
  return (
    <div className="space-y-6 px-6 py-5">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-quaternary)]" />
        <Input
          autoFocus
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name (e.g. telegram, matrix)…"
          className="pl-8"
        />
        {search && (
          <button
            onClick={() => onSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[color:var(--text-quaternary)] hover:text-[color:var(--text-primary)]"
            aria-label="clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {categories.length === 0 ? (
        <div className="border border-dashed border-[color:var(--border)] p-6 text-center text-[12px] text-[color:var(--text-tertiary)]">
          Nothing matches that search.
        </div>
      ) : (
        categories.map((cat) => (
          <section key={cat.id} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
                {cat.label}
              </h3>
              {cat.hint && (
                <span className="text-[10px] text-[color:var(--text-quaternary)]">
                  {cat.hint}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {cat.connectors.map((c) => (
                <PickerTile
                  key={c.slug}
                  connector={c}
                  status={statuses[c.slug]}
                  onClick={() => onPick(c)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function PickerTile({
  connector,
  status,
  onClick,
}: {
  connector: Connector;
  status?: Status;
  onClick: () => void;
}) {
  const isConfigured = !!status?.configured;
  const isInfra = connector.kind === "infra";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-start gap-3 border p-3 text-left transition-colors",
        "border-[color:var(--border)] bg-[color:var(--bg-2)]",
        "hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-3)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--border-focus)]",
        isInfra && "opacity-60",
      )}
    >
      <div className="flex h-9 w-9 flex-none items-center justify-center border border-[color:var(--border)] bg-[color:var(--bg-3)]">
        <BrandIcon slug={connectorBrand(connector.slug)} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-[13px] font-semibold tracking-tight text-[color:var(--text-primary)]">
            {connector.label}
          </div>
          {isConfigured && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--acc-green)]/30 bg-[color:var(--acc-green-soft)] px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider text-[color:var(--acc-green)]">
              <Check className="h-2.5 w-2.5" /> connected
            </span>
          )}
          {isInfra && (
            <span className="inline-flex items-center rounded-full border border-[color:var(--border)] bg-[color:var(--bg-3)] px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider text-[color:var(--text-quaternary)]">
              webhook
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[color:var(--text-tertiary)]">
          {connector.blurb}
        </p>
      </div>
    </button>
  );
}

// -------------------------------- setup -----------------------------------

function SetupView({
  connector,
  identifier,
  status,
  domainHost,
  onSuccess,
  onSwitchToConsole,
}: {
  connector: Connector;
  identifier: string;
  status?: Status;
  domainHost?: string | null;
  onSuccess: () => void;
  onSwitchToConsole: () => void;
}) {
  if (connector.kind === "infra") {
    return <InfraSetup connector={connector} onAcknowledge={onSuccess} />;
  }
  if (connector.slug === "whatsapp") {
    return (
      <WhatsAppSetup identifier={identifier} onSuccess={onSuccess} />
    );
  }
  if (connector.kind === "oauth") {
    return (
      <OAuthHandoffSetup
        connector={connector}
        onSwitchToConsole={onSwitchToConsole}
      />
    );
  }
  return (
    <TokenSetup
      connector={connector}
      identifier={identifier}
      isReconfigure={!!status?.configured}
      domainHost={domainHost}
      onSuccess={onSuccess}
    />
  );
}

function TokenSetup({
  connector,
  identifier,
  isReconfigure,
  domainHost,
  onSuccess,
}: {
  connector: Connector;
  identifier: string;
  isReconfigure: boolean;
  domainHost?: string | null;
  onSuccess: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const webhookUrl =
    connector.webhookPath && domainHost
      ? `https://${domainHost}${connector.webhookPath}`
      : null;
  const required = (connector.fields ?? []).filter((f) => !f.optional);
  const missing = required.filter((f) => !(fields[f.env]?.trim()));
  const canSubmit = missing.length === 0 && !busy;

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
      toast.success(`${connector.label} connected — gateway restarting`, {
        description: POD_SETTLING_NOTICE,
        duration: 8000,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className="flex-1 space-y-4 px-6 py-5">
        {busy && (
          <div className="border border-[color:var(--border)] bg-[color:var(--bg-1)] px-4 py-5">
            <PodsLoader
              size="sm"
              label={`Connecting ${connector.label}...`}
              className="mx-auto"
            />
          </div>
        )}
        {webhookUrl && <PickerWebhookBlock url={webhookUrl} />}
        {connector.webhookPath && (
          <WebhookEventsLog
            identifier={identifier}
            pathPrefix={connector.webhookPath}
          />
        )}
        {isReconfigure && (
          <div className="border border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)]/40 px-3 py-2 text-[12px] text-[color:var(--text-secondary)]">
            This connector is already connected. Saving will overwrite the
            stored credentials.
          </div>
        )}
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
              autoComplete="off"
              spellCheck={false}
            />
            {f.hint && <Hint>{f.hint}</Hint>}
          </Field>
        ))}
        {error && (
          <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-3 py-2 text-[12px] text-[color:var(--acc-red)]">
            {error}
          </div>
        )}
        {connector.docs && (
          <a
            href={connector.docs}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
          >
            View {connector.label} docs <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <footer className="border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] px-6 py-4">
        <div className="flex items-center justify-end gap-2">
          <Button type="submit" variant="primary" disabled={!canSubmit} loading={busy}>
            {busy ? "Connecting…" : isReconfigure ? "Save changes" : `Connect ${connector.label}`}
          </Button>
        </div>
      </footer>
    </form>
  );
}

function OAuthHandoffSetup({
  connector,
  onSwitchToConsole,
}: {
  connector: Connector;
  onSwitchToConsole: () => void;
}) {
  return (
    <div className="space-y-5 px-6 py-5">
      <div className="border border-[color:var(--acc-purple)]/30 bg-[color:var(--acc-purple-soft)]/30 p-3 text-[12px] leading-relaxed text-[color:var(--text-secondary)]">
        <strong className="text-[color:var(--acc-purple)]">
          Needs the pod terminal:
        </strong>{" "}
        {connector.label} uses a QR-scan / OAuth flow that runs interactively
        inside the pod. Open the Console tab, then run the command shown
        below.
      </div>
      <pre className="overflow-x-auto border border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] p-3 text-[12px] text-[color:var(--text-primary)]">
        $ hermes {connector.slug.split("-")[0]}
      </pre>
      <p className="text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
        {connector.setupHint}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={onSwitchToConsole}>
          <Terminal className="h-3.5 w-3.5" /> Open console
        </Button>
        {connector.docs && (
          <a
            href={connector.docs}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
          >
            docs <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function InfraSetup({
  connector,
  onAcknowledge,
}: {
  connector: Connector;
  onAcknowledge: () => void;
}) {
  return (
    <div className="space-y-5 px-6 py-5">
      <div className="border border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)]/40 p-3 text-[12px] leading-relaxed text-[color:var(--text-secondary)]">
        <strong className="text-[color:var(--acc-amber)]">Not ready yet:</strong>{" "}
        {connector.label} expects an inbound HTTPS endpoint, but FuelBorn
        doesn&apos;t expose per-pod public URLs yet. Tracked as the
        per-pod-ingress work-stream.
      </div>
      <p className="text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
        {connector.setupHint ??
          "This connector requires Caddy + DNS plumbing that hasn't shipped yet."}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onAcknowledge}>
          Got it
        </Button>
      </div>
    </div>
  );
}

// ----------------------------- whatsapp pair ------------------------------

function WhatsAppSetup({
  identifier,
  onSuccess,
}: {
  identifier: string;
  onSuccess: () => void;
}) {
  // Local mode that's POSTed to .env right before pairing starts, so the
  // wizard's --mode flag matches what the user picked in this sheet.
  const [mode, setMode] = useState<"bot" | "self-chat">("bot");

  function setModeOnly(m: "bot" | "self-chat") {
    setMode(m);
  }

  async function persistMode(m: "bot" | "self-chat"): Promise<boolean> {
    try {
      const r = await fetch(`/api/pods/${identifier}/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: m }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: true;
        error?: string;
      };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `WhatsApp setup failed: HTTP ${r.status}`);
        return false;
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  return (
    <div className="space-y-4 px-6 py-5">
      <div className="border border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)]/40 p-3 text-[12px] leading-relaxed text-[color:var(--text-secondary)]">
        <strong className="text-[color:var(--acc-amber)]">
          Unofficial API · ban risk:
        </strong>{" "}
        WhatsApp doesn&apos;t officially support third-party bots. Use a
        dedicated phone number for bot mode and avoid bulk outbound messages.
      </div>
      <WhatsAppPairingFlow
        embedded
        identifier={identifier}
        mode={mode}
        onModeChange={setModeOnly}
        onBeforeStart={persistMode}
        onPaired={async () => {
          const r = await fetch(`/api/pods/${identifier}/whatsapp`, {
            cache: "no-store",
          });
          if (!r.ok) return null;
          return (await r.json()) as { paired: boolean };
        }}
        onPairingComplete={async (chosen) => {
          const r = await fetch(`/api/pods/${identifier}/whatsapp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true, mode: chosen }),
          });
          const d = (await r.json().catch(() => ({}))) as {
            ok?: true;
            error?: string;
          };
          if (!r.ok || !d.ok) {
            toast.error(d.error ?? `WhatsApp setup failed: HTTP ${r.status}`);
            return;
          }
          toast.message(POD_SETTLING_NOTICE, { duration: 8000 });
          setTimeout(onSuccess, 600);
        }}
      />
    </div>
  );
}

function PickerWebhookBlock({ url }: { url: string }) {
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
    <div className="border border-[color:var(--acc-blue)]/30 bg-[color:var(--acc-blue-soft)]/30 px-3 py-2.5">
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
