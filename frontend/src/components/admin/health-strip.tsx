"use client";

// Live health probes for the dashboard. Pings each system on a 30s loop
// and renders a row of red/amber/green dots.

import * as React from "react";
import { StatusDot } from "@/components/ui/badge";

type Probe = {
  key: string;
  label: string;
  url: string;
};

const PROBES: Probe[] = [
  { key: "pelican", label: "Pelican API", url: "/api/admin/health/pelican" },
  { key: "node1", label: "Node 1 Wings", url: "/api/admin/health/node?n=1" },
  { key: "node2", label: "Node 2 Wings", url: "/api/admin/health/node?n=2" },
  { key: "resend", label: "Resend", url: "/api/admin/health/resend" },
  { key: "db", label: "Database", url: "/api/admin/health/db" },
];

type State = Record<string, { ok: boolean | null; latencyMs: number | null }>;

export function HealthStrip() {
  const [state, setState] = React.useState<State>({});

  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const updates: State = {};
      await Promise.all(
        PROBES.map(async (p) => {
          const t0 = Date.now();
          try {
            const r = await fetch(p.url, { cache: "no-store" });
            updates[p.key] = {
              ok: r.ok,
              latencyMs: Date.now() - t0,
            };
          } catch {
            updates[p.key] = { ok: false, latencyMs: Date.now() - t0 };
          }
        }),
      );
      if (!cancelled) setState((prev) => ({ ...prev, ...updates }));
    };
    tick();
    const iv = setInterval(tick, 30000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-[color:var(--border)] bg-[color:var(--bg-2)] px-4 py-3">
      <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
        system health
      </span>
      {PROBES.map((p) => {
        const s = state[p.key];
        const tone =
          s == null
            ? "neutral"
            : s.ok
              ? "green"
              : "red";
        return (
          <span
            key={p.key}
            className="flex items-center gap-1.5 text-[12px] tracking-tight text-[color:var(--text-secondary)]"
            title={s?.latencyMs ? `${s.latencyMs}ms` : "checking…"}
          >
            <StatusDot tone={tone as "green" | "red" | "neutral"} />
            {p.label}
            {s?.latencyMs != null && (
              <span className="text-[10px] text-[color:var(--text-tertiary)]">
                {s.latencyMs}ms
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
