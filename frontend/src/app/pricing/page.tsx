import Link from "next/link";
import type { ReactNode } from "react";
import { Check, HardDrive, MessageCircle, Terminal } from "lucide-react";
import { SiteHeader } from "@/components/landing/site-header";
import { FooterCta } from "@/components/landing/footer-cta";
import { SubscriptionCheckoutButton } from "@/components/billing/billing-actions";
import { DISCORD_INVITE_URL } from "@/lib/external-links";
import {
  PLAN_DETAILS,
  isSelfServePlanDetail,
  type BillingPlanDetail,
} from "@/lib/billing/plan-details";

export const metadata = {
  title: "Pricing - FuelBorn",
  description:
    "Subscription plans for one-click AI-agent pods, automations, sandboxes, and game servers.",
};

export const dynamic = "force-dynamic";

const CREDIT_PACKS = ["$10", "$25", "$50", "$100"];

export default function PricingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-12 md:py-20">
        <header className="border-b border-hairline pb-10">
          <span className="micro text-neutral-500">Pricing</span>
          <h1 className="display mt-4 text-[clamp(2.25rem,5vw,3.75rem)] leading-[0.95] text-foreground">
            Subscription-first pods<span className="text-signal">.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[14px] leading-relaxed text-neutral-300">
            Choose a plan before creating new pods. Existing pods remain
            available, but new deployments and resource upgrades require an
            active subscription.
          </p>
        </header>

        <section className="mt-10 grid gap-px border border-hairline bg-hairline xl:grid-cols-4">
          {PLAN_DETAILS.map((plan) => (
            <PricingPlanCard key={plan.id} plan={plan} />
          ))}
        </section>

        <section className="mt-10 grid gap-px border border-hairline bg-hairline md:grid-cols-[1.4fr_1fr]">
          <div className="bg-neutral-900 p-6">
            <div className="micro text-neutral-500">AI credits wallet</div>
            <h2 className="mt-3 font-display text-[24px] leading-tight text-foreground">
              Buy credits separately when you need them.
            </h2>
            <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-neutral-400">
              Credits are stored as account balance in cents. They are not tied
              to BYOK usage in this branch; future Pods Managed AI work can
              consume the same wallet balance.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-hairline md:grid-cols-4">
            {CREDIT_PACKS.map((pack) => (
              <div key={pack} className="bg-neutral-900 p-5 text-center">
                <div className="font-mono text-[22px] text-foreground">{pack}</div>
                <div className="mt-1 text-[11px] text-neutral-500">credit pack</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-px border border-hairline bg-hairline md:grid-cols-3">
          <InfoTile
            icon={<HardDrive className="h-4 w-4" />}
            title="Grandfathered pods"
            text="Users without a subscription can view, start, and stop existing pods. New pods require an active plan."
          />
          <InfoTile
            icon={<Terminal className="h-4 w-4" />}
            title="BYOK stays primary"
            text="Bring your own OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, or other supported provider key."
          />
          <InfoTile
            icon={<MessageCircle className="h-4 w-4" />}
            title="Support"
            text="Need help with setup, custom limits, procurement, or support terms?"
            action={
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <a
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-signal hover:underline"
                >
                  Join Discord
                </a>
                <Link href="https://github.com/codebanditssss/FuelBorn/issues" className="text-signal hover:underline">
                  Email support
                </Link>
              </span>
            }
          />
        </section>
      </main>
      <FooterCta />
    </div>
  );
}

function PlanMetric({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="bg-neutral-950 p-3">
      <div className="flex items-center gap-1.5 text-neutral-500">{icon}</div>
      <div className="mt-2 font-mono text-[14px] tabular text-foreground">{value}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-neutral-600">
        {label}
      </div>
    </div>
  );
}

function PricingPlanCard({ plan }: { plan: BillingPlanDetail }) {
  return (
    <article className="flex min-h-full flex-col bg-neutral-900 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[26px] leading-tight text-foreground">
            {plan.name}
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
            {plan.audience}
          </p>
        </div>
        {plan.badge ? (
          <span className="border border-signal/40 bg-signal/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-signal">
            {plan.badge}
          </span>
        ) : null}
      </div>

      <div className="mt-6 font-mono text-[30px] font-medium leading-none tabular text-foreground">
        {plan.price}
      </div>

      <div className="mt-5 grid gap-px border border-hairline bg-hairline">
        <div className="bg-neutral-950 p-3">
          <div className="micro text-neutral-500">Pods</div>
          <div className="mt-2 text-[13px] text-foreground">{plan.podLimit}</div>
        </div>
        <div className="bg-neutral-950 p-3">
          <div className="micro text-neutral-500">Resources</div>
          <div className="mt-2 text-[13px] text-foreground">{plan.resources}</div>
        </div>
      </div>

      <ul className="mt-6 flex-1 space-y-2 border-t border-hairline pt-5 text-[12px] text-neutral-300">
        {plan.features.map((feature) => (
          <li key={feature} className="flex min-w-0 gap-2" title={feature}>
            <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-live" />
            <span className="min-w-0 truncate whitespace-nowrap">{feature}</span>
          </li>
        ))}
      </ul>

      {isSelfServePlanDetail(plan) ? (
        <SubscriptionCheckoutButton
          plan={plan.id}
          className="mt-6 w-full"
        >
          {plan.cta}
        </SubscriptionCheckoutButton>
      ) : (
        <Link
          href="https://github.com/codebanditssss/FuelBorn/issues"
          className="mt-6 inline-flex h-9 w-full items-center justify-center gap-2 bg-foreground px-3.5 text-sm font-medium tracking-tight text-background transition-colors hover:bg-signal hover:text-neutral-950"
        >
          {plan.cta}
        </Link>
      )}
    </article>
  );
}

function InfoTile({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-neutral-900 p-5">
      <div className="text-neutral-500">{icon}</div>
      <h3 className="mt-4 text-[14px] font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">{text}</p>
      {action ? <div className="mt-3 text-[12px]">{action}</div> : null}
    </div>
  );
}
