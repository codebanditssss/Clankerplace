"use client";

// Lightweight table wrapper. No client-side sorting — the page passes
// already-sorted rows. Sticky header. Row clicks navigate via Next's
// router for SPA navigation.

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

export function Table({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px] tracking-tight">
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-[color:var(--bg-1)] text-[color:var(--text-tertiary)]">
      {children}
    </thead>
  );
}

export function TH({
  children,
  className,
  align,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "border-b border-[color:var(--border)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        !align && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  children,
  href,
  onClick,
  className,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const base =
    "border-b border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] transition-colors";
  const interactive = href || onClick;
  return (
    <tr
      className={cn(
        base,
        interactive && "cursor-pointer hover:bg-[color:var(--bg-3)]",
        className,
      )}
      onClick={() => {
        if (href) router.push(href);
        else if (onClick) onClick();
      }}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  className,
  align,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      className={cn(
        "px-3 py-2.5",
        align === "right" && "text-right tabular-nums",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}
