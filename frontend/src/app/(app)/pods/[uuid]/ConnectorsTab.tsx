"use client";

// ConnectorsTab — top-level layout for the pod page's Connectors tab.
//
// Default view is a "Connected" list: only platforms that actually have
// credentials present in the pod's .env / paired session show up here.
// Everything else is hidden behind the Add-connector button which opens
// the picker sheet (see ConnectorPickerSheet). This is the
// installed-only-by-default integrations pattern used by Linear/Vercel/
// Slack — it keeps the page from being a 30-platform wall on first
// landing, while still being one click away from discovery.
//
// WhatsApp gets a dedicated full-width card (rich state model: paired,
// mode, allowed users, prefix, debug). Every other connected platform
// uses the compact ConfiguredConnectorCard.
import { useEffect, useState } from "react";
import { Plug, Plus, Wand2 } from "lucide-react";
import { CONNECTORS, CONNECTOR_BY_SLUG } from "@/lib/connectors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import ConfiguredConnectorCard from "./ConfiguredConnectorCard";
import WhatsAppConnector from "./WhatsAppConnector";
import ConnectorPickerSheet from "./ConnectorPickerSheet";

type Status = { id: string; configured: boolean; running: boolean };

export default function ConnectorsTab({
  identifier,
  installed,
  onSwitchToConsole,
  onConfiguredCountChange,
}: {
  identifier: string;
  installed: boolean;
  onSwitchToConsole: () => void;
  // Lets the parent surface "N connected" in the tab strip badge.
  onConfiguredCountChange?: (count: number) => void;
}) {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [domainHost, setDomainHost] = useState<string | null>(null);

  // Pull the pod's auto-domain once — every webhook card needs this to
  // render the public URL the user pastes into the platform's dashboard.
  // The auto-domain is created on deploy and stable for the pod's life.
  useEffect(() => {
    if (!installed) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/pods/${identifier}/domains`, {
          cache: "no-store",
        });
        const d = (await r.json()) as {
          domain_root?: string;
          domains?: Array<{ slug: string; kind: string }>;
        };
        if (cancelled) return;
        const auto = d.domains?.find((x) => x.kind === "auto") ?? d.domains?.[0];
        if (auto && d.domain_root) {
          setDomainHost(`${auto.slug}.${d.domain_root}`);
        }
      } catch {
        /* domain might not be ready yet — webhook block just won't render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identifier, installed]);

  async function refresh() {
    try {
      const r = await fetch(`/api/pods/${identifier}/connectors`, {
        cache: "no-store",
      });
      const d = (await r.json()) as { connectors?: Status[] };
      const next: Record<string, Status> = {};
      for (const c of d.connectors ?? []) next[c.id] = c;
      setStatuses(next);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (!installed) return;
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier, installed]);

  const configuredSlugs = CONNECTORS.filter(
    (c) => statuses[c.slug]?.configured,
  ).map((c) => c.slug);
  const whatsappPaired = !!statuses["whatsapp"]?.configured;
  // Everything except WhatsApp (which has its own card).
  const otherConfigured = configuredSlugs.filter((s) => s !== "whatsapp");

  // Tell the parent how many are connected (for the tab-strip badge).
  useEffect(() => {
    if (onConfiguredCountChange) onConfiguredCountChange(configuredSlugs.length);
  }, [configuredSlugs.length, onConfiguredCountChange]);

  if (!installed) {
    return (
      <p className="text-[12px] text-neutral-400">
        Connectors unlock once the pod finishes installing.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-neutral-400">
          Wire your agent up to a messaging platform. Connected platforms appear
          here; click <em>Add connector</em> to browse the rest.
        </p>
        <Button
          variant="primary"
          size="md"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" /> Add connector
        </Button>
      </div>

      {/* Empty state */}
      {loaded && configuredSlugs.length === 0 ? (
        <EmptyState onAdd={() => setPickerOpen(true)} />
      ) : null}

      {/* WhatsApp paired → full-width card */}
      {whatsappPaired && (
        <section className="space-y-2">
          <SectionHeader label="WhatsApp" />
          <WhatsAppConnector
            identifier={identifier}
            connector={CONNECTOR_BY_SLUG["whatsapp"]}
            status={statuses["whatsapp"]}
            disabled={!installed}
            onChange={refresh}
          />
        </section>
      )}

      {/* Everything else, in a 2-col grid */}
      {otherConfigured.length > 0 && (
        <section className="space-y-2">
          <SectionHeader label="Connected" count={otherConfigured.length} />
          <div className="grid gap-3 md:grid-cols-2">
            {otherConfigured.map((slug) => {
              const c = CONNECTOR_BY_SLUG[slug];
              if (!c) return null;
              return (
                <ConfiguredConnectorCard
                  key={slug}
                  identifier={identifier}
                  connector={c}
                  status={statuses[slug]}
                  domainHost={domainHost}
                  onChange={refresh}
                />
              );
            })}
          </div>
        </section>
      )}

      <ConnectorPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        identifier={identifier}
        statuses={statuses}
        domainHost={domainHost}
        onConnected={refresh}
        onSwitchToConsole={onSwitchToConsole}
      />
    </div>
  );
}

function SectionHeader({
  label,
  count,
}: {
  label: string;
  count?: number;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </h3>
      {typeof count === "number" && (
        <span className="rounded-full border border-hairline bg-neutral-900 px-1.5 text-[10px] text-neutral-300">
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-neutral-900">
          <Plug className="h-5 w-5 text-neutral-400" />
        </div>
        <div className="max-w-md space-y-1">
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
            No connectors wired up yet
          </h3>
          <p className="text-[12px] leading-relaxed text-neutral-400">
            Hook your agent up to Telegram, WhatsApp, Slack, Discord, and more.
            Picking one walks you through the whole setup — credentials,
            pairing, restart — without touching the pod terminal.
          </p>
        </div>
        <Button variant="primary" onClick={onAdd}>
          <Wand2 className="h-3.5 w-3.5" /> Browse connectors
        </Button>
      </div>
    </Card>
  );
}
