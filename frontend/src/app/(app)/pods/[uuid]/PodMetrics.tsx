"use client";

// PodMetrics — historical + live container metrics.
//
// On mount and whenever the range picker changes, we fetch a windowed slice
// of `pod_metrics` rows from /api/pods/<uuid>/metrics-history (long ranges
// are server-side bucketed so the wire payload stays small). After that the
// `/api/pods/<uuid>/metrics` WS streams live samples from the background
// sampler — we append them to the same series. So switching to 24h pulls
// a full day of recorded data; switching back to 1m falls back to the most
// recent in-memory tail. Re-opening the page hours later still shows
// history, because the server has been recording continuously.
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Activity, Cpu, MemoryStick, Wifi } from "lucide-react";
import { StatusDot } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

// Wire shape from the sampler — already parsed to numbers server-side.
type WireSample = {
  t: number;
  cpu: number;
  mem_mb: number;
  mem_pct: number;
  net_rx_mb: number;
  net_tx_mb: number;
};

type Sample = {
  t: number;
  cpu: number;
  memP: number;
  memMB: number;
  netRx: number;
  netTx: number;
};

function fromWire(w: WireSample): Sample {
  return {
    t: w.t,
    cpu: w.cpu ?? 0,
    memP: w.mem_pct ?? 0,
    memMB: w.mem_mb ?? 0,
    netRx: w.net_rx_mb ?? 0,
    netTx: w.net_tx_mb ?? 0,
  };
}

type Range = "1m" | "5m" | "15m" | "1h" | "6h" | "24h";
const RANGES: Range[] = ["1m", "5m", "15m", "1h", "6h", "24h"];
const RANGE_MS: Record<Range, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

export default function PodMetrics({ identifier }: { identifier: string }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [connected, setConnected] = useState(false);
  const [range, setRange] = useState<Range>("5m");
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Fetch the historical window whenever range changes. We replace the
  // series entirely on range change — live samples will keep appending
  // afterward via the WS handler below.
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    (async () => {
      try {
        const r = await fetch(
          `/api/pods/${identifier}/metrics-history?range=${range}`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          if (!cancelled) setLoadingHistory(false);
          return;
        }
        const d = (await r.json()) as { samples: WireSample[] };
        if (cancelled) return;
        setSamples(d.samples.map(fromWire));
        setLoadingHistory(false);
      } catch {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identifier, range]);

  // Live WS — appends incoming samples. We dedupe on `t` so the bucket
  // edge sample from the history fetch + the first live sample at the
  // same timestamp don't both render.
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${proto}//${window.location.host}/api/pods/${identifier}/metrics`,
    );
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const w = JSON.parse(ev.data) as WireSample;
        const s = fromWire(w);
        setSamples((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].t >= s.t) return prev;
          // Cap in-memory series at 24h × 1 sample/5s = 17,280 entries.
          const next = prev.length >= 17_280 ? prev.slice(-17_279) : prev;
          return [...next, s];
        });
      } catch {}
    };
    return () => {
      try {
        ws.close();
      } catch {}
    };
  }, [identifier]);

  // For display, only show samples within the requested range so live
  // samples for older bucketed views don't push the bucketed history
  // off-axis.
  const windowed = useMemo(() => {
    const since = Date.now() - RANGE_MS[range];
    return samples.filter((s) => s.t >= since);
  }, [samples, range]);
  const latest = samples[samples.length - 1];

  const netSeries = useMemo(() => {
    if (windowed.length < 2) return [];
    return windowed.slice(1).map((s, i) => {
      const prev = windowed[i];
      const dt = Math.max(0.001, (s.t - prev.t) / 1000);
      return {
        t: s.t,
        rx: Math.max(0, (s.netRx - prev.netRx) / dt) * 1024,
        tx: Math.max(0, (s.netTx - prev.netTx) / dt) * 1024,
      };
    });
  }, [windowed]);

  // Detect idle: meaningful samples present, all values near 0.
  const isIdle = useMemo(() => {
    if (windowed.length < 3) return false;
    const lastN = windowed.slice(-Math.min(windowed.length, 10));
    const cpuMax = Math.max(...lastN.map((s) => s.cpu));
    const memDelta =
      Math.max(...lastN.map((s) => s.memMB)) -
      Math.min(...lastN.map((s) => s.memMB));
    const netDelta = netSeries
      .slice(-10)
      .reduce((a, s) => a + (s.rx ?? 0) + (s.tx ?? 0), 0);
    return cpuMax < 1 && memDelta < 1 && netDelta < 1;
  }, [windowed, netSeries]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-[color:var(--text-tertiary)]">
          <Activity className="h-3.5 w-3.5" />
          <span>Recorded continuously · 5&nbsp;s cadence · 24&nbsp;h window.</span>
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2 py-0.5">
            <StatusDot tone={connected ? "green" : "neutral"} pulse={connected} />
            <span className="text-[10px]">{connected ? "live" : "offline"}</span>
          </span>
          {loadingHistory && (
            <span className="ml-1 text-[10px] text-[color:var(--text-quaternary)]">
              loading history…
            </span>
          )}
          {isIdle && !loadingHistory && (
            <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2 py-0.5 text-[10px] text-[color:var(--text-quaternary)]">
              pod is idle — run a command to see activity
            </span>
          )}
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Kpi
          icon={<Cpu className="h-3.5 w-3.5" />}
          label="CPU"
          value={latest ? `${latest.cpu.toFixed(latest.cpu < 1 ? 2 : 1)}%` : "—"}
          sub="of allocated"
          accent="var(--acc-blue)"
        />
        <Kpi
          icon={<MemoryStick className="h-3.5 w-3.5" />}
          label="Memory"
          value={
            latest ? `${latest.memMB.toFixed(latest.memMB < 100 ? 1 : 0)} MB` : "—"
          }
          sub={latest ? `${latest.memP.toFixed(2)}% of limit` : ""}
          accent="var(--acc-green)"
        />
        <Kpi
          icon={<Wifi className="h-3.5 w-3.5" />}
          label="Network rx"
          value={latest ? formatNet(latest.netRx) : "—"}
          sub="cumulative"
          accent="var(--acc-amber)"
        />
      </div>

      <ChartCard title="CPU usage" data={windowed} kind="cpu" range={range} />
      <ChartCard title="Memory usage" data={windowed} kind="memory" range={range} />
      <ChartCard title="Network throughput" data={netSeries} kind="net" range={range} />
    </div>
  );
}

