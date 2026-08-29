"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export type Step = {
  id: string;
  label: string;
  description?: string;
};

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: Step[];
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("relative flex flex-col gap-3", className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.id} className="flex items-start gap-3">
            <div className="relative flex flex-col items-center">
              <motion.div
                animate={{
                  scale: active ? 1 : done ? 1 : 0.95,
                  opacity: i > current ? 0.5 : 1,
                }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors",
                  done
                    ? "border-[color:var(--text-primary)] bg-[color:var(--text-primary)] text-[color:var(--neutral-950)]"
                    : active
                      ? "border-[color:var(--text-primary)] bg-[color:var(--bg-2)] text-[color:var(--text-primary)]"
                      : "border-[color:var(--border)] bg-[color:var(--bg-2)] text-[color:var(--text-quaternary)]",
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </motion.div>
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    "w-px flex-1 transition-colors",
                    i < current ? "bg-[color:var(--text-tertiary)]" : "bg-[color:var(--border)]",
                  )}
                  style={{ minHeight: 14 }}
                />
              )}
            </div>
            <div className="pb-2">
              <div
                className={cn(
                  "text-[12px] font-medium transition-colors",
                  active
                    ? "text-[color:var(--text-primary)]"
                    : done
                      ? "text-[color:var(--text-secondary)]"
                      : "text-[color:var(--text-tertiary)]",
                )}
              >
                {s.label}
              </div>
              {s.description && (
                <div
                  className={cn(
                    "mt-0.5 text-[11px]",
                    active
                      ? "text-[color:var(--text-tertiary)]"
                      : "text-[color:var(--text-quaternary)]",
                  )}
                >
                  {s.description}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
