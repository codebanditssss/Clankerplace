"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => onOpenChange(false)}
            className="absolute inset-0 bg-[color:var(--neutral-950)]/80 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: width + 40 }}
            animate={{ x: 0 }}
            exit={{ x: width + 40 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className={cn(
              "absolute right-0 top-0 flex h-dvh flex-col border-l border-[color:var(--border)] bg-[color:var(--bg-1)] shadow-[var(--shadow-pop)]",
            )}
            style={{ width: `min(${width}px, 100vw)` }}
          >
            {(title || description) && (
              <header className="flex items-start justify-between gap-4 border-b border-[color:var(--border-subtle)] px-6 py-5">
                <div className="min-w-0">
                  {title && (
                    <h2 className="text-[18px] font-semibold tracking-tight">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)]">
                      {description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onOpenChange(false)}
                  aria-label="close"
                  className="p-1.5 text-[color:var(--text-tertiary)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--text-primary)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
            )}
            <div className="flex-1 overflow-y-auto">{children}</div>
            {footer && (
              <footer className="border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] px-6 py-4">
                {footer}
              </footer>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
