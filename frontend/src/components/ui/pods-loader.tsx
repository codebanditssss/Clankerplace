import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

type PodsLoaderSize = "sm" | "md" | "lg";

const scales: Record<PodsLoaderSize, string> = {
  sm: "0.42",
  md: "0.58",
  lg: "0.76",
};

export function PodsLoader({
  size = "md",
  label,
  className,
}: {
  size?: PodsLoaderSize;
  label?: string;
  className?: string;
}) {
  const style = {
    "--pods-loader-scale": scales[size],
  } as CSSProperties;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        className,
      )}
    >
      <span className="pods-loader-frame" style={style} aria-hidden>
        <span className="pods-loader" />
      </span>
      {label ? (
        <span className="max-w-[260px] text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
          {label}
        </span>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
}
