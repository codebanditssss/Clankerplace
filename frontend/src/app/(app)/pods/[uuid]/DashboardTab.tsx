"use client";

// DashboardTab — first-load landing for a pod page.
//
// One panel that pulls together every observable signal the pod exposes:
// runtime state, resource graphs, gateway + bridge + platform health, the
// configured providers/fallbacks/auxiliary, connector pairings, file
// counts (sessions, skills, cron, memories), and a live tail of Hermes's
// own logs. Lifted in from the old "Stats" tab, expanded outward.
//
// Layout grammar: dense KPI strip at the top → resource section (Pod
// Metrics, condensed) → two columns of stat cards (Gateway / Providers /
// Connectors / Storage) → log tails as a bottom panel. Everything driven
// from one /dashboard aggregator endpoint that refreshes every 6 s, plus
// the existing live-metrics WS underneath PodMetrics.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Brain,
  CircleAlert,
  Clock,
  Cpu,
  Database,
  FileText,
  HardDrive,
  Layers,
  MemoryStick,
  Plug,
  Power,
  Sparkles,
  Terminal as TerminalIcon,
  Volume2,
  Workflow,
  Zap,
} from "lucide-react";
import PodMetrics from "./PodMetrics";
import ConnectInfoCard from "./ConnectInfoCard";
import { Card } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { PodsLoader } from "@/components/ui/pods-loader";
import { cn } from "@/lib/cn";

type Platform = {
  state?: string;
  error_code?: string | null;
  error_message?: string | null;
  updated_at?: string;
};

type DashboardData = {
  installing?: boolean;
  pod: {
    name: string;
    identifier: string;
    uuid: string;
    image: string;
    memory_mb: number;
    cpu_pct: number;
    disk_mb: number;
    suspended: boolean;
  };
  gateway: {
    running: boolean;
    bridge_running: boolean;
    state: string | null;
    pid: number | null;
    active_agents: number;
    platforms: Record<string, Platform>;
    exit_reason: string | null;
  };
  channels: Record<string, Array<{ id: string; name: string }>>;
  counts: {
    sessions?: number;
    skills?: number;
    cron?: number;
    memories?: number;
  };
  providers: {
    provider: string;
    model: string;
    fallback_count: number;
    aux_overrides: number;
    memory_provider: string;
    tts_provider: string;
    web_provider: string;
    image_provider: string;
    keys_set: number;
  };
  logs: { gateway: string; agent: string; errors: string };
};

