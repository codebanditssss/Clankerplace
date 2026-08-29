import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

type DeltaKind = "up" | "down" | "flat";

function deltaKind(value: number): DeltaKind {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

export function KpiCard({
  label,
  value,
  delta,
  trend,
  href,
}: {
  label: string;
  value: number | string;
  delta?: { value: number; label: string };
  trend?: number[];
  href?: string;
}) {
  const kind = delta ? deltaKind(delta.value) : "flat";
  const Inner = (
    <div className="group relative flex h-full flex-col gap-3 border border-[color:var(--border)] bg-[color:var(--bg-2)] px-4 py-4 transition-colors hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-3)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
          {label}
        </span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] tracking-tight",
              kind === "up" && "text-[color:var(--acc-green)]",
              kind === "down" && "text-[color:var(--acc-red)]",
              kind === "flat" && "text-[color:var(--text-tertiary)]",
            )}
            title={delta.label}
          >
            {kind === "up" && <ArrowUpRight className="h-3 w-3" />}
            {kind === "down" && <ArrowDownRight className="h-3 w-3" />}
            {kind === "flat" && <Minus className="h-3 w-3" />}
            {delta.value > 0 ? "+" : ""}
            {delta.value}
          </span>
        )}
      </div>
      <div className="text-[28px] font-semibold tracking-tight tabular-nums text-[color:var(--text-primary)]">
        {value}
      </div>
      {trend && trend.length > 1 && <Sparkline data={trend} kind={kind} />}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block">
        {Inner}
      </Link>
    );
  }
  return Inner;
}

function Sparkline({
  data,
  kind,
}: {
  data: number[];
  kind: DeltaKind;
}) {
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const W = 100;
  const H = 24;
  const range = Math.max(1, max - min);
  const step = data.length > 1 ? W / (data.length - 1) : 0;
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = H - ((v - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke =
    kind === "up"
      ? "var(--acc-green)"
      : kind === "down"
        ? "var(--acc-red)"
        : "var(--text-tertiary)";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-6 w-full"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
