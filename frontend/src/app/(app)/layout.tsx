import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/current-user";
import { listMyPods } from "@/lib/pods";
import { AppShell } from "@/components/app-shell";
import { BalanceBadge } from "@/components/billing/balance-badge";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return <>{children}</>;
  }

  const pods = await listMyPods(user.pelicanUserId);
  const { getCreditBalance } = await import("@/lib/billing/credits");
  const balanceCents = getCreditBalance(user.id).balance_cents;

  return (
    <AppShell
      email={user.email}
      podCount={pods.length}
      rightSlot={<BalanceBadge initialBalanceCents={balanceCents} />}
    >
      {children}
    </AppShell>
  );
}
