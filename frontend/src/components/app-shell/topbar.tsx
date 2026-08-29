"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, Search } from "lucide-react";
import { KeyCap } from "@/components/ui/keycap";

type Crumb = { label: string; href?: string };

export function Topbar({
  crumbs = [],
  onOpenPalette,
  rightSlot,
  onOpenMobileNav,
}: {
  crumbs?: Crumb[];
  onOpenPalette?: () => void;
  rightSlot?: React.ReactNode;
  onOpenMobileNav?: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-[54px] items-center gap-3 border-b border-hairline bg-neutral-950/90 px-4 backdrop-blur-md sm:gap-4 sm:px-6 md:grid md:grid-cols-[1fr_auto_1fr]">
      {/* Mobile-only left cluster: hamburger + wordmark. */}
      <div className="flex min-w-0 items-center gap-3 md:hidden">
        {onOpenMobileNav && (
          <button
            onClick={onOpenMobileNav}
            aria-label="open navigation"
            className="-ml-1 grid h-9 w-9 place-items-center text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-foreground"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 text-foreground"
          aria-label="FuelBorn home"
        >
          <Image
            src="/pods_favicon_tight_512.png"
            alt=""
            width={128}
            height={128}
            priority
            className="h-12 w-12 shrink-0"
          />
          <span className="truncate text-[15px] font-semibold tracking-tight">
            Fuel<span className="text-signal">Born</span>
          </span>
        </Link>
      </div>

      {/* Desktop breadcrumb (md and up). */}
      <nav className="hidden min-w-0 items-center gap-2 font-mono text-[12px] tabular md:flex">
        {crumbs.length === 0 ? (
          <span className="text-neutral-400">
            <span className="text-neutral-500">~</span>
            <span className="mx-1 text-neutral-600">/</span>
            <span className="text-foreground">overview</span>
          </span>
        ) : (
          <span className="flex min-w-0 items-center">
            <span className="text-neutral-500">~</span>
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                <span className="mx-1 text-neutral-600">/</span>
                {c.href ? (
                  <Link
                    href={c.href}
                    className="truncate text-neutral-400 transition-colors hover:text-foreground"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="truncate text-foreground">{c.label}</span>
                )}
              </React.Fragment>
            ))}
          </span>
        )}
      </nav>

      {/* Search trigger, centered on desktop, hidden on mobile. */}
      <div className="hidden justify-center md:flex">
        {onOpenPalette && (
          <button
            onClick={onOpenPalette}
            className="flex items-center gap-2 border border-hairline bg-neutral-900 px-3 py-1.5 text-[11px] text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-foreground"
          >
            <Search className="h-3 w-3" />
            <span className="font-mono uppercase tracking-wider">Search</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <KeyCap className="min-w-[2.25rem]">Ctrl</KeyCap>
              <KeyCap>K</KeyCap>
            </span>
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center justify-end gap-2 sm:gap-3 md:ml-0">
        {/* Mobile-only icon-button search trigger. */}
        {onOpenPalette && (
          <button
            onClick={onOpenPalette}
            aria-label="open search"
            className="grid h-9 w-9 place-items-center text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-foreground md:hidden"
          >
            <Search className="h-4 w-4" />
          </button>
        )}
        {rightSlot}
      </div>
    </header>
  );
}
