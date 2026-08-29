import "server-only";
import db, { type UserRow } from "../db";
import { billingLog } from "./logger";

/**
 * Runtime billing config — the single source of truth for every
 * business-tunable knob that should NOT require a redeploy to change.
 *
 * Three-layer lookup (highest priority first):
 *
 *   1. Per-user override   — users.config_overrides_json["key"]
 *                            (NULL row OR missing key → fall through)
 *   2. billing_config table — admin-set via /api/billing/admin/config
 *                            (missing row → fall through)
 *   3. DEFAULTS map (below) — code-side defaults that ship the
 *                            "current spec" behavior
 *
 * Reads are cached in-memory for 30s so the meter tick doesn't query
 * the DB once per pod per minute. Writes invalidate the entire cache.
 *
 * Why JSON-as-string in the value column: SQLite doesn't have a JSON
 * type and we want numbers, booleans, strings, and (occasionally)
 * nested objects in the same column. JSON.parse/stringify is fast
 * enough at our scale.
 *
 * SAFETY: validateValue() runs on every PATCH so an admin can't write
 * a value of the wrong shape (e.g. boolean where a number is expected).
 * If a row in billing_config somehow contains a value that doesn't
 * match the expected shape, getConfig() logs a warning and returns the
 * default — fail-safe, not fail-loud.
 */

// ---------- Defaults map ----------
//
// Every config key MUST be listed here with:
//   - default value
//   - one-line description (shown in the admin UI)
//   - schema kind for validation: 'number' | 'integer' | 'boolean' |
//                                  'string' | 'positive_int' | 'cents'
//
// To add a new tunable: add an entry here AND update the readers in
// pricing.ts / thresholds.ts / etc. New tunables ship with their
// default behavior; no migration needed.

export type ConfigSchema =
  | { kind: "number"; min?: number; max?: number }
  | { kind: "integer"; min?: number; max?: number }
  | { kind: "positive_int" }
  | { kind: "cents" } // non-negative integer
  | { kind: "boolean" }
  | { kind: "string"; pattern?: RegExp };

export type ConfigEntry<T = unknown> = {
  default: T;
  description: string;
  schema: ConfigSchema;
};

