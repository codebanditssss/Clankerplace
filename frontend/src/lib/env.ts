import "server-only";

/**
 * Centralized env-var validation. Imported at boot to fail fast with a
 * single human-readable error instead of letting the app crash mid-
 * request when a missing var first matters.
 *
 * Two tiers:
 *
 *   REQUIRED_ALWAYS: must be set in every environment. The app refuses
 *     to start without these. Missing → process.exit(1).
 *
 *   REQUIRED_IN_PRODUCTION: must be set when NODE_ENV=production. In
 *     dev mode a missing one prints a one-line warning so a developer
 *     running locally knows what they're skipping (e.g. the Resend key
 *     is harmless in dev; the threshold engine silently no-ops).
 *
 * Usage: import this once at the top of server.mjs OR rely on the
 * route-level imports — most lib/* files already throw at use-time if
 * the env they need is missing. This file is the early-warning system.
 */

type EnvSpec = {
  name: string;
  purpose: string;
};

const REQUIRED_ALWAYS: EnvSpec[] = [
  { name: "SESSION_SECRET", purpose: "signs the pods_session cookie" },
  { name: "PODS_DB_PATH", purpose: "SQLite database path (defaults to ./data/pods.db)" },
];

const REQUIRED_IN_PRODUCTION: EnvSpec[] = [
  { name: "PELICAN_URL", purpose: "Pelican panel base URL" },
  { name: "PELICAN_API_KEY", purpose: "Pelican Application API key" },
  { name: "RESEND", purpose: "Resend API key for transactional emails" },
  { name: "INTERNAL_METER_TOKEN", purpose: "loopback token for the meter tick (or set INTERNAL_RECONCILE_TOKEN)" },
  { name: "DODO_PAYMENTS_API_KEY", purpose: "Dodo Payments API key for subscription and credit checkout" },
  { name: "DODO_PAYMENTS_WEBHOOK_KEY", purpose: "Dodo Payments webhook signing key" },
  { name: "DODO_PRODUCT_DEVELOPER", purpose: "Dodo product ID for the Developer subscription" },
  { name: "DODO_PRODUCT_PRO", purpose: "Dodo product ID for the Pro subscription" },
  { name: "DODO_PRODUCT_SCALE", purpose: "Dodo product ID for the Scale subscription" },
  { name: "DODO_CREDIT_PACK_10", purpose: "Dodo product ID for the $10 credit pack" },
  { name: "DODO_CREDIT_PACK_25", purpose: "Dodo product ID for the $25 credit pack" },
  { name: "DODO_CREDIT_PACK_50", purpose: "Dodo product ID for the $50 credit pack" },
  { name: "DODO_CREDIT_PACK_100", purpose: "Dodo product ID for the $100 credit pack" },
  { name: "PODS_PUBLIC_URL", purpose: "canonical public app origin for billing return URLs" },
];

/**
 * Recommended-in-production env vars. App still runs without them, but
 * specific features won't work — we print a warning per missing one.
 */
const RECOMMENDED_IN_PRODUCTION: EnvSpec[] = [
  { name: "PELICAN_WEBHOOK_SECRET", purpose: "HMAC secret for /api/pelican/webhooks (drift cross-check still works without it)" },
  { name: "BILLING_FROM_EMAIL", purpose: "From: address on billing emails (falls back to AUTH_FROM_EMAIL)" },
  { name: "RESEND_WEBHOOK_SECRET", purpose: "Svix secret for the inbound email webhook (per-pod email feature)" },
  { name: "DODO_PAYMENTS_ENVIRONMENT", purpose: "Dodo Payments environment: test_mode or live_mode (defaults to live_mode)" },
  { name: "BOOTSTRAP_ADMIN_EMAIL", purpose: "operator email auto-promoted to is_admin=1 at boot + signup (no manual SQL needed)" },
  { name: "MONAD_RPC_URL", purpose: "Monad JSON-RPC endpoint for AgentFunded events" },
  { name: "MONAD_CHAIN_ID", purpose: "expected Monad network chain ID" },
  { name: "FUELBORN_CONTRACT_ADDRESS", purpose: "deployed FuelBorn contract address" },
  { name: "FUELBORN_CONTRACT_DEPLOY_BLOCK", purpose: "first block the funding indexer scans" },
  { name: "FUEL_PER_MON", purpose: "whole FUEL units credited for one MON" },
  { name: "FUELBORN_MIN_FORGE_DEPOSIT_WEI", purpose: "minimum initial MON deposit accepted by registerAgent" },
  { name: "FUELBORN_IDLE_BURN_MICRO_FUEL_PER_SECOND", purpose: "integer idle burn rate for newly forged agents (defaults to 278)" },
];

export type EnvValidationResult = {
  ok: boolean;
  missing_required: string[];
  missing_in_production: string[];
  missing_recommended: string[];
  messages: string[];
};

/**
 * Pure check — returns the result; does NOT exit. Used by the test
 * suite and by validateEnvOrExit() below.
 */
export function checkEnv(
  env: NodeJS.ProcessEnv = process.env,
): EnvValidationResult {
  const messages: string[] = [];
  const missingRequired: string[] = [];
  const missingProd: string[] = [];
  const missingRec: string[] = [];

  for (const spec of REQUIRED_ALWAYS) {
    if (!isSet(env[spec.name])) {
      missingRequired.push(spec.name);
      messages.push(`[env] MISSING ${spec.name} — ${spec.purpose}`);
    }
  }

  const isProd = env.NODE_ENV === "production";
  for (const spec of REQUIRED_IN_PRODUCTION) {
    if (!isSet(env[spec.name])) {
      // Special case: INTERNAL_METER_TOKEN OR INTERNAL_RECONCILE_TOKEN
      // satisfies the meter requirement.
      if (
        spec.name === "INTERNAL_METER_TOKEN" &&
        isSet(env.INTERNAL_RECONCILE_TOKEN)
      ) {
        continue;
      }
      if (isProd) {
        missingProd.push(spec.name);
        messages.push(`[env] MISSING ${spec.name} — ${spec.purpose}`);
      } else {
        messages.push(
          `[env] dev: ${spec.name} is not set — ${spec.purpose}. Features using it will no-op.`,
        );
      }
    }
  }

  for (const spec of RECOMMENDED_IN_PRODUCTION) {
    if (isProd && !isSet(env[spec.name])) {
      missingRec.push(spec.name);
      messages.push(
        `[env] recommended: ${spec.name} is not set — ${spec.purpose}`,
      );
    }
  }

  const ok = missingRequired.length === 0 && missingProd.length === 0;
  return {
    ok,
    missing_required: missingRequired,
    missing_in_production: missingProd,
    missing_recommended: missingRec,
    messages,
  };
}

function isSet(v: string | undefined): boolean {
  return typeof v === "string" && v.length > 0;
}

/**
 * Validate, log the result, and exit(1) on failure. Call once at boot.
 */
export function validateEnvOrExit(): void {
  const r = checkEnv();
  for (const m of r.messages) {
    if (m.includes("MISSING")) console.error(m);
    else console.warn(m);
  }
  if (!r.ok) {
    console.error(
      "[env] Refusing to start with missing required env vars. " +
        "Set them in .env.local (dev) or your process supervisor (prod) and retry.",
    );
    process.exit(1);
  }
}
