import "server-only";
import type { TierSlug } from "../db";
import { getConfig } from "./config";

/**
 * Pricing tiers — single source of truth. Imported by:
 *   - the deploy handler to record rate at provision time
 *   - the meter tick to compute owed cents per pod-minute
 *   - the billing UI to show rates in the wizard and balance card
 *   - the /pricing page (Phase 5)
 *
 * Rates are stored in **milli-cents per hour** (thousandths of a US cent
 * per hour). The integer-only representation dodges any float drift in
 * the metering math — see meter.ts for the carry-in-micro-cents trick
 * that closes the rounding loop.
 *
 *   $0.012/hr → 1.2 cents/hr → 1200 milli-cents/hr
 *
 * RAM is in MiB (Pelican's native unit), disk in MiB, CPU in Pelican's
 * "percent of one core" (50 = half a vCPU, 200 = 2 vCPUs).
 *
 * The tier table is also the *floor* — a pod whose Pelican limits land
 * between two tiers rounds up. Catches the case where someone resizes
 * a pod's RAM via the admin panel without going through our deploy
 * flow; we still bill the next tier up.
 */

export type Tier = {
  slug: TierSlug;
  label: string;
  ramMib: number;
  diskMib: number;
  cpuPercent: number;
  rateMilliCentsPerHour: number;
  /** For UI; the doc says monthly = hourly × 730. We round to whole cents. */
  monthlyCents: number;
};

const HOURS_PER_MONTH = 730;

function monthlyCentsFromRate(rateMilliPerHour: number): number {
  return Math.round((rateMilliPerHour * HOURS_PER_MONTH) / 1000);
}

/**
 * Tier specs — RAM/CPU/disk are fixed (deploy-time wiring depends on them
 * via pod-types.ts), but the per-hour rate reads from billing_config on
 * every call so an admin can adjust pricing live via /admin/config
 * without a deploy.
 *
 * Use getTiers() / getTierBySlug() (functions, not exported constants)
 * so callers can't accidentally cache a stale rate from process start.
 * The config layer's own 30s cache prevents this from being expensive.
 */

const TIER_SPECS: Omit<Tier, "rateMilliCentsPerHour" | "monthlyCents">[] = [
  { slug: "nano",   label: "Nano",   ramMib: 1024,      diskMib: 5  * 1024, cpuPercent: 50  },
  { slug: "small",  label: "Small",  ramMib: 2  * 1024, diskMib: 10 * 1024, cpuPercent: 100 },
  { slug: "medium", label: "Medium", ramMib: 4  * 1024, diskMib: 20 * 1024, cpuPercent: 200 },
  { slug: "large",  label: "Large",  ramMib: 8  * 1024, diskMib: 40 * 1024, cpuPercent: 400 },
  { slug: "xlarge", label: "Xlarge", ramMib: 16 * 1024, diskMib: 80 * 1024, cpuPercent: 800 },
];

function rateForTier(slug: TierSlug): number {
  switch (slug) {
    case "nano":   return getConfig("pricing.tier.nano.rate_milli_cents_per_hour");
    case "small":  return getConfig("pricing.tier.small.rate_milli_cents_per_hour");
    case "medium": return getConfig("pricing.tier.medium.rate_milli_cents_per_hour");
    case "large":  return getConfig("pricing.tier.large.rate_milli_cents_per_hour");
    case "xlarge": return getConfig("pricing.tier.xlarge.rate_milli_cents_per_hour");
  }
}

export function getTiers(): Tier[] {
  return TIER_SPECS.map((spec) => {
    const rate = rateForTier(spec.slug);
    return {
      ...spec,
      rateMilliCentsPerHour: rate,
      monthlyCents: monthlyCentsFromRate(rate),
    };
  });
}

export function getTierBySlug(slug: TierSlug): Tier {
  const spec = TIER_SPECS.find((t) => t.slug === slug);
  if (!spec) throw new Error(`unknown tier: ${slug}`);
  const rate = rateForTier(slug);
  return {
    ...spec,
    rateMilliCentsPerHour: rate,
    monthlyCents: monthlyCentsFromRate(rate),
  };
}

/** Legacy exports — kept for callers that captured them at module load.
 * NEW code should call getTiers() / getTierBySlug() so config changes
 * are picked up live. These eagerly read config at first import and
 * therefore won't reflect runtime config edits until process restart. */
export const TIERS: Tier[] = getTiers();
export const TIER_BY_SLUG: Record<TierSlug, Tier> = Object.fromEntries(
  TIERS.map((t) => [t.slug, t]),
) as Record<TierSlug, Tier>;

/** Find the tier that contains a pod with the given RAM. Rounds UP — a
 * pod with 1.5 GB RAM is billed at the `small` (2 GB) tier, not `nano`.
 * Always returns a tier; pods bigger than xlarge get xlarge (logged so an
 * admin can decide to extend the tier list).
 *
 * Reads tier rates fresh from config so a price change applies to the
 * next deploy without restart. */
export function tierFromRam(ramMib: number): Tier {
  const tiers = getTiers();
  if (!Number.isFinite(ramMib) || ramMib <= 0) return tiers[0];
  for (const t of tiers) {
    if (ramMib <= t.ramMib) return t;
  }
  // Bigger than xlarge — billed as xlarge until we add a new tier.
  return tiers[tiers.length - 1];
}

/** Storage charge for a stopped/suspended pod, per day, in milli-cents.
 *
 * Rate is in `pricing.storage.cents_per_gb_month` (default 10 = $0.10/GB-mo
 * per spec) and is admin-tunable live.
 *
 *   centsPerGbMo / 30 days × 1000 milli/cent = milli-cents per GB-day
 *
 * Example: 20 GB at 10 cents/GB-mo:
 *   20 × 10 × 1000 / 30 = 6_667 milli-cents/day
 *   = 6.667 cents/day → ~$2.00 / month ✓
 *
 * Rounded UP so we never accidentally charge zero. The cent-rounding
 * in storage.ts adds at most $0.01/pod/day overcharge.
 *
 * HISTORICAL: an earlier version returned 1/100th the correct value
 * (used `diskGb * 100 / 30`, missing a factor of 100 — the rate-per-month
 * was conflated with the rate-per-day). If your DB has storage entries
 * from before the fix, they're underbilled. */
export function storageMilliCentsPerDay(diskMib: number): number {
  const diskGb = diskMib / 1024;
  const centsPerGbMo = getConfig("pricing.storage.cents_per_gb_month");
  return Math.ceil((diskGb * centsPerGbMo * 1000) / 30);
}

/** Human-readable hourly rate string for the UI. */
export function formatRate(rateMilliPerHour: number): string {
  const dollarsPerHour = rateMilliPerHour / 100_000;
  return `$${dollarsPerHour.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}/hr`;
}

/** Daily burn for a set of running pods, in cents. Used by the balance
 * endpoint to compute `runway_days`. */
export function burnPerDayCents(runningRates: number[]): number {
  // sum of rates (milli-cents/hour) × 24h → milli-cents per day → /1000 → cents
  const totalMilliPerHour = runningRates.reduce((s, r) => s + r, 0);
  return Math.floor((totalMilliPerHour * 24) / 1000);
}
