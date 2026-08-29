"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export type Tab = { id: string; label: string; icon?: React.ReactNode; badge?: React.ReactNode };

export function Tabs({
  tabs,
  current,
  onChange,
  className,
}: {
  tabs: Tab[];
  current: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-[54px] z-10 -mx-6 border-b border-hairline bg-neutral-950/90 backdrop-blur",
        className,
      )}
    >
      <div
        className="flex items-center gap-0.5 overflow-x-auto px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {tabs.map((t, i) => {
          const active = t.id === current;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.id)}
              className={cn(
                "group relative -mb-px flex h-11 shrink-0 items-center gap-2 px-3.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-100",
                active
                  ? "text-foreground"
                  : "text-neutral-300 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "font-mono text-[10px] tabular",
                  active ? "text-signal" : "text-neutral-500",
                )}
              >
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <span
                className={cn(
                  "transition-colors",
                  active
                    ? "text-signal"
                    : "opacity-70 group-hover:opacity-100",
                )}
              >
                {t.icon}
              </span>
              <span>{t.label}</span>
              {t.badge && <span className="ml-0.5">{t.badge}</span>}
              <span
                className={cn(
                  "absolute inset-x-2 -bottom-px h-0.5 transition-colors",
                  active ? "bg-signal" : "bg-transparent",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
