"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useBillingFetch } from "./use-billing-fetch";

type SubscriptionSummary = {
  subscription: {
    plan: string;
    plan_name?: string;
    status: string;
    renewal_date: string | null;
  } | null;
  active_pod_count: number;
  active_pod_limit: number | null;
  can_create_pod: boolean;
  gate_reason: string | null;
  message: string | null;
};

export function SubscriptionGateNotice({
  variant = "pill",
}: {
  variant?: "pill" | "wizard";
}) {
  const { data } = useBillingFetch<SubscriptionSummary>(
    "/api/billing/subscription",
    { pollMs: 0 },
  );
  if (!data) return null;

  const planName = data.subscription?.plan_name ?? data.subscription?.plan;
  const usage =
    data.active_pod_limit == null
      ? `${data.active_pod_count} pods`
      : `${data.active_pod_count} / ${data.active_pod_limit} pods`;

  if (variant === "pill") {
    const ok = data.can_create_pod;
    return (
      <Link
        href={ok ? "/billing" : "/pricing"}
        className={`inline-flex max-w-full items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
          ok
            ? "border-live/30 bg-live/10 text-live"
            : "border-amber-400/30 bg-amber-400/10 text-amber-300"
        }`}
      >
        {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        <span className="truncate">
          {planName ? `${planName} · ${usage}` : "Subscribe to deploy"}
        </span>
      </Link>
    );
  }

  if (data.can_create_pod) {
    return (
      <div className="border border-live/25 bg-live/5 p-3 text-[12px] text-live">
        {planName} plan active. {usage} used.
      </div>
    );
  }

  return (
    <div className="border border-amber-400/30 bg-amber-400/10 p-3 text-[12px] leading-relaxed text-amber-200">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
        <div>
          <div className="font-medium text-amber-100">
            {data.message ?? "Choose a subscription plan to create a new pod."}
          </div>
          <div className="mt-1 text-amber-100/70">
            Existing pods remain available. New pods and resource upgrades require
            an active plan.
          </div>
          <Link
            href="/pricing"
            className="mt-2 inline-flex font-mono text-[11px] uppercase tracking-wider text-amber-100 underline-offset-2 hover:underline"
          >
            View pricing
          </Link>
        </div>
      </div>
    </div>
  );
}
