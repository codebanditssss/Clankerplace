import type { ReactNode } from "react";
import { MarketplaceShell } from "@/components/clankerplace/marketplace-shell";
export default function MarketplaceLayout({ children }: { children: ReactNode }) { return <MarketplaceShell>{children}</MarketplaceShell>; }
