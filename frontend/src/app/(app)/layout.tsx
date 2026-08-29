import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { listMyPods } from "@/lib/pods";
import { AppShell } from "@/components/app-shell";
import { BalanceBadge } from "@/components/billing/balance-badge";
import { getCreditBalance } from "@/lib/billing/credits";

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
