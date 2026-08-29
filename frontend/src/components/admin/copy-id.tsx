"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

export function CopyId({
  value,
  display,
  className,
}: {
  value: string;
  display?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm font-mono text-[11px] tracking-tight text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]",
        className,
      )}
      title="Copy"
    >
      <span>{display ?? value}</span>
      {copied ? (
        <Check className="h-3 w-3 text-[color:var(--acc-green)]" />
      ) : (
        <Copy className="h-3 w-3 opacity-60" />
      )}
    </button>
  );
}
