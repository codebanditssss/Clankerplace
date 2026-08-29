import { ForgeFlow } from "./ForgeFlow";
import { MarketplaceShell } from "@/components/clankerplace/marketplace-shell";
import { getCurrentUser } from "@/lib/current-user";

export default async function ForgePage() {
  const user = await getCurrentUser();
  if (user) return <ForgeFlow />;
  return (
    <MarketplaceShell>
      <div className="cp-forge-wrap"><ForgeFlow /></div>
    </MarketplaceShell>
  );
}
