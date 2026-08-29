"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { BrandMark } from "./brand-mark";

const NAV = [["/explore", "Clankers"], ["/jobs", "Jobs"], ["/leaderboard", "Ranks"], ["/graveyard", "Graveyard"], ["/proofs", "Proofs"]] as const;

export function MarketplaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [lens, setLens] = React.useState<"smith" | "boss">("smith");
  React.useEffect(() => {
    const stored = localStorage.getItem("clankerplace:lens");
    if (stored === "boss") setLens("boss");
  }, []);
  const choose = (next: "smith" | "boss") => {
    setLens(next);
    localStorage.setItem("clankerplace:lens", next);
  };
  return (
    <div className="cp-app" data-lens={lens}>
      <header className="cp-nav">
        <Link href="/" className="cp-wordmark"><BrandMark className="h-6 w-6" />clankerplace</Link>
        <nav aria-label="Marketplace">
          {NAV.map(([href, label]) => <Link key={href} href={href} data-active={pathname.startsWith(href)}>{label}</Link>)}
        </nav>
        <div className="cp-lens" aria-label="Marketplace lens">
          <button onClick={() => choose("smith")} aria-pressed={lens === "smith"}>Smith</button>
          <button onClick={() => choose("boss")} aria-pressed={lens === "boss"}>Boss</button>
        </div>
      </header>
      <main className="cp-page">{children}</main>
    </div>
  );
}