export default function DashboardTab({
  identifier,
  installed,
  podTypeSlug,
}: {
  identifier: string;
  installed: boolean;
  podTypeSlug?: string;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logsTab, setLogsTab] = useState<"gateway" | "agent" | "errors">(
    "gateway",
  );

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/pods/${identifier}/dashboard`, {
        cache: "no-store",
      });
      const d = (await r.json()) as DashboardData & { error?: string };
      if (!r.ok) {
        setErr(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setErr(null);
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [identifier]);

  useEffect(() => {
    if (!installed) return;
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [installed, refresh]);

  if (!installed) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-6 text-center">
        <p className="text-[12px] text-neutral-400">
          Dashboard unlocks when the pod finishes installing.
        </p>
        <PodsLoader size="lg" />
      </div>
    );
  }

  if (err && !data) {
    return (
      <div className="border border-error/30 bg-error/5 px-3 py-2 text-[12px] text-error">
        {err}
      </div>
    );
  }

  if (!data) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-5">
      {podTypeSlug && (
        <ConnectInfoCard identifier={identifier} podTypeSlug={podTypeSlug} />
      )}

      <KpiStrip data={data} />

      <Card className="p-4">
        <SectionHeader
          icon={<Activity className="h-3.5 w-3.5" />}
          title="Resources"
          hint="5-sec sampling, 24-hour retention"
        />
        <PodMetrics identifier={identifier} />
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <GatewayCard data={data} />
        <ProvidersCard data={data} />
        <StorageCard data={data} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ConnectorsCard data={data} />
        <PlatformsCard data={data} />
      </div>

      <LogsCard data={data} activeTab={logsTab} onChangeTab={setLogsTab} />
    </div>
  );
}

// ============================ pieces ===================================

function KpiStrip({ data }: { data: DashboardData }) {
  const podStatus = data.gateway.running ? "green" : "amber";
  const platformOk = Object.values(data.gateway.platforms).every(
    (p) => p.state === "connected",
  );
  const platformCount = Object.keys(data.gateway.platforms).length;

  return (
    <div className="grid gap-px border border-hairline bg-hairline md:grid-cols-2 lg:grid-cols-4">
      <Kpi
        index={1}
        icon={<Power className="h-3.5 w-3.5" />}
        label="Pod"
        value={data.gateway.running ? "Running" : "Idle"}
        active={data.gateway.running}
        sub={
          <span className="flex items-center gap-1.5">
            <StatusDot tone={podStatus} pulse={data.gateway.running} />
            <span className="font-mono text-[10px]">
              {data.pod.identifier}
            </span>
          </span>
        }
      />
      <Kpi
        index={2}
        icon={<Sparkles className="h-3.5 w-3.5" />}
        label="Active platforms"
        value={`${platformCount}`}
        sub={
          platformCount === 0 ? (
            <span className="text-[10px]">none paired</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <StatusDot tone={platformOk ? "green" : "amber"} />
              <span className="text-[10px]">
                {platformOk ? "all connected" : "issues"}
              </span>
            </span>
          )
        }
      />
      <Kpi
        index={3}
        icon={<Brain className="h-3.5 w-3.5" />}
        label="Inference"
        value={data.providers.provider || "—"}
        sub={
          <span className="truncate font-mono text-[10px]">
            {data.providers.model || "—"}
          </span>
        }
      />
      <Kpi
        index={4}
        icon={<Clock className="h-3.5 w-3.5" />}
        label="Sessions"
        value={`${data.counts.sessions ?? 0}`}
        sub={
          <span className="text-[10px]">
            {data.counts.skills ?? 0} skills · {data.counts.cron ?? 0} cron
          </span>
        }
      />
    </div>
  );
}

function GatewayCard({ data }: { data: DashboardData }) {
  const g = data.gateway;
  return (
    <Card className="p-4">
      <SectionHeader icon={<Zap className="h-3.5 w-3.5" />} title="Gateway" />
      <div className="mt-2 space-y-2 text-[12px]">
        <Row
          label="Gateway"
          value={
            <Badge tone={g.running ? "green" : "neutral"}>
              <StatusDot tone={g.running ? "green" : "neutral"} pulse={g.running} />
              {g.state ?? (g.running ? "running" : "stopped")}
            </Badge>
          }
        />
        <Row
          label="Bridge"
          value={
            <Badge tone={g.bridge_running ? "green" : "neutral"}>
              <StatusDot tone={g.bridge_running ? "green" : "neutral"} pulse={g.bridge_running} />
              {g.bridge_running ? "running" : "not running"}
            </Badge>
          }
        />
        <Row label="Active agents" value={<Mono>{g.active_agents}</Mono>} />
        <Row label="PID" value={<Mono>{g.pid ?? "—"}</Mono>} />
        {g.exit_reason && (
          <Row
            label="Last exit"
            value={
              <span className="text-warning">
                {g.exit_reason}
              </span>
            }
          />
        )}
      </div>
    </Card>
  );
}

function ProvidersCard({ data }: { data: DashboardData }) {
  const p = data.providers;
  return (
    <Card className="p-4">
      <SectionHeader icon={<Layers className="h-3.5 w-3.5" />} title="Providers" />
      <div className="mt-2 space-y-2 text-[12px]">
        <Row
          label="Main"
          value={
            <span className="truncate">
              <span className="font-mono">{p.provider}</span>
              <span className="ml-1 text-neutral-400">·</span>
              <span className="ml-1 font-mono text-neutral-400">
                {p.model}
              </span>
            </span>
          }
        />
        <Row label="Fallback chain" value={<Mono>{p.fallback_count}</Mono>} />
        <Row label="Auxiliary overrides" value={<Mono>{p.aux_overrides}</Mono>} />
        <Row
          label="Voice TTS"
          value={
            <span className="font-mono text-neutral-300">
              {p.tts_provider || "edge (default)"}
            </span>
          }
        />
        <Row
          label="Web search"
          value={
            <span className="font-mono text-neutral-300">
              {p.web_provider || "firecrawl (default)"}
            </span>
          }
        />
        <Row
          label="Image gen"
          value={
            <span className="font-mono text-neutral-300">
              {p.image_provider || "fal (default)"}
            </span>
          }
        />
        <Row
          label="Memory plugin"
          value={
            <span className="font-mono text-neutral-300">
              {p.memory_provider || "built-in only"}
            </span>
          }
        />
        <Row label="API keys set" value={<Mono>{p.keys_set}</Mono>} />
      </div>
    </Card>
  );
}

function StorageCard({ data }: { data: DashboardData }) {
  const c = data.counts;
  return (
    <Card className="p-4">
      <SectionHeader icon={<Database className="h-3.5 w-3.5" />} title="Storage" />
      <div className="mt-2 space-y-2 text-[12px]">
        <Row
          label="Memory limit"
          value={<Mono>{data.pod.memory_mb} MB</Mono>}
        />
        <Row
          label="Disk limit"
          value={<Mono>{(data.pod.disk_mb / 1024).toFixed(1)} GB</Mono>}
        />
        <Row label="CPU limit" value={<Mono>{data.pod.cpu_pct}%</Mono>} />
        <Row label="Sessions saved" value={<Mono>{c.sessions ?? 0}</Mono>} />
        <Row label="Skills installed" value={<Mono>{c.skills ?? 0}</Mono>} />
        <Row label="Cron jobs" value={<Mono>{c.cron ?? 0}</Mono>} />
        <Row label="Memory entries" value={<Mono>{c.memories ?? 0}</Mono>} />
        <Row
          label="Image"
          value={
            <span className="truncate font-mono text-[10px] text-neutral-400">
              {data.pod.image}
            </span>
          }
        />
      </div>
    </Card>
  );
}

function PlatformsCard({ data }: { data: DashboardData }) {
  const platforms = Object.entries(data.gateway.platforms);
  return (
    <Card className="p-4">
      <SectionHeader
        icon={<Bot className="h-3.5 w-3.5" />}
        title="Active platforms"
        hint={`${platforms.length} live`}
      />
      {platforms.length === 0 ? (
        <p className="mt-3 text-[12px] text-neutral-400">
          No messaging platforms connected yet. Pair one from the Connectors
          tab.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-[12px]">
          {platforms.map(([name, p]) => {
            const tone =
              p.state === "connected"
                ? "green"
                : p.state === "connecting"
                  ? "amber"
                  : p.error_message
                    ? "red"
                    : "neutral";
            return (
              <li
                key={name}
                className="flex items-center justify-between gap-2 border border-hairline bg-neutral-950 px-3 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <StatusDot tone={tone} pulse={p.state === "connected"} />
                  <span className="font-mono">{name}</span>
                </div>
                <span className="truncate text-[11px] text-neutral-400">
                  {p.state ?? "unknown"}
                  {p.error_message ? ` — ${p.error_message}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ConnectorsCard({ data }: { data: DashboardData }) {
  const entries = Object.entries(data.channels).filter(
    ([, list]) => Array.isArray(list) && list.length > 0,
  );
  return (
    <Card className="p-4">
      <SectionHeader
        icon={<Plug className="h-3.5 w-3.5" />}
        title="Paired contacts"
        hint={`${entries.reduce((a, [, l]) => a + l.length, 0)} total`}
      />
      {entries.length === 0 ? (
        <p className="mt-3 text-[12px] text-neutral-400">
          No platform paired with a contact yet — Hermes builds this list
          as DMs come in.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-[12px]">
          {entries.map(([platform, list]) => (
            <li
              key={platform}
              className="border border-hairline bg-neutral-950 px-3 py-2"
            >
              <div className="text-[11px] uppercase tracking-wider text-neutral-400">
                {platform}
              </div>
              <ul className="mt-1 space-y-0.5">
                {list.slice(0, 5).map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="truncate font-mono text-[10px] text-neutral-500">
                      {c.id.length > 24 ? c.id.slice(0, 24) + "…" : c.id}
                    </span>
                  </li>
                ))}
                {list.length > 5 && (
                  <li className="text-[10px] text-neutral-500">
                    + {list.length - 5} more
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LogsCard({
  data,
  activeTab,
  onChangeTab,
}: {
  data: DashboardData;
  activeTab: "gateway" | "agent" | "errors";
  onChangeTab: (t: "gateway" | "agent" | "errors") => void;
}) {
  const content = useMemo(() => {
    const raw = data.logs[activeTab] ?? "";
    if (!raw.trim()) return "(no log lines yet)";
    return raw;
  }, [data, activeTab]);

  const lineCount = content === "(no log lines yet)" ? 0 : content.split("\n").length;
  const errBadgeCount = data.logs.errors.trim()
    ? data.logs.errors.trim().split("\n").length
    : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-neutral-500" />
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">
            Logs
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
            tail · {lineCount} lines
          </span>
        </div>
        <div className="inline-flex border border-hairline bg-neutral-900 p-0.5">
          {(
            [
              { id: "gateway" as const, label: "gateway" },
              { id: "agent" as const, label: "agent" },
              { id: "errors" as const, label: "errors", badge: errBadgeCount },
            ]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => onChangeTab(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                activeTab === t.id
                  ? "bg-neutral-950 text-foreground"
                  : "text-neutral-500 hover:text-foreground",
              )}
            >
              {t.label}
              {"badge" in t && t.badge !== undefined && t.badge > 0 && (
                <span className="border border-error/40 bg-error/10 px-1 text-[9px] text-error">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <pre className="m-0 max-h-[300px] overflow-auto bg-black px-4 py-3 font-mono text-[11px] leading-relaxed text-neutral-300">
        {content}
      </pre>
    </Card>
  );
}

// ============================ helpers ==================================

function SectionHeader({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
        <span className="text-foreground">{icon}</span>
        {title}
      </h3>
      {hint && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
          {hint}
        </span>
      )}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-neutral-400">{label}</span>
      <span className="min-w-0 max-w-[60%] truncate text-right text-foreground">
        {value}
      </span>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono tabular text-foreground">
      {children}
    </span>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  index,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
  index: number;
  active?: boolean;
}) {
  return (
    <div className="relative overflow-hidden bg-neutral-950 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
          <span className={active ? "text-signal" : "text-neutral-500"}>
            {icon}
          </span>
          {label}
        </div>
        <span className="font-mono text-[10px] tabular text-neutral-600">
          {index.toString().padStart(2, "0")}
        </span>
      </div>
      <div className="mt-2 truncate font-display text-[26px] leading-none tracking-tight text-foreground">
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 text-neutral-400">{sub}</div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="h-[88px] animate-pulse bg-neutral-900" />
        ))}
      </div>
      <Card className="h-[320px] animate-pulse bg-neutral-900" />
      <div className="grid gap-3 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="h-[200px] animate-pulse bg-neutral-900" />
        ))}
      </div>
    </div>
  );
}
