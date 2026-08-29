"use client";

import Link from "next/link";
import { Wallet } from "lucide-react";
import { useBillingFetch } from "./use-billing-fetch";

export type BalanceBadgeProps = {
  initialBalanceCents: number;
};

type ApiCredits = {
  balance_cents: number;
};

export function BalanceBadge({ initialBalanceCents }: BalanceBadgeProps) {
  const { data } = useBillingFetch<ApiCredits>("/api/billing/credits", {
    initial: { balance_cents: initialBalanceCents },
    pollMs: 0,
    transform: (json) => {
      const j = json as Partial<ApiCredits>;
      return { balance_cents: j.balance_cents ?? 0 };
    },
  });
  const balance = data?.balance_cents ?? initialBalanceCents;
  const usd = (balance / 100).toFixed(2);

  return (
    <Link
      href="/billing"
      title={`Credit balance $${usd}`}
      aria-label={`Credit balance $${usd}`}
      className="group inline-flex items-center gap-1.5 border border-hairline bg-neutral-950 px-2.5 py-1 font-mono text-[11px] tabular text-live transition-colors hover:border-neutral-700 hover:bg-neutral-900"
    >
      <Wallet className="h-3 w-3 text-live" strokeWidth={2} />
      <span>${usd}</span>
    </Link>
  );
}
