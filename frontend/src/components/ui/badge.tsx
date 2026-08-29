import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "purple";

const tones: Record<Tone, string> = {
  neutral:
    "border-[color:var(--border)] bg-[color:var(--bg-3)] text-[color:var(--text-secondary)]",
  blue:
    "border-[color:var(--acc-blue)]/30 bg-[color:var(--acc-blue-soft)] text-[color:var(--acc-blue)]",
  green:
    "border-[color:var(--acc-green)]/30 bg-[color:var(--acc-green-soft)] text-[color:var(--acc-green)]",
  amber:
    "border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)] text-[color:var(--acc-amber)]",
  red:
    "border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] text-[color:var(--acc-red)]",
  purple:
    "border-[color:var(--acc-purple)]/30 bg-[color:var(--acc-purple-soft)] text-[color:var(--acc-purple)]",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none tracking-tight",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function StatusDot({
  tone = "neutral",
  pulse,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  const color =
    tone === "green"
      ? "bg-[color:var(--acc-green)]"
      : tone === "amber"
        ? "bg-[color:var(--acc-amber)]"
        : tone === "red"
          ? "bg-[color:var(--acc-red)]"
          : tone === "blue"
            ? "bg-[color:var(--acc-blue)]"
            : tone === "purple"
              ? "bg-[color:var(--acc-purple)]"
              : "bg-[color:var(--text-tertiary)]";
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      {pulse && (
        <span
          className={cn(
            "absolute inset-0 animate-ping rounded-full opacity-60",
            color,
          )}
        />
      )}
      <span className={cn("relative inline-block h-2 w-2 rounded-full", color)} />
    </span>
  );
}