// All keys are namespaced. Convention: <area>.<subarea>.<knob>.
export const DEFAULTS = {
  // -------------------- Feature flags --------------------
  "feature.auto_suspend_enabled": {
    default: false,
    description: "Automatically power-stop pods when a user crosses the suspend floor",
    schema: { kind: "boolean" },
  },
  "feature.usage_billing_enabled": {
    default: false,
    description: "Legacy PAYG pod usage meter. Disabled for Dodo subscription billing.",
    schema: { kind: "boolean" },
  },
  "feature.storage_billing_enabled": {
    default: false,
    description: "Daily storage rollup charges stopped/suspended pods",
    schema: { kind: "boolean" },
  },
  "feature.emails_enabled": {
    default: true,
    description: "Send threshold notification emails via Resend",
    schema: { kind: "boolean" },
  },
  "feature.pelican_reconcile_enabled": {
    default: true,
    description: "5-minute Pelican ↔ pod_meter_state drift cross-check",
    schema: { kind: "boolean" },
  },
  "feature.starter_credit_enabled": {
    // Default OFF per user decision: no free starter, user pays $1+ to access.
    default: false,
    description: "Grant starter credit on first signup",
    schema: { kind: "boolean" },
  },
  // -------------------- Managed AI (Pods Managed) credit metering --------------------
  // When enabled, Pods Managed inference is metered: the gateway reports
  // per-request upstream cost back to /api/internal/managed/usage, which
  // debits the user's credit wallet (credit_balances). New managed pods are
  // deployed with a per-user HMAC token so the gateway can attribute usage;
  // when the wallet hits the block floor the gateway hard-blocks inference.
  "feature.managed_billing_enabled": {
    default: false,
    description:
      "Meter Pods Managed AI usage against the credit wallet (mint per-user gateway tokens + hard-block at floor)",
    schema: { kind: "boolean" },
  },
  "managed.markup_multiplier": {
    // 1.5 = charge the user 150% of the real upstream inference cost.
    default: 1.5,
    description:
      "Multiplier applied to the gateway's upstream inference cost before debiting the wallet",
    schema: { kind: "number", min: 1, max: 100 },
  },
  "managed.block_floor_cents": {
    // Wallet balance at or below this blocks new managed inference. 0 = block
    // once the wallet is empty. In-flight requests may push slightly negative.
    default: 0,
    description:
      "Credit-wallet balance (cents) at or below which Pods Managed inference is hard-blocked",
    schema: { kind: "integer", max: 0 },
  },
  // -------------------- Pricing: invoice limits --------------------
  "pricing.invoice.min_usd_cents": {
    // $1 minimum per user clarification on the no-starter-credit decision.
    default: 100,
    description: "Minimum invoice amount in cents",
    schema: { kind: "cents" },
  },
  "pricing.invoice.max_usd_cents": {
    // $1000 per Q3 decision.
    default: 100_000,
    description: "Maximum invoice amount in cents (HD-key blast radius gate)",
    schema: { kind: "cents" },
  },
  "pricing.invoice.max_open_per_user": {
    default: 10,
    description: "Maximum concurrent pending invoices per user",
    schema: { kind: "positive_int" },
  },
  // -------------------- Pricing: starter credit --------------------
  "pricing.starter_credit_cents": {
    // 0 by default; only used when feature.starter_credit_enabled is true.
    default: 0,
    description: "Cents granted to a new user on first verified identity",
    schema: { kind: "cents" },
  },
  // -------------------- Pricing: tier rates (milli-cents/hr) --------------------
  "pricing.tier.nano.rate_milli_cents_per_hour": {
    default: 1200,
    description: "Nano pod hourly rate in milli-cents ($0.012/hr)",
    schema: { kind: "positive_int" },
  },
  "pricing.tier.small.rate_milli_cents_per_hour": {
    default: 2500,
    description: "Small pod hourly rate in milli-cents ($0.025/hr)",
    schema: { kind: "positive_int" },
  },
  "pricing.tier.medium.rate_milli_cents_per_hour": {
    default: 5000,
    description: "Medium pod hourly rate in milli-cents ($0.05/hr)",
    schema: { kind: "positive_int" },
  },
  "pricing.tier.large.rate_milli_cents_per_hour": {
    default: 10_000,
    description: "Large pod hourly rate in milli-cents ($0.10/hr)",
    schema: { kind: "positive_int" },
  },
  "pricing.tier.xlarge.rate_milli_cents_per_hour": {
    default: 20_000,
    description: "Xlarge pod hourly rate in milli-cents ($0.20/hr)",
    schema: { kind: "positive_int" },
  },
  // -------------------- Pricing: storage --------------------
  "pricing.storage.cents_per_gb_month": {
    // $0.10/GB-month per spec. ×10 from the buggy default I had hardcoded
    // earlier — see BILLING_AUDIT.md §1.
    default: 10,
    description: "Storage rate for stopped/suspended pods (cents per GB per month)",
    schema: { kind: "cents" },
  },
  // -------------------- Thresholds --------------------
  "threshold.warn_cents": {
    default: 100,
    description: "Balance below which we send the 'running low' email (cents)",
    schema: { kind: "cents" },
  },
  "threshold.suspend_floor_cents": {
    default: -50,
    description: "Balance below which suspend fires immediately (signed cents)",
    schema: { kind: "integer", max: 0 },
  },
  "threshold.grace_window_seconds": {
    default: 24 * 60 * 60,
    description: "How long a negative balance is tolerated before suspend (seconds)",
    schema: { kind: "positive_int" },
  },
  "threshold.purge_warn_at_seconds": {
    default: 7 * 24 * 60 * 60,
    description: "How long after suspend we send the purge-warning email (seconds)",
    schema: { kind: "positive_int" },
  },
  "threshold.purge_at_seconds": {
    default: 30 * 24 * 60 * 60,
    description: "How long after suspend we delete the pods (seconds)",
    schema: { kind: "positive_int" },
  },
  // -------------------- Cohort pricing (founding members) --------------------
  // Permanent cohort tiers determined by signup order (users.id):
  //
  //   users.id 1..founding_size                    → "founding" cohort:
  //     unlimited free pods, any size, forever. Locked at signup
  //     and grandfathered even if the operator later changes the
  //     cohort sizes.
  //
  //   users.id founding_size+1..founding_size+paid_size → "paid_cohort":
  //     access requires a one-time top-up of paid_unlock_cents. Once
  //     unlocked, same unlimited-free access as founding. Pre-unlock,
  //     blocked from deploying.
  //
  //   users.id > founding_size + paid_size         → "payg":
  //     standard pay-as-you-go (balance must cover deploy + run).
  //
  // The 'feature.cohort_pricing_enabled' flag is the master toggle.
  // When false, every user goes straight to PAYG regardless of id.
  // Useful for emergencies (compute bill spike) or post-cohort cleanup.
  "feature.cohort_pricing_enabled": {
    default: false,
    description: "Master toggle for cohort-based pricing rules",
    schema: { kind: "boolean" },
  },
  "cohort.founding_size": {
    default: 5,
    description: "How many of the first signups get unlimited free pods forever (locked by users.id)",
    schema: { kind: "positive_int" },
  },
  "cohort.paid_size": {
    default: 10,
    description: "How many signups after founding can pay-once to join (locked by users.id)",
    schema: { kind: "positive_int" },
  },
  "cohort.paid_unlock_cents": {
    default: 500,
    description: "One-time cumulative top-up cents needed for paid-cohort users to unlock their free access",
    schema: { kind: "cents" },
  },
  // -------------------- Operations --------------------
  "ops.hot_treasury_cap_cents": {
    // $500 per Q9 decision; sweeper pauses when hot wallet exceeds this.
    default: 50_000,
    description: "Hot treasury balance ceiling; above this, ops alerts",
    schema: { kind: "cents" },
  },
} as const;

