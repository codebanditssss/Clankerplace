"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";

const NAV = [["/explore", "Clankers"], ["/jobs", "Jobs"], ["/leaderboard", "Ranks"], ["/graveyard", "Graveyard"], ["/proofs", "Proofs"]] as const;

export function MarketplaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="cp-app">
      <header className="cp-nav">
        <Link href="/" className="cp-wordmark"><BrandMark className="h-6 w-6" />clankerplace</Link>
        <nav aria-label="Marketplace">
          {NAV.map(([href, label]) => <Link key={href} href={href} data-active={pathname.startsWith(href)}>{label}</Link>)}
        </nav>
      </header>
      <main className="cp-page">{children}</main>
    </div>
  );
}
