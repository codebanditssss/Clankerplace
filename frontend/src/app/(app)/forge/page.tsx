import { ForgeFlow } from "./ForgeFlow";
import { MarketplaceShell } from "@/components/clankerplace/marketplace-shell";
import { HackathonForge } from "@/components/clankerplace/hackathon-demo";
import { getCurrentUser } from "@/lib/current-user";

export default async function ForgePage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string | string[] }>;
}) {
  const demo = (await searchParams).demo === "1";
  const user = await getCurrentUser();
  if (user && !demo) return <ForgeFlow />;
  return (
    <MarketplaceShell>
      <HackathonForge />
    </MarketplaceShell>
  );
}