export type ConfigKey = keyof typeof DEFAULTS;

/** DEFAULTS is `as const` so each `default` is a literal type (e.g. 100,
 * true). For setConfig/getConfig we want the wider primitive (number,
 * boolean, string) so a caller can write 500 where the default is 100. */
type WidenLiteral<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T;

export type ConfigValue<K extends ConfigKey> = WidenLiteral<
  (typeof DEFAULTS)[K]["default"]
>;

// ---------- In-memory cache ----------
const CACHE_TTL_MS = 30_000;
type CacheEntry = { value: unknown; ts: number };
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): unknown | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return e.value;
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { value, ts: Date.now() });
}

function cacheClear(): void {
  cache.clear();
}

// ---------- Validation ----------

export function validateValue(
  schema: ConfigSchema,
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  switch (schema.kind) {
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true }
        : { ok: false, reason: "expected boolean" };
    case "string": {
      if (typeof value !== "string") return { ok: false, reason: "expected string" };
      if (schema.pattern && !schema.pattern.test(value))
        return { ok: false, reason: `does not match pattern ${schema.pattern}` };
      return { ok: true };
    }
    case "number":
    case "integer":
    case "positive_int":
    case "cents": {
      if (typeof value !== "number") return { ok: false, reason: "expected number" };
      if (!Number.isFinite(value)) return { ok: false, reason: "not finite" };
      if (
        schema.kind === "integer" ||
        schema.kind === "positive_int" ||
        schema.kind === "cents"
      ) {
        if (!Number.isInteger(value))
          return { ok: false, reason: "expected integer" };
      }
      if (schema.kind === "positive_int" && value <= 0)
        return { ok: false, reason: "must be > 0" };
      if (schema.kind === "cents" && value < 0)
        return { ok: false, reason: "must be >= 0" };
      // Optional min/max only on the explicit number/integer kinds.
      if (schema.kind === "number" || schema.kind === "integer") {
        if (schema.min != null && value < schema.min)
          return { ok: false, reason: `must be >= ${schema.min}` };
        if (schema.max != null && value > schema.max)
          return { ok: false, reason: `must be <= ${schema.max}` };
      }
      return { ok: true };
    }
  }
}

// ---------- Per-user override read ----------