function formatNet(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${(mb * 1024).toFixed(0)} KB`;
}

function RangePicker({
  value,
  onChange,
}: {
  value: Range;
  onChange: (r: Range) => void;
}) {
  return (
    <div className="inline-flex border border-[color:var(--border)] bg-[color:var(--bg-2)] p-0.5">
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={cn(
            "px-2.5 py-1 text-[11px] font-medium transition-colors",
            r === value
              ? "bg-[color:var(--bg-4)] text-[color:var(--text-primary)]"
              : "text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]",
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <Card className="relative overflow-hidden p-4">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[color:var(--text-tertiary)]">
        <span style={{ color: accent }}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 font-mono text-[22px] font-semibold tracking-tight text-[color:var(--text-primary)]">
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-[color:var(--text-quaternary)]">
          {sub}
        </div>
      )}
    </Card>
  );
}

// Tiny axis-top floor used ONLY when the series is truly flat-zero (no
// recorded activity at all), so the line still has a visible baseline.
// As soon as there's any signal we throw this away and scale tightly to
// the data (max × 1.15) so a pod sitting at 0.3% CPU shows detail at the
// 0.3 mark instead of vanishing into the bottom of a 0-5% axis.
const FLAT_ZERO_FLOOR: Record<"cpu" | "memory" | "net", number> = {
  cpu: 1,
  memory: 10,
  net: 0.1,
};

// X-axis tick formatter — for ranges ≥ 6h show hh:mm so the labels
// don't all collapse into the same minute.
function xTickFormatter(range: Range): (t: number) => string {
  if (range === "24h" || range === "6h") {
    return (t) =>
      new Date(t).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
  }
  return (t) =>
    new Date(t).toLocaleTimeString(undefined, {
      minute: "2-digit",
      second: "2-digit",
    });
}

function ChartCard({
  title,
  data,
  kind,
  range,
}: {
  title: string;
  data: Array<{ t: number } & Record<string, number>>;
  kind: "cpu" | "memory" | "net";
  range: Range;
}) {
  // Dynamically scale the Y axis to the recorded volumes:
  //   - if the series is essentially zero, fall back to FLAT_ZERO_FLOOR
  //     so the chart isn't a 0-height invisible line.
  //   - otherwise use max × 1.15 (15 % headroom) so the line sits near
  //     the top of its envelope; switching from a 90 % CPU spike to a
  //     0.5 % idle period auto-zooms the axis from 0-100 % to 0-0.6 %.
  const upperBound = useMemo(() => {
    if (data.length === 0) return FLAT_ZERO_FLOOR[kind];
    const keys =
      kind === "cpu" ? ["cpu"] : kind === "memory" ? ["memMB"] : ["rx", "tx"];
    let max = 0;
    for (const row of data) {
      for (const k of keys) {
        const v = (row as Record<string, number>)[k];
        if (typeof v === "number" && v > max) max = v;
      }
    }
    // Epsilon below which we treat the series as "no signal" — picked
    // per metric so a 0.001 MB memory blip doesn't kick us out of the
    // floor regime, but a real 0.3 % CPU sample does.
    const eps =
      kind === "cpu" ? 0.05 : kind === "memory" ? 0.5 : 0.01;
    if (max < eps) return FLAT_ZERO_FLOOR[kind];
    return max * 1.15;
  }, [data, kind]);
  const id = React.useId();
  const tickFmt = xTickFormatter(range);
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
          {title}
        </h3>
        <div className="text-[10px] text-[color:var(--text-quaternary)]">
          {data.length} samples · {range}
        </div>
      </div>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "net" ? (
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="t"
                stroke="var(--text-quaternary)"
                tick={{ fontSize: 10, fill: "var(--text-quaternary)" }}
                tickFormatter={tickFmt}
                minTickGap={40}
              />
              <YAxis
                stroke="var(--text-quaternary)"
                tick={{ fontSize: 10, fill: "var(--text-quaternary)" }}
                tickFormatter={(v) =>
                  upperBound < 10 ? v.toFixed(1) : v.toFixed(0)
                }
                domain={[0, upperBound]}
                width={42}
              />
              <Tooltip {...sharedTooltipProps()} formatter={(v: unknown) => formatNum(v, " KB/s")} />
              <Legend
                wrapperStyle={{ fontSize: 10, color: "var(--text-tertiary)" }}
                iconType="line"
              />
              <Line
                type="monotone"
                dataKey="rx"
                name="rx"
                stroke="var(--acc-amber)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="tx"
                name="tx"
                stroke="var(--acc-purple)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          ) : (
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={kind === "cpu" ? "var(--acc-blue)" : "var(--acc-green)"}
                    stopOpacity={0.35}
                  />
                  <stop
                    offset="100%"
                    stopColor={kind === "cpu" ? "var(--acc-blue)" : "var(--acc-green)"}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="t"
                stroke="var(--text-quaternary)"
                tick={{ fontSize: 10, fill: "var(--text-quaternary)" }}
                tickFormatter={tickFmt}
                minTickGap={40}
              />
              <YAxis
                stroke="var(--text-quaternary)"
                tick={{ fontSize: 10, fill: "var(--text-quaternary)" }}
                tickFormatter={(v) => {
                  // Pick decimal precision based on the axis scale so a
                  // 0-5 % CPU window shows 0.5, 1.0, etc. instead of all
                  // ticks rounding to 0 %.
                  if (kind === "cpu") {
                    if (upperBound < 2) return `${v.toFixed(2)}%`;
                    if (upperBound < 10) return `${v.toFixed(1)}%`;
                    return `${v.toFixed(0)}%`;
                  }
                  if (upperBound < 10) return v.toFixed(1);
                  return v.toFixed(0);
                }}
                domain={[0, upperBound]}
                width={42}
              />
              <Tooltip
                {...sharedTooltipProps()}
                formatter={(v: unknown) =>
                  formatNum(v, kind === "cpu" ? "%" : " MB")
                }
              />
              <Area
                type="monotone"
                dataKey={kind === "cpu" ? "cpu" : "memMB"}
                name={kind === "cpu" ? "cpu" : "memory"}
                stroke={kind === "cpu" ? "var(--acc-blue)" : "var(--acc-green)"}
                strokeWidth={1.5}
                fill={`url(#grad-${id})`}
                isAnimationActive={false}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function sharedTooltipProps() {
  return {
    cursor: { stroke: "var(--border-strong)", strokeDasharray: "2 2" },
    contentStyle: {
      background: "var(--bg-3)",
      border: "1px solid var(--border-strong)",
      borderRadius: 6,
      fontSize: 11,
      padding: "6px 8px",
    } as React.CSSProperties,
    labelStyle: { color: "var(--text-quaternary)" } as React.CSSProperties,
    itemStyle: { color: "var(--text-primary)" } as React.CSSProperties,
    labelFormatter: (t: unknown) =>
      typeof t === "number"
        ? new Date(t).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })
        : "",
  };
}

function formatNum(v: unknown, unit: string): [string, string] {
  const n = typeof v === "number" ? v : Number(v);
  return [Number.isFinite(n) ? `${n.toFixed(2)}${unit}` : "—", ""];
}
