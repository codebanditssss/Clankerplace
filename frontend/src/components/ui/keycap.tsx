import * as React from "react";
import { cn } from "@/lib/cn";

export function KeyCap({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[20px] items-center justify-center border border-[color:var(--border)] bg-[color:var(--bg-3)] px-1.5 text-[10px] font-medium tracking-tight text-[color:var(--text-tertiary)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
