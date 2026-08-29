import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  ReceiptText,
  Sparkles,
  Wallet,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getCreditSnapshot } from "@/lib/billing/credits";
import {
  countActivePods,
  getCurrentSubscription,
} from "@/lib/billing/subscriptions";
import {
  CREDIT_PACKS,
  PLANS,
  isActiveSubscriptionStatus,
  type CreditPackId,
  type PlanId,
} from "@/lib/billing/plans";
import { getBillingCustomerByUser } from "@/lib/billing/customers";
import { getLatestDodoPaymentAttempt } from "@/lib/billing/payment-attempts";
import {
  PLAN_DETAILS,
  isSelfServePlanDetail,
  type BillingPlanDetail,
} from "@/lib/billing/plan-details";
import { shortHandle } from "@/lib/display-name";
import { Button } from "@/components/ui/button";
import {
  BillingPortalButton,
  CreditPackCheckoutButton,
  SubscriptionCheckoutButton,
} from "@/components/billing/billing-actions";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const subscription = getCurrentSubscription(user.id);
  const customer = getBillingCustomerByUser(user.id);
  const creditSnapshot = getCreditSnapshot(user.id);
  const activePodCount = subscription?.active_pod_count ?? countActivePods(user.id);
  const plan = subscription ? PLANS[subscription.plan as PlanId] : null;
  const active = isActiveSubscriptionStatus(subscription?.status);
  const limit = subscription?.plan_limit ?? 0;
  const hasBillingPortal = Boolean(customer?.dodo_customer_id ?? subscription?.dodo_customer_id);
  const paymentAttempt = getLatestDodoPaymentAttempt(user.id, {
    subscriptionId: subscription?.dodo_subscription_id,
    plan: subscription?.plan,
    subscriptionOnly: true,
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-8">
        <div>
          <span className="micro text-neutral-500">Settings · Billing</span>
          <h1 className="display mt-3 text-[clamp(2rem,4vw,3rem)] leading-[0.95]">
            Billing<span className="text-signal">.</span>
          </h1>
          <p className="mt-3 text-[13px] text-neutral-400">
            Subscription, pod limits, and credit wallet for{" "}
            <span className="font-mono text-foreground">{shortHandle(user.email)}</span>.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
            active
              ? "border-live/30 bg-live/10 text-live"
              : "border-amber-400/30 bg-amber-400/10 text-amber-300"
          }`}
        >
          <CheckCircle2 className="h-3 w-3" />
          {active ? "subscription active" : "subscription required"}
        </span>
      </header>

      <section className="mt-8 grid gap-px border border-hairline bg-hairline lg:grid-cols-3">
        <div className="bg-neutral-900 p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="micro text-neutral-500">01 · Subscription</div>
              <h2 className="mt-3 font-display text-[30px] leading-tight text-foreground">
                {plan?.name ?? "No active plan"}
              </h2>
              <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-neutral-400">
                {subscription
                  ? subscriptionLine(subscription.status, subscription.renewal_date ?? subscription.current_period_end)
                  : "Existing pods remain available. Choose a plan to create new pods or upgrade resources."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {hasBillingPortal ? (
                <BillingPortalButton>
                  Download invoices
                </BillingPortalButton>
              ) : null}
              <Link href="#plans">
                <Button variant="ghost" size="sm">
                  View plans <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-px border border-hairline bg-hairline sm:grid-cols-3">
            <Metric label="Pod usage" value={`${activePodCount} / ${limit || 0}`} />
            <Metric
              label="Renewal"
              value={formatDate(subscription?.renewal_date ?? subscription?.current_period_end)}
            />
            <Metric label="Status" value={subscription?.status ?? "none"} />
          </div>

          {!active && paymentAttempt ? (
            <PaymentRecoveryNotice
              attempt={paymentAttempt}
              subscriptionStatus={subscription?.status}
              hasBillingPortal={hasBillingPortal}
            />
          ) : null}

          {!active ? (
            <div className="mt-5 border border-amber-400/30 bg-amber-400/10 p-4 text-[12px] leading-relaxed text-amber-100">
              No active subscription means no new pods. Existing pods can still
              be viewed, started, and stopped.
            </div>
          ) : activePodCount >= (limit || Number.POSITIVE_INFINITY) ? (
            <div className="mt-5 border border-amber-400/30 bg-amber-400/10 p-4 text-[12px] leading-relaxed text-amber-100">
              Your current plan limit is full. Upgrade before creating another pod.
            </div>
          ) : null}
        </div>

        <div className="bg-neutral-900 p-6">
          <div className="micro flex items-center gap-1.5 text-neutral-500">
            <Wallet className="h-3 w-3" />
            02 · Credit wallet
          </div>
          <div className="mt-3 font-mono text-[32px] font-medium tabular text-foreground">
            ${creditSnapshot.balance_usd}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
            Stored in cents as reusable account balance. BYOK usage does not
            consume credits in this branch.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {(Object.keys(CREDIT_PACKS) as CreditPackId[]).map((packId) => {
              const pack = CREDIT_PACKS[packId];
              return (
                <CreditPackCheckoutButton
                  key={pack.id}
                  pack={pack.id}
                  className="w-full justify-center"
                >
                  ${(pack.amountCents / 100).toFixed(0)}
                </CreditPackCheckoutButton>
              );
            })}
          </div>
        </div>
      </section>

      <section id="plans" className="mt-12 scroll-mt-8">
        <header className="mb-5 flex items-baseline justify-between border-b border-hairline pb-3">
          <h2 className="micro flex items-center gap-3 text-neutral-400">
            <span className="font-mono text-neutral-600">A</span>
            Plans
          </h2>
          <Link href="#plans" className="micro text-neutral-500 hover:text-foreground">
            Full pricing
          </Link>
        </header>
        <div className="grid gap-px border border-hairline bg-hairline xl:grid-cols-4">
          {PLAN_DETAILS.map((planDetail) => (
            <BillingPlanCard
              key={planDetail.id}
              plan={planDetail}
              currentPlan={subscription?.plan}
              subscriptionActive={active}
              subscriptionStatus={subscription?.status}
              hasBillingPortal={hasBillingPortal}
              latestAttempt={paymentAttempt}
            />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <header className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h2 className="micro flex items-center gap-3 text-neutral-400">
            <span className="font-mono text-neutral-600">B</span>
            Credit transactions
          </h2>
        </header>
        <div className="mt-5">
          {creditSnapshot.transactions.length === 0 ? (
            <div className="border border-hairline bg-neutral-900 p-8 text-center text-[12px] text-neutral-400">
              No credit transactions yet.
            </div>
          ) : (
            <div className="divide-y divide-hairline border border-hairline bg-neutral-900">
              {creditSnapshot.transactions.map((tx) => {
                const isDebit = tx.amount_cents < 0;
                const sign = isDebit ? "-" : "+";
                const amountUsd = (Math.abs(tx.amount_cents) / 100).toFixed(2);
                return (
                  <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
                        <CreditCard className={isDebit ? "h-3 w-3 text-error" : "h-3 w-3 text-live"} />
                        {tx.description ?? tx.type.replace(/_/g, " ")}
                      </div>
                      <div className="font-mono text-[11px] text-neutral-500">
                        {formatDate(tx.created_at)} · balance $
                        {(tx.balance_after_cents / 100).toFixed(2)}
                      </div>
                    </div>
                    <span
                      className={`font-mono text-[13px] tabular ${
                        isDebit ? "text-error" : "text-live"
                      }`}
                    >
                      {sign}${amountUsd}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="mt-12 border-t border-hairline pt-8 text-[12px] leading-relaxed text-neutral-400">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 flex-none text-signal" />
          <p>
            Pods Managed AI, token metering, model pricing, and credit
            consumption are deferred to the dedicated Managed AI project. This
            branch only stores credit balance and purchase history.
          </p>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-950 p-4">
      <div className="micro text-neutral-500">{label}</div>
      <div className="mt-2 font-mono text-[20px] tabular text-foreground">{value}</div>
    </div>
  );
}

function BillingPlanCard({
  plan,
  currentPlan,
  subscriptionActive,
  subscriptionStatus,
  hasBillingPortal,
  latestAttempt,
}: {
  plan: BillingPlanDetail;
  currentPlan: string | undefined;
  subscriptionActive: boolean;
  subscriptionStatus: string | undefined;
  hasBillingPortal: boolean;
  latestAttempt: {
    status: string;
    error_message: string | null;
  } | null;
}) {
  const current = currentPlan === plan.id;
  const recoveringCurrentPlan = current && !subscriptionActive;
  return (
    <article className="flex min-h-full flex-col bg-neutral-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="micro text-neutral-500">{plan.name}</div>
          <p className="mt-3 text-[12px] leading-relaxed text-neutral-400">
            {plan.audience}
          </p>
        </div>
        {current && subscriptionActive ? (
          <span className="border border-live/30 bg-live/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-live">
            Current
          </span>
        ) : current ? (
          <span className="border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-300">
            {subscriptionBadge(subscriptionStatus, latestAttempt?.status)}
          </span>
        ) : plan.badge ? (
          <span className="border border-signal/40 bg-signal/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-signal">
            {plan.badge}
          </span>
        ) : null}
      </div>

      <div className="mt-4 font-mono text-[24px] text-foreground">
        {plan.price}
      </div>
      <div className="mt-3 grid gap-2 text-[12px] leading-relaxed text-neutral-400">
        <span>{plan.podLimit}</span>
        <span>{plan.resources}</span>
      </div>

      <ul className="mt-5 flex-1 space-y-2 border-t border-hairline pt-4 text-[12px] text-neutral-300">
        {plan.features.map((feature) => (
          <li key={feature} className="flex min-w-0 gap-2" title={feature}>
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-live" />
            <span className="min-w-0 truncate whitespace-nowrap">{feature}</span>
          </li>
        ))}
      </ul>

      {isSelfServePlanDetail(plan) ? (
        subscriptionActive && hasBillingPortal ? (
          <BillingPortalButton
            variant={current ? "secondary" : "primary"}
            size="sm"
            className="mt-5 w-full justify-center"
          >
            {current ? "Manage current plan" : "Change in Dodo"}
          </BillingPortalButton>
        ) : (
          <SubscriptionCheckoutButton
            plan={plan.id}
            variant={current ? "secondary" : "primary"}
            size="sm"
            className="mt-5 w-full justify-center"
          >
            {recoveringCurrentPlan ? retryPlanLabel(latestAttempt?.status) : plan.cta}
          </SubscriptionCheckoutButton>
        )
      ) : (
        <Link
          href="https://github.com/codebanditssss/FuelBorn/issues"
          className="mt-5 inline-flex h-7 w-full items-center justify-center gap-1.5 border border-hairline bg-neutral-800 px-2.5 text-xs font-medium tracking-tight text-foreground transition-colors hover:bg-neutral-700"
        >
          Contact sales
        </Link>
      )}
    </article>
  );
}

function PaymentRecoveryNotice({
  attempt,
  subscriptionStatus,
  hasBillingPortal,
}: {
  attempt: {
    status: string;
    error_code: string | null;
    error_message: string | null;
    invoice_url: string | null;
    receipt_url: string | null;
    updated_at: string;
  };
  subscriptionStatus: string | null | undefined;
  hasBillingPortal: boolean;
}) {
  const failed = ["failed", "cancelled", "requires_payment_method"].includes(attempt.status);
  return (
    <div className="mt-5 border border-amber-400/30 bg-amber-400/10 p-4 text-[12px] leading-relaxed text-amber-100">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-amber-50">
            {failed
              ? "Payment did not complete."
              : `Billing is ${subscriptionStatus ?? attempt.status}.`}
          </div>
          <p className="mt-1 text-amber-100/80">
            {attempt.error_message
              ? `${attempt.error_message} Retry checkout below or update your payment method.`
              : "New pod creation stays locked until Dodo confirms an active subscription. Retry checkout below or update your payment method."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {hasBillingPortal ? (
              <BillingPortalButton size="sm" variant="secondary">
                Update payment method
              </BillingPortalButton>
            ) : null}
            {attempt.invoice_url ? (
              <a
                href={attempt.invoice_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center justify-center gap-1.5 border border-hairline bg-neutral-800 px-2.5 text-xs font-medium tracking-tight text-foreground transition-colors hover:bg-neutral-700"
              >
                <ReceiptText className="h-3 w-3" />
                Invoice
              </a>
            ) : null}
            {attempt.receipt_url ? (
              <a
                href={attempt.receipt_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center justify-center gap-1.5 border border-hairline bg-neutral-800 px-2.5 text-xs font-medium tracking-tight text-foreground transition-colors hover:bg-neutral-700"
              >
                <ReceiptText className="h-3 w-3" />
                Receipt
              </a>
            ) : null}
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-amber-100/50">
            Last billing event {formatDate(attempt.updated_at)}
            {attempt.error_code ? ` · ${attempt.error_code}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function subscriptionBadge(
  subscriptionStatus: string | undefined,
  attemptStatus: string | undefined,
): string {
  const status = attemptStatus ?? subscriptionStatus;
  if (status === "failed") return "Payment failed";
  if (status === "processing") return "Processing";
  if (status === "on_hold") return "On hold";
  if (status === "cancelled") return "Cancelled";
  return "Inactive";
}

function retryPlanLabel(attemptStatus: string | undefined): string {
  if (attemptStatus === "processing") return "Open checkout";
  if (attemptStatus === "cancelled") return "Try again";
  return "Retry payment";
}

function subscriptionLine(status: string, date: string | null | undefined): string {
  const when = formatDate(date);
  if (status === "active" || status === "trialing") {
    return when === "—" ? "Subscription is active." : `Renews on ${when}.`;
  }
  return `Subscription status is ${status}. Manage billing or choose a new plan to create pods.`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