function readUserOverride(userId: number, key: string): unknown | undefined {
  const row = db
    .prepare<[number], Pick<UserRow, "config_overrides_json">>(
      `SELECT config_overrides_json FROM users WHERE id = ?`,
    )
    .get(userId);
  if (!row?.config_overrides_json) return undefined;
  try {
    const parsed = JSON.parse(row.config_overrides_json) as Record<
      string,
      unknown
    >;
    if (key in parsed) return parsed[key];
  } catch (err) {
    billingLog.warn("config.user_override.parse_failed", {
      user_id: userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return undefined;
}

// ---------- Public API ----------

/**
 * Read a config value. Per-user override (if userId given) → DB → default.
 *
 * Type is inferred from the DEFAULTS map. Calling getConfig("missing")
 * is a compile-time error.
 *
 * If the DB value fails validation (corrupt write, schema change), this
 * logs a warning and returns the default — never throws.
 */
export function getConfig<K extends ConfigKey>(
  key: K,
  opts: { userId?: number } = {},
): ConfigValue<K> {
  type T = ConfigValue<K>;
  const entry = DEFAULTS[key];

  // 1. Per-user override.
  if (opts.userId != null) {
    const userVal = readUserOverride(opts.userId, key);
    if (userVal !== undefined) {
      const ok = validateValue(entry.schema, userVal);
      if (ok.ok) return userVal as T;
      billingLog.warn("config.user_override.invalid", {
        user_id: opts.userId,
        key,
        reason: ok.reason,
      });
    }
  }

  // 2. Cached DB value.
  const cached = cacheGet(key);
  if (cached !== undefined) return cached as T;

  // 3. Fresh DB read.
  const row = db
    .prepare<[string], { value_json: string }>(
      `SELECT value_json FROM billing_config WHERE key = ?`,
    )
    .get(key);
  if (row) {
    try {
      const parsed = JSON.parse(row.value_json) as unknown;
      const ok = validateValue(entry.schema, parsed);
      if (ok.ok) {
        cacheSet(key, parsed);
        return parsed as T;
      }
      billingLog.warn("config.db_value.invalid", {
        key,
        reason: ok.reason,
      });
    } catch (err) {
      billingLog.warn("config.db_value.parse_failed", {
        key,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Default. Cache so subsequent reads avoid the DB roundtrip too.
  cacheSet(key, entry.default);
  return entry.default as T;
}

/**
 * Set a config value (admin only — caller's responsibility to authorize).
 * Validates against the key's schema. Throws if invalid OR if the key is
 * not in DEFAULTS. Invalidates the cache on success.
 */
export function setConfig<K extends ConfigKey>(args: {
  key: K;
  value: ConfigValue<K>;
  adminId: number;
}): void {
  const entry = DEFAULTS[args.key];
  if (!entry) {
    throw new Error(`unknown config key: ${args.key}`);
  }
  const check = validateValue(entry.schema, args.value);
  if (!check.ok) {
    throw new Error(`invalid value for ${args.key}: ${check.reason}`);
  }
  db.prepare(
    `INSERT INTO billing_config (key, value_json, description, updated_at, updated_by_admin_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at,
       updated_by_admin_id = excluded.updated_by_admin_id`,
  ).run(
    args.key,
    JSON.stringify(args.value),
    entry.description,
    Math.floor(Date.now() / 1000),
    args.adminId,
  );
  cacheClear();
  billingLog.info("config.set", {
    key: args.key,
    admin_id: args.adminId,
  });
}

/**
 * Delete a config value, falling back to the code default.
 */
export function resetConfig(args: {
  key: ConfigKey;
  adminId: number;
}): void {
  if (!(args.key in DEFAULTS)) {
    throw new Error(`unknown config key: ${args.key}`);
  }
  db.prepare(`DELETE FROM billing_config WHERE key = ?`).run(args.key);
  cacheClear();
  billingLog.info("config.reset", {
    key: args.key,
    admin_id: args.adminId,
  });
}

/**
 * List every config key, current effective value, and whether it's
 * been overridden in the DB. For the admin GET endpoint + ops dashboards.
 */
export type ConfigSnapshot = Array<{
  key: ConfigKey;
  description: string;
  schema: ConfigSchema;
  default: unknown;
  effective: unknown;
  overridden: boolean;
  updated_at: number | null;
  updated_by_admin_id: number | null;
}>;

export function snapshotConfig(): ConfigSnapshot {
  const rows = db
    .prepare<
      [],
      {
        key: string;
        value_json: string;
        updated_at: number;
        updated_by_admin_id: number | null;
      }
    >(
      `SELECT key, value_json, updated_at, updated_by_admin_id FROM billing_config`,
    )
    .all();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const keys = Object.keys(DEFAULTS) as ConfigKey[];
  return keys.map((key) => {
    const entry = DEFAULTS[key];
    const dbRow = byKey.get(key);
    let effective: unknown = entry.default;
    if (dbRow) {
      try {
        const parsed = JSON.parse(dbRow.value_json);
        const ok = validateValue(entry.schema, parsed);
        if (ok.ok) effective = parsed;
      } catch {
        // fall through to default
      }
    }
    return {
      key,
      description: entry.description,
      schema: entry.schema,
      default: entry.default,
      effective,
      overridden: !!dbRow,
      updated_at: dbRow?.updated_at ?? null,
      updated_by_admin_id: dbRow?.updated_by_admin_id ?? null,
    };
  });
}

/**
 * Set a per-user override. Pass value=undefined to clear the override
 * for that key. Validates against the key's schema.
 */
export function setUserOverride(args: {
  userId: number;
  key: ConfigKey;
  value: unknown;
}): void {
  const entry = DEFAULTS[args.key];
  if (!entry) throw new Error(`unknown config key: ${args.key}`);
  if (args.value !== undefined) {
    const check = validateValue(entry.schema, args.value);
    if (!check.ok) {
      throw new Error(`invalid value for ${args.key}: ${check.reason}`);
    }
  }
  const row = db
    .prepare<[number], Pick<UserRow, "config_overrides_json">>(
      `SELECT config_overrides_json FROM users WHERE id = ?`,
    )
    .get(args.userId);
  const overrides: Record<string, unknown> = row?.config_overrides_json
    ? (JSON.parse(row.config_overrides_json) as Record<string, unknown>)
    : {};
  if (args.value === undefined) {
    delete overrides[args.key];
  } else {
    overrides[args.key] = args.value;
  }
  const empty = Object.keys(overrides).length === 0;
  db.prepare(`UPDATE users SET config_overrides_json = ? WHERE id = ?`).run(
    empty ? null : JSON.stringify(overrides),
    args.userId,
  );
  cacheClear(); // user override invalidates everyone's reads — cheap to clear all
}

// ---------- Test hook ----------
export const __testing = {
  clearCache: cacheClear,
};
