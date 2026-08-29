"use client";

// Processes tab — live in-pod process table with per-process resource
// usage and signal controls (suspend / resume / kill / force-kill).
//
// Polls GET /api/pods/<id>/processes every few seconds; actions POST a
// signal to a single pid. The header shows the container's pid-cgroup
// usage against its limit (the thing that, when exhausted, throws
// "can't start new thread").

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  ArrowDownWideNarrow,
  Ban,
  Pause,
  Play,
  RefreshCw,
  Search,
  Skull,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type PodProcess = {
  pid: number;
  ppid: number;
  state: string;
  cpu: number;
  mem: number;
  rssKb: number;
  etimes: number;
  command: string;
};

type ProcessesResponse = {
  processes: PodProcess[];
  pids: { current: number; max: number | null };
  sampledAt: number;
};

type SortKey = "cpu" | "mem" | "rssKb" | "pid";

const POLL_MS = 4000;

export default function ProcessesTab({
  identifier,
  installed,
}: {
  identifier: string;
  installed: boolean;
}) {
  const [data, setData] = useState<ProcessesResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("cpu");
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/pods/${identifier}/processes`, {
        cache: "no-store",
      });
      const d = (await r.json()) as ProcessesResponse & { error?: string };
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
      } else {
        setData(d);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, [identifier]);

  useEffect(() => {
    if (!installed) return;
    refresh();
    if (paused) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [identifier, installed, refresh, paused]);

  async function signal(pid: number, sig: string, label: string) {
    setBusyPid(pid);
    try {
      const r = await fetch(`/api/pods/${identifier}/processes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, signal: sig }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) toast.error(d.error ?? "failed");
      else {
        toast.success(`${label} sent to pid ${pid}`);
        // optimistic-ish: refresh shortly after so the table reflects it
        setTimeout(refresh, 400);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyPid(null);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? data.processes.filter(
          (p) =>
            p.command.toLowerCase().includes(q) || String(p.pid).includes(q),
        )
      : data.processes;
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "pid") return a.pid - b.pid;
      return (b[sort] as number) - (a[sort] as number);
    });
    return sorted;
  }, [data, search, sort]);

  if (!installed) {
    return (
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        Process management unlocks once the pod finishes installing.
      </p>
    );
  }

  const pids = data?.pids;
  const pct =
    pids && pids.max ? Math.min(100, (pids.current / pids.max) * 100) : null;
  const pctTone =
    pct === null
      ? "var(--acc-blue)"
      : pct > 85
        ? "var(--acc-red)"
        : pct > 65
          ? "var(--acc-amber)"
          : "var(--acc-green)";

  return (
    <div className="space-y-5">
      {/* header: pid usage + intro */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
          Every process running inside your pod, with live CPU, memory and
          uptime. Suspend, resume, or kill any of them. Pid&nbsp;1 is the
          container init — manage that from the pod{" "}
          <strong className="text-[color:var(--text-secondary)]">Actions</strong>{" "}
          menu, not here.
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={paused ? "secondary" : "ghost"}
            onClick={() => setPaused((p) => !p)}
            title={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
          >
            {paused ? (
              <Play className="h-3 w-3" />
            ) : (
              <Pause className="h-3 w-3" />
            )}
            {paused ? "Paused" : "Live"}
          </Button>
          <Button size="sm" variant="ghost" onClick={refresh} title="Refresh now">
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            <Activity className="h-3.5 w-3.5" /> Process limit
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-[20px] tabular text-[color:var(--text-primary)]">
              {pids?.current ?? "—"}
            </span>
            <span className="font-mono text-[12px] text-[color:var(--text-quaternary)]">
              / {pids?.max ?? "∞"}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden bg-[color:var(--bg-4)]">
            <div
              className="h-full transition-all"
              style={{
                width: pct === null ? "0%" : `${pct}%`,
                background: pctTone,
              }}
            />
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            Processes shown
          </div>
          <div className="mt-2 font-mono text-[20px] tabular text-[color:var(--text-primary)]">
            {data ? rows.length : "—"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            Total CPU / MEM
          </div>
          <div className="mt-2 font-mono text-[14px] tabular text-[color:var(--text-primary)]">
            {data
              ? `${data.processes
                  .reduce((s, p) => s + p.cpu, 0)
                  .toFixed(1)}% · ${data.processes
                  .reduce((s, p) => s + p.mem, 0)
                  .toFixed(1)}%`
              : "—"}
          </div>
        </Card>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-quaternary)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by command or pid…"
            className="h-8 w-72 border border-[color:var(--border)] bg-[color:var(--bg-1)] pl-7 pr-3 text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-tertiary)]">
          <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          <span>Sort</span>
          {(["cpu", "mem", "rssKb", "pid"] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={cn(
                "border px-2 py-0.5 font-mono text-[11px] transition-colors",
                sort === k
                  ? "border-[color:var(--border-strong)] bg-[color:var(--bg-3)] text-[color:var(--text-primary)]"
                  : "border-[color:var(--border)] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]",
              )}
            >
              {k === "rssKb" ? "rss" : k}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-3 py-2 text-[12px] text-[color:var(--acc-red)]">
          {error}
        </div>
      )}

      {/* table */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[64px_56px_64px_64px_88px_72px_1fr_auto] items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] px-3 py-2 text-[10px] uppercase tracking-wider text-[color:var(--text-quaternary)]">
          <span>PID</span>
          <span>State</span>
          <span className="text-right">CPU%</span>
          <span className="text-right">MEM%</span>
          <span className="text-right">RSS</span>
          <span className="text-right">Uptime</span>
          <span>Command</span>
          <span className="text-right pr-1">Actions</span>
        </div>

        <div className="max-h-[560px] divide-y divide-[color:var(--border-subtle)] overflow-y-auto">
          {!loaded && (
            <div className="px-3 py-8 text-center text-[12px] text-[color:var(--text-quaternary)]">
              Loading processes…
            </div>
          )}
          {loaded && rows.length === 0 && (
            <div className="px-3 py-8 text-center text-[12px] text-[color:var(--text-quaternary)]">
              {data ? "No matching processes." : "Couldn't read processes."}
            </div>
          )}
          {rows.map((p) => (
            <ProcessRow
              key={p.pid}
              p={p}
              busy={busyPid === p.pid}
              onSignal={signal}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

const STATE_META: Record<
  string,
  { label: string; tone: string }
> = {
  R: { label: "running", tone: "var(--acc-green)" },
  S: { label: "sleeping", tone: "var(--text-tertiary)" },
  D: { label: "io-wait", tone: "var(--acc-amber)" },
  T: { label: "stopped", tone: "var(--acc-amber)" },
  t: { label: "traced", tone: "var(--acc-amber)" },
  Z: { label: "zombie", tone: "var(--acc-red)" },
  I: { label: "idle", tone: "var(--text-quaternary)" },
  X: { label: "dead", tone: "var(--acc-red)" },
};

function fmtRss(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}G`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)}M`;
  return `${kb}K`;
}

function fmtUptime(s: number): string {
  if (s >= 86400) return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${s}s`;
}

function ProcessRow({
  p,
  busy,
  onSignal,
}: {
  p: PodProcess;
  busy: boolean;
  onSignal: (pid: number, sig: string, label: string) => void;
}) {
  const primary = p.state.charAt(0);
  const meta = STATE_META[primary] ?? {
    label: p.state,
    tone: "var(--text-tertiary)",
  };
  const stopped = primary === "T" || primary === "t";
  const isInit = p.pid === 1;

  function confirmKill(sig: "TERM" | "KILL") {
    const verb = sig === "KILL" ? "force-kill" : "kill";
    if (
      confirm(
        `${verb} pid ${p.pid}?\n\n${p.command.slice(0, 160)}${
          p.command.length > 160 ? "…" : ""
        }`,
      )
    )
      onSignal(p.pid, sig, verb === "force-kill" ? "SIGKILL" : "SIGTERM");
  }

  return (
    <div className="grid grid-cols-[64px_56px_64px_64px_88px_72px_1fr_auto] items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-[color:var(--bg-1)]">
      <span className="font-mono tabular text-[color:var(--text-secondary)]">
        {p.pid}
      </span>
      <span
        className="inline-flex items-center gap-1 font-mono text-[11px]"
        style={{ color: meta.tone }}
        title={`${p.state} — ${meta.label}`}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: meta.tone }}
        />
        {primary}
      </span>
      <span className="text-right font-mono tabular text-[color:var(--text-secondary)]">
        {p.cpu.toFixed(1)}
      </span>
      <span className="text-right font-mono tabular text-[color:var(--text-secondary)]">
        {p.mem.toFixed(1)}
      </span>
      <span className="text-right font-mono tabular text-[color:var(--text-tertiary)]">
        {fmtRss(p.rssKb)}
      </span>
      <span className="text-right font-mono tabular text-[color:var(--text-quaternary)]">
        {fmtUptime(p.etimes)}
      </span>
      <span
        className="truncate font-mono text-[11px] text-[color:var(--text-tertiary)]"
        title={p.command}
      >
        {p.command}
      </span>
      <div className="flex items-center justify-end gap-1">
        {isInit ? (
          <span className="px-1 text-[10px] text-[color:var(--text-quaternary)]">
            init
          </span>
        ) : (
          <>
            <IconBtn
              onClick={() =>
                onSignal(
                  p.pid,
                  stopped ? "CONT" : "STOP",
                  stopped ? "SIGCONT" : "SIGSTOP",
                )
              }
              disabled={busy}
              title={stopped ? "Resume (SIGCONT)" : "Suspend (SIGSTOP)"}
            >
              {stopped ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
            </IconBtn>
            <IconBtn
              onClick={() => confirmKill("TERM")}
              disabled={busy}
              title="Kill (SIGTERM)"
              tone="amber"
            >
              <X className="h-3.5 w-3.5" />
            </IconBtn>
            <IconBtn
              onClick={() => confirmKill("KILL")}
              disabled={busy}
              title="Force kill (SIGKILL)"
              tone="red"
            >
              <Skull className="h-3.5 w-3.5" />
            </IconBtn>
          </>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  tone?: "amber" | "red";
}) {
  const hover =
    tone === "red"
      ? "hover:border-[color:var(--acc-red)]/40 hover:bg-[color:var(--acc-red-soft)] hover:text-[color:var(--acc-red)]"
      : tone === "amber"
        ? "hover:border-[color:var(--acc-amber)]/40 hover:bg-[color:var(--acc-amber-soft)] hover:text-[color:var(--acc-amber)]"
        : "hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--text-primary)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center border border-[color:var(--border)] text-[color:var(--text-quaternary)] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        hover,
      )}
    >
      {disabled ? <Ban className="h-3 w-3 animate-pulse" /> : children}
    </button>
  );
}
