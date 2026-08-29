"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-9 w-full appearance-none border border-[color:var(--border)] bg-[color:var(--bg-1)] pr-9 pl-3 text-sm text-[color:var(--text-primary)]",
          "hover:border-[color:var(--border-strong)] focus:border-[color:var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[color:var(--acc-blue)]/30",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-quaternary)]"
        strokeWidth={2}
      />
    </div>
  );
});
