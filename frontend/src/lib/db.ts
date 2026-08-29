import "server-only";
import Database, { type Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { allowedAdminEmails } from "./admin-allowlist";

const DB_PATH = process.env.PODS_DB_PATH ?? "./data/pods.db";

export type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  pelican_user_id: number;
  pelican_client_token: string | null;
  email_verified_at: string | null;
  /** 0 (default) or 1. Gates /api/billing/admin/* and any future admin UI. */
  is_admin: number;
  /** NULL when KYC is not required for this user. */
  kyc_status: string | null;
  /** NULL = no gate. If set, invoice creation above lifetime-total this
   * amount of cents is blocked until kyc_status = 'verified'. */
  kyc_threshold_cents: number | null;
  /** Cents of one-time promo (signup + redeemed codes). >0 means the
   * "first identity bonus" was already granted; prevents double-grants
   * when a wallet-only user links an email. */
  promo_credits_received: number;
  /** Opaque per-user referral code. NULL until generated on first read. */
  referral_code: string | null;
  /** JSON object of per-user billing-config overrides (Layer 3 in the
   * config architecture). NULL = no overrides; lookups fall through to
   * the billing_config table then to code-side defaults. */
  config_overrides_json: string | null;
  /** Short uuid of the pod the user has claimed as their one free pod.
   * NULL = quota unused (a future deploy will claim it). When the
   * matching pod is deleted, this is reset to NULL so the user can
   * claim a new free slot. Only applies to founding + paid-cohort-
   * unlocked users; PAYG users ignore this. */
  cohort_free_pod_uuid_short: string | null;
  /** 'user' | 'support' | 'finance' | 'admin'. v1 only reads 'admin' vs other. */
  role: string;
  /** ISO timestamp; NULL = active. */
  suspended_at: string | null;
  suspended_reason: string | null;
  /** ISO timestamp of the most recent successful login. */
  last_login_at: string | null;
  /** Unix-seconds revocation cutoff; sessions with iat < this are dead. */
  session_min_iat: number | null;
  created_at: string;
};

export type AdminAuditLogRow = {
  id: number;
  actor_user_id: number;
  action: string;
  target_type: string;
  target_id: string | null;
  before_json: string | null;
  after_json: string | null;
  ip: string | null;
  user_agent: string | null;
  ts: number;
};

export type AdminImpersonationRow = {
  id: number;
  admin_user_id: number;
  target_user_id: number;
  token_hash: string;
  reason: string | null;
  started_at: number;
  expires_at: number;
  ended_at: number | null;
  ip: string | null;
};

export type PendingSignupRow = {
  id: number;
  email: string;
  password_hash: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  last_sent_at: string;
  created_at: string;
};

export type OauthIdentityRow = {
  id: number;
  user_id: number;
  provider: "google" | "github";
  provider_user_id: string;
  email_at_link: string | null;
  created_at: string;
};

export type PasswordResetRow = {
  id: number;
  user_id: number;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
  last_sent_at: string;
  created_at: string;
};

export type AccountEmailLoginMigrationRow = {
  user_id: number;
  email: string;
  password_hash: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  last_sent_at: string;
  created_at: string;
};

export type PodDomainRow = {
  id: number;
  slug: string;
  pod_uuid_short: string;
  pod_full_uuid: string;
  port: number;
  user_id: number;
  container_ip: string | null;
  kind: "auto" | "manual";
  /** Bearer token the pod uses to call the per-pod email-send proxy.
   * Set on auto-domains for hermes pods; null for everything else. */
  pod_email_token: string | null;
  created_at: string;
};

export type PodEmailRow = {
  id: number;
  pod_uuid_short: string;
  resend_email_id: string | null;
  direction: "in" | "out";
  from_addr: string;
  to_addr: string;
  subject: string;
  text: string | null;
  html: string | null;
  headers_json: string | null;
  in_reply_to: string | null;
  message_id: string | null;
  received_at: string | null;
  sent_at: string | null;
  error: string | null;
  created_at: string;
};

// --- Legacy invoice billing tables ---

export type WalletIdentityRow = {
  id: number;
  user_id: number;
  /** Legacy wallet address, 32-44 chars. UNIQUE. */
  address: string;
  is_primary: number;
  created_at: string;
};

/** One-shot sign-in nonces. Deleted on use, TTL ~5 min. */
export type WalletNonceRow = {
  address: string;
  nonce: string;
  /** unix seconds */
  expires_at: number;
  created_at: string;
};

export type InvoiceStatus =
  | "pending" // created, awaiting payment
  | "confirmed" // tx detected + finalized, credit applied, funds still on invoice keypair
  | "swept" // funds moved to treasury, key wiped
  | "expired" // quote window passed, no tx detected
  | "underpaid" // tx detected but amount < required
  | "overpaid" // tx detected but amount > required (credited at requested USD)
  | "failed"; // system error during confirm/sweep — needs human review

export type InvoiceCurrency = "SOL" | "USDC" | "USDT";

export type InvoiceRow = {
  id: string; // uuid v4
  user_id: number;
  usd_amount_cents: number;
  currency: InvoiceCurrency;
  /** Lamports (SOL) or token base units (USDC/USDT, 6 decimals). Stored as TEXT to dodge JS bigint friction. */
  token_amount: string;
  /** base58 pubkey of the per-invoice deposit address. UNIQUE. */
  deposit_address: string;
  /** base58 pubkey of the treasury. */
  treasury_address: string;
  /** USD price quote used (e.g. "215.34" for SOL/USD at quote time). */
  price_quote_usd: string;
  /** unix seconds when the quote becomes invalid for new payments. */
  quote_expires_at: number;
  status: InvoiceStatus;
  /** Legacy payment transaction signature, set on confirm. */
  payment_tx_signature: string | null;
  /** Wallet that paid (base58), set on confirm. */
  payer_address: string | null;
  /** Actual lamports/base-units received (may differ from token_amount on over/under). */
  received_amount: string | null;
  /** Legacy treasury sweep transaction signature, set on sweep. */
  sweep_tx_signature: string | null;
  /** Legacy refund transaction signature, if any. */
  refund_tx_signature: string | null;
  /** unix seconds */
  confirmed_at: number | null;
  swept_at: number | null;
  failed_reason: string | null;
  created_at: number;
  updated_at: number;
};

/** Encrypted private key for an invoice deposit address. AES-256-GCM. */
export type InvoiceKeypairRow = {
  invoice_id: string;
  /** base58 pubkey (matches invoices.deposit_address). */
  public_key: string;
  /** 12-byte AES-GCM IV, hex encoded. */
  iv_hex: string;
  /** 16-byte AES-GCM auth tag, hex encoded. */
  auth_tag_hex: string;
  /** AES-256-GCM ciphertext of the 64-byte ed25519 secret key, hex encoded. */
  ciphertext_hex: string;
  /** Set when the key is wiped after sweep. NULL = still present. */
  wiped_at: number | null;
  created_at: number;
};

export type LedgerReason =
  | "invoice_credit" // +ve: paid invoice
  | "refund" // -ve: refund issued
  | "manual_adjustment" // +/-: admin override
  | "pod_hour" // -ve: usage burn (per-minute meter)
  | "storage" // -ve: stopped-pod storage charge (daily rollup)
  | "egress" // -ve: outbound bandwidth above free tier (daily rollup)
  | "referral" // +ve: referrer/referee reward
  | "promo"; // +ve: signup bonus / promo code redemption

export type CreditLedgerRow = {
  id: number;
  user_id: number;
  /** Positive = credit, negative = burn. USD cents. */
  delta_cents: number;
  reason: LedgerReason;
  ref_invoice_id: string | null;
  ref_pod_uuid: string | null;
  note: string | null;
  /** unix seconds */
  ts: number;
};

// --- Phase 0+1 billing (metering, thresholds, admin, promos) ---

/** Tier slug — must match frontend/src/lib/billing/pricing.ts SIZES. */
export type TierSlug = "nano" | "small" | "medium" | "large" | "xlarge";

/** Live billing state of a single pod. The metering tick walks all rows
 * with state='running' once a minute and debits the user's ledger for the
 * elapsed time. State transitions are driven by /api/deploy (provisioning),
 * /api/pods/[uuid]/power (running/stopped), DELETE /api/pods/[uuid]
 * (deleted), and the thresholds engine (suspended → stopped + suspend
 * email; running → suspended when balance crosses the cutoff).
 *
 * `rate_milli_cents_per_hour` is the per-tier hourly rate in thousandths
 * of a cent (so nano $0.012/hr = 1200, xlarge $0.20/hr = 20000). Keeping
 * the rate as an integer dodges float drift in the meter math.
 *
 * `sub_micro_cents` is the carry of fractional cents owed but not yet
 * debited, in micro-cents (millionths of a cent). Accrues on every tick;
 * settles into a whole-cent debit when it crosses 1_000_000. Total drift
 * over a year is bounded by ~0.5 cents/pod from the round-per-tick. */
export type PodMeterState = {
  pod_uuid_short: string;
  pod_full_uuid: string;
  user_id: number;
  tier_slug: TierSlug;
  rate_milli_cents_per_hour: number;
  ram_mib: number;
  disk_mib: number;
  cpu_percent: number;
  state:
    | "provisioning"
    | "running"
    | "stopped"
    | "suspended"
    | "deleted";
  /** unix seconds — the last moment we billed up to. */
  last_billed_at: number;
  /** carry in micro-cents (10^-6 USD cents). */
  sub_micro_cents: number;
  created_at: number;
  updated_at: number;
};

/** Per-user warn/grace/suspend/purge state machine bookkeeping. One row
 * per user (lazy-inserted on first threshold evaluation). All timestamps
 * are unix seconds; NULL = not in that state. */
export type UserBillingStateRow = {
  user_id: number;
  /** Time we sent the "running low" email. NULL if not yet sent (or if
   * the balance has since climbed back over the threshold, in which case
   * we clear this so a future drop re-fires once). */
  warn_low_sent_at: number | null;
  /** Time the 24h grace clock started (balance crossed below 0). */
  grace_started_at: number | null;
  /** Time we power-stopped the user's pods. */
  suspended_at: number | null;
  /** Time we emailed the 23-day data-deletion warning (7d after suspend). */
  purge_warned_at: number | null;
  /** Time we deleted the pods (30d after suspend). Terminal. */
  purged_at: number | null;
  updated_at: number;
};

export type PromoCodeRow = {
  code: string;
  amount_cents: number;
  /** NULL = unlimited; otherwise hard cap on total redemptions. */
  max_redemptions: number | null;
  redemptions: number;
  expires_at: number | null;
  created_at: number;
};

export type PromoRedemptionRow = {
  id: number;
  code: string;
  user_id: number;
  /** FK into credit_ledger so the redemption is auditable. */
  ledger_id: number;
  redeemed_at: number;
};

export type ReferralRow = {
  id: number;
  referrer_user_id: number;
  referee_user_id: number;
  reward_referrer_ledger_id: number | null;
  reward_referee_ledger_id: number | null;
  status: "pending" | "rewarded" | "denied";
  created_at: number;
  rewarded_at: number | null;
};

export type SubscriptionRow = {
  id: number;
  user_id: number;
  dodo_customer_id: string | null;
  dodo_subscription_id: string | null;
  plan: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  cancelled_at: string | null;
  renewal_date: string | null;
  provider_updated_at: string | null;
  created_at: string;
  updated_at: string;
  raw_status_payload_json: string | null;
};

export type BillingCustomerRow = {
  id: number;
  user_id: number;
  dodo_customer_id: string;
  email: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string | null;
};

export type BillingEventRow = {
  id: number;
  user_id: number | null;
  provider: string;
  provider_event_id: string;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  processed_at: string;
  payload_json: string;
};

export type DodoPaymentAttemptRow = {
  id: number;
  user_id: number | null;
  dodo_payment_id: string | null;
  dodo_checkout_session_id: string | null;
  dodo_subscription_id: string | null;
  dodo_customer_id: string | null;
  product_id: string | null;
  intent: string | null;
  plan: string | null;
  status: string;
  event_type: string;
  error_code: string | null;
  error_message: string | null;
  invoice_url: string | null;
  receipt_url: string | null;
  provider_updated_at: string | null;
  raw_payload_json: string | null;
  created_at: string;
  updated_at: string;
};

export type DodoWebhookEventRow = {
  id: number;
  webhook_id: string;
  event_type: string | null;
  received_at: string;
  processed_at: string | null;
  processing_status: "received" | "processed" | "ignored" | "failed";
  payload_hash: string;
  error: string | null;
};

export type CreditBalanceRow = {
  id: number;
  user_id: number;
  balance_cents: number;
  currency: string;
  created_at: string;
  updated_at: string;
};

export type CreditTransactionRow = {
  id: number;
  user_id: number;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  currency: string;
  dodo_payment_id: string | null;
  dodo_checkout_session_id: string | null;
  billing_event_id: number | null;
  description: string | null;
  created_at: string;
  metadata_json: string | null;
  managed_request_id?: string | null;
};

let _db: DB | null = null;

function getDb(): DB {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      pelican_user_id INTEGER NOT NULL,
      pelican_client_token TEXT,
      email_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Holds rows for users who have started signup but not yet typed
    -- the OTP we emailed them. We only create the Pelican user + insert
    -- into the users table on successful verification.
    CREATE TABLE IF NOT EXISTS pending_signups (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      email          TEXT NOT NULL UNIQUE,
      password_hash  TEXT NOT NULL,
      code_hash      TEXT NOT NULL,
      expires_at     TEXT NOT NULL,
      attempts       INTEGER NOT NULL DEFAULT 0,
      last_sent_at   TEXT NOT NULL DEFAULT (datetime('now')),
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- One unconsumed reset code per user at a time; new requests overwrite.
    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL UNIQUE,
      code_hash     TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      consumed_at   TEXT,
      last_sent_at  TEXT NOT NULL DEFAULT (datetime('now')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- OTP state for logged-in legacy wallet-only users adding normal
    -- email/password auth after wallet sign-in retirement.
    CREATE TABLE IF NOT EXISTS account_email_login_migrations (
      user_id       INTEGER PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      code_hash     TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_sent_at  TEXT NOT NULL DEFAULT (datetime('now')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_account_email_login_migrations_exp
      ON account_email_login_migrations(expires_at);
    -- One row per (provider, provider_user_id). One local user may have
    -- multiple identities (e.g. linked both Google and GitHub). Lookup
    -- by (provider, provider_user_id) is the fast path on every OAuth
    -- sign-in; by user_id when listing linked providers.
    CREATE TABLE IF NOT EXISTS oauth_identities (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL,
      provider         TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      email_at_link    TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, provider_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_identities(user_id);
    CREATE TABLE IF NOT EXISTS pod_domains (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      slug            TEXT NOT NULL UNIQUE,
      pod_uuid_short  TEXT NOT NULL,
      pod_full_uuid   TEXT NOT NULL,
      port            INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      container_ip    TEXT,
      kind            TEXT NOT NULL DEFAULT 'manual',
      pod_email_token TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pod_domains_pod ON pod_domains(pod_uuid_short);
    CREATE INDEX IF NOT EXISTS idx_pod_domains_user ON pod_domains(user_id);
    -- One port per pod can only carry one domain — second attempts hit
    -- this unique constraint and the API surfaces a 409.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_domains_pod_port_uniq
      ON pod_domains(pod_uuid_short, port);

    -- Managed-email history. Each row is one inbound or outbound message
    -- tied to a pod via pod_uuid_short. We keep our own copy (plus the
    -- 30-day window Resend retains) so the in-app Email tab can render
    -- past conversations without a network call. The Resend email id
    -- doubles as our idempotency key on inbound: we look it up on
    -- webhook arrival and skip insertion if it's a redelivery.
    CREATE TABLE IF NOT EXISTS pod_emails (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      pod_uuid_short  TEXT NOT NULL,
      resend_email_id TEXT,
      direction       TEXT NOT NULL CHECK (direction IN ('in','out')),
      from_addr       TEXT NOT NULL,
      to_addr         TEXT NOT NULL,
      subject         TEXT NOT NULL DEFAULT '',
      text            TEXT,
      html            TEXT,
      headers_json    TEXT,
      in_reply_to     TEXT,
      message_id      TEXT,
      received_at     TEXT,
      sent_at         TEXT,
      error           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pod_emails_pod_time
      ON pod_emails(pod_uuid_short, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_emails_resend_id
      ON pod_emails(resend_email_id)
      WHERE resend_email_id IS NOT NULL;

    -- ---------------- Legacy invoice billing ----------------
    -- Wallet addresses linked to a user. Same shape as oauth_identities but
    -- keyed on (address) since a base58 pubkey is already globally unique.
    -- A user may link multiple wallets; is_primary is informational (the UI
    -- picks one to display, but every linked wallet can sign in).
    CREATE TABLE IF NOT EXISTS wallet_identities (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      address     TEXT NOT NULL UNIQUE,
      is_primary  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_identities_user ON wallet_identities(user_id);

    -- One-shot sign-in nonces, keyed by wallet address. PRIMARY KEY on
    -- address gives us free upsert semantics for "regenerate nonce".
    -- expires_at is unix seconds (numeric for cheap range scans).
    CREATE TABLE IF NOT EXISTS wallet_nonces (
      address     TEXT PRIMARY KEY,
      nonce       TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_nonces_exp ON wallet_nonces(expires_at);

    -- Invoices. token_amount kept as TEXT to avoid JS-number precision
    -- loss on USDC/USDT (6 decimals, but invoice amounts in base units can
    -- exceed 2^53). status is one of the InvoiceStatus union variants.
    -- Times in unix-seconds INTEGER for cheap reconciler scans.
    CREATE TABLE IF NOT EXISTS invoices (
      id                    TEXT PRIMARY KEY,
      user_id               INTEGER NOT NULL,
      usd_amount_cents      INTEGER NOT NULL,
      currency              TEXT NOT NULL CHECK (currency IN ('SOL','USDC','USDT')),
      token_amount          TEXT NOT NULL,
      deposit_address       TEXT NOT NULL UNIQUE,
      treasury_address      TEXT NOT NULL,
      price_quote_usd       TEXT NOT NULL,
      quote_expires_at      INTEGER NOT NULL,
      status                TEXT NOT NULL CHECK (status IN ('pending','confirmed','swept','expired','underpaid','overpaid','failed')),
      payment_tx_signature  TEXT UNIQUE,
      payer_address         TEXT,
      received_amount       TEXT,
      sweep_tx_signature    TEXT UNIQUE,
      confirmed_at          INTEGER,
      swept_at              INTEGER,
      failed_reason         TEXT,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, quote_expires_at);
    CREATE INDEX IF NOT EXISTS idx_invoices_deposit ON invoices(deposit_address);

    -- Encrypted ed25519 secret key for each invoice's deposit address.
    -- The key is generated once at quote time, encrypted with AES-256-GCM
    -- using INVOICE_KEY_ENCRYPTION_KEY (32-byte hex master key), and wiped
    -- after sweep. ciphertext_hex stores the 64-byte secretKey from
    -- Raw legacy payment keypair secret bytes.
    CREATE TABLE IF NOT EXISTS invoice_keypairs (
      invoice_id      TEXT PRIMARY KEY,
      public_key      TEXT NOT NULL UNIQUE,
      iv_hex          TEXT NOT NULL,
      auth_tag_hex    TEXT NOT NULL,
      ciphertext_hex  TEXT,
      wiped_at        INTEGER,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    -- Append-only credit ledger. Sum(delta_cents) per user_id is the
    -- balance. Refunds are negative entries, never overwrites. ts is
    -- unix-seconds for cheap windowed reporting.
    --
    -- CHECK omits the 'reason' enum at boot-time CREATE so older DBs that
    -- predate added enum values (storage, egress, referral) still pass.
    -- The TypeScript LedgerReason union is the authoritative list; the
    -- ledger insertLedger() guard catches anything else at write time.
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      delta_cents     INTEGER NOT NULL,
      reason          TEXT NOT NULL,
      ref_invoice_id  TEXT,
      ref_pod_uuid    TEXT,
      note            TEXT,
      ts              INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_user_time ON credit_ledger(user_id, ts DESC);
    -- A given invoice can credit the ledger only once. Partial unique
    -- index keeps this from blocking ledger entries with NULL invoice ref
    -- (refunds, pod-hours, promos).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_invoice_credit_uniq
      ON credit_ledger(ref_invoice_id)
      WHERE ref_invoice_id IS NOT NULL AND reason = 'invoice_credit';

    -- ---------------- Phase 0+1: metering + thresholds ----------------
    -- Per-pod meter state. One row per pod, written on deploy, mutated by
    -- the power + DELETE handlers and by the thresholds engine. Walked by
    -- the meter tick (every minute) which charges running pods.
    CREATE TABLE IF NOT EXISTS pod_meter_state (
      pod_uuid_short              TEXT PRIMARY KEY,
      pod_full_uuid               TEXT NOT NULL,
      user_id                     INTEGER NOT NULL,
      tier_slug                   TEXT NOT NULL,
      rate_milli_cents_per_hour   INTEGER NOT NULL,
      ram_mib                     INTEGER NOT NULL,
      disk_mib                    INTEGER NOT NULL,
      cpu_percent                 INTEGER NOT NULL,
      state                       TEXT NOT NULL CHECK (state IN ('provisioning','running','stopped','suspended','deleted')),
      last_billed_at              INTEGER NOT NULL,
      sub_micro_cents             INTEGER NOT NULL DEFAULT 0,
      created_at                  INTEGER NOT NULL,
      updated_at                  INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pod_meter_state_user
      ON pod_meter_state(user_id, state);
    CREATE INDEX IF NOT EXISTS idx_pod_meter_state_state
      ON pod_meter_state(state);

    -- Per-user threshold-state bookkeeping. One row per user, lazy-inserted
    -- on first threshold evaluation by the thresholds engine.
    CREATE TABLE IF NOT EXISTS user_billing_state (
      user_id          INTEGER PRIMARY KEY,
      warn_low_sent_at INTEGER,
      grace_started_at INTEGER,
      suspended_at     INTEGER,
      purge_warned_at  INTEGER,
      purged_at        INTEGER,
      updated_at       INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- CPU-pin watchdog (see lib/watchdog.ts + /api/internal/watchdog).
    -- One row per pod currently observed pinned at its CPU cap. Deleted
    -- the moment a probe comes back cool, and after a suspension — so
    -- steady state is an empty table.
    CREATE TABLE IF NOT EXISTS pod_watchdog_state (
      pod_uuid_short  TEXT PRIMARY KEY,
      state           TEXT NOT NULL CHECK (state IN ('ok','warned')),
      pinned_since    INTEGER NOT NULL,
      warned_at       INTEGER,
      last_cpu        REAL,
      updated_at      INTEGER NOT NULL
    );

    -- Promo codes (schema only this phase; redemption code lands later).
    CREATE TABLE IF NOT EXISTS promo_codes (
      code              TEXT PRIMARY KEY,
      amount_cents      INTEGER NOT NULL,
      max_redemptions   INTEGER,
      redemptions       INTEGER NOT NULL DEFAULT 0,
      expires_at        INTEGER,
      created_at        INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      code         TEXT NOT NULL,
      user_id      INTEGER NOT NULL,
      ledger_id    INTEGER NOT NULL,
      redeemed_at  INTEGER NOT NULL,
      UNIQUE (code, user_id),
      FOREIGN KEY (code) REFERENCES promo_codes(code),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Referrals (schema only this phase). referee_user_id is UNIQUE so a
    -- user can be the referee of exactly one referrer; ON CONFLICT IGNORE
    -- on insert means the "first referral wins".
    CREATE TABLE IF NOT EXISTS referrals (
      id                         INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id           INTEGER NOT NULL,
      referee_user_id            INTEGER NOT NULL UNIQUE,
      reward_referrer_ledger_id  INTEGER,
      reward_referee_ledger_id   INTEGER,
      status                     TEXT NOT NULL CHECK (status IN ('pending','rewarded','denied')),
      created_at                 INTEGER NOT NULL,
      rewarded_at                INTEGER,
      FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (referee_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);

    -- Idempotency keys. Used by admin/adjust (and any future write
    -- endpoint that accepts an Idempotency-Key header). Stores the
    -- response body for a 24h window so client retries return the same
    -- result instead of duplicating ledger rows.
    --
    -- The scope column (e.g. 'admin.adjust:<userId>') prevents the same
    -- key being reused across endpoints. expires_at is unix seconds; a
    -- background sweep (in the meter tick) prunes expired rows.
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key           TEXT NOT NULL,
      scope         TEXT NOT NULL,
      response_json TEXT NOT NULL,
      status_code   INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      PRIMARY KEY (key, scope)
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

    -- ---------------- Billing runtime config ----------------
    -- Single source of truth for every business-tunable knob that
    -- shouldn't require a redeploy to change (prices, thresholds,
    -- feature flags). Code reads via lib/billing/config.getConfig(),
    -- which caches values in-memory for ~30s and falls back to the
    -- DEFAULTS map when no row exists. Admin endpoints PATCH this
    -- table, invalidating the cache on write.
    --
    -- value_json stores the value as a JSON literal (numbers,
    -- booleans, strings, nested objects all valid) so we don't have
    -- to add a column per type.
    --
    -- Security: gated entirely by /api/billing/admin/config which
    -- requires is_admin=1. No public read path.
    CREATE TABLE IF NOT EXISTS billing_config (
      key                  TEXT PRIMARY KEY,
      value_json           TEXT NOT NULL,
      description          TEXT,
      updated_at           INTEGER NOT NULL,
      updated_by_admin_id  INTEGER
    );

    -- Append-only audit log for every state-changing admin action. Read
    -- from /admin/audit. Stored as JSON-blobs of before/after so the
    -- schema can evolve without breaking history. before/after must be
    -- pre-scrubbed of secrets (tokens, password hashes) by the caller.
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER NOT NULL,
      action        TEXT NOT NULL,
      target_type   TEXT NOT NULL,
      target_id     TEXT,
      before_json   TEXT,
      after_json    TEXT,
      ip            TEXT,
      user_agent    TEXT,
      ts            INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_actor_ts ON admin_audit_log(actor_user_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_log(target_type, target_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON admin_audit_log(ts DESC);

    -- Admin impersonation sessions. Time-boxed, audit-logged at start &
    -- end. The pods_admin_imp cookie carries (admin_id, target_user_id,
    -- token) and is matched against this table on every request.
    CREATE TABLE IF NOT EXISTS admin_impersonations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id   INTEGER NOT NULL,
      target_user_id  INTEGER NOT NULL,
      token_hash      TEXT NOT NULL,
      reason          TEXT,
      started_at      INTEGER NOT NULL,
      expires_at      INTEGER NOT NULL,
      ended_at        INTEGER,
      ip              TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_imp_active ON admin_impersonations(admin_user_id, ended_at);

    -- ---------------- Dodo billing migration ----------------
    -- Dodo customer mapping, independent of active subscriptions. Users
    -- can buy credit packs before subscribing and still need portal access.
    CREATE TABLE IF NOT EXISTS billing_customers (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL UNIQUE,
      dodo_customer_id  TEXT NOT NULL UNIQUE,
      email             TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      metadata_json     TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_billing_customers_user
      ON billing_customers(user_id);

    -- Local projection of Dodo subscription state. Dodo webhooks are the
    -- source of truth; this table exists so deploy gates and dashboard
    -- reads do not need to call Dodo on every request.
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                  INTEGER NOT NULL,
      dodo_customer_id         TEXT,
      dodo_subscription_id     TEXT UNIQUE,
      plan                     TEXT NOT NULL,
      status                   TEXT NOT NULL,
      current_period_start     TEXT,
      current_period_end       TEXT,
      cancel_at_period_end     INTEGER NOT NULL DEFAULT 0,
      cancelled_at             TEXT,
      renewal_date             TEXT,
      provider_updated_at       TEXT,
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
      raw_status_payload_json  TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
      ON subscriptions(user_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_customer
      ON subscriptions(dodo_customer_id);

    -- Immutable audit trail for billing-provider events. For Dodo this
    -- stores subscription lifecycle and credit-pack payment events after
    -- signature verification.
    CREATE TABLE IF NOT EXISTS billing_events (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER,
      provider           TEXT NOT NULL,
      provider_event_id  TEXT NOT NULL,
      event_type         TEXT NOT NULL,
      resource_type      TEXT,
      resource_id        TEXT,
      processed_at       TEXT NOT NULL DEFAULT (datetime('now')),
      payload_json       TEXT NOT NULL,
      UNIQUE(provider, provider_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_events_user_time
      ON billing_events(user_id, processed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_billing_events_resource
      ON billing_events(resource_type, resource_id);

    -- Local projection of Dodo payment attempts. This is separate from the
    -- immutable billing_events archive so the UI can show recovery state:
    -- processing, failed, cancelled, invoice/receipt links, and retry hints.
    CREATE TABLE IF NOT EXISTS dodo_payment_attempts (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                   INTEGER,
      dodo_payment_id           TEXT,
      dodo_checkout_session_id  TEXT,
      dodo_subscription_id      TEXT,
      dodo_customer_id          TEXT,
      product_id                TEXT,
      intent                    TEXT,
      plan                      TEXT,
      status                    TEXT NOT NULL,
      event_type                TEXT NOT NULL,
      error_code                TEXT,
      error_message             TEXT,
      invoice_url               TEXT,
      receipt_url               TEXT,
      provider_updated_at       TEXT,
      raw_payload_json          TEXT,
      created_at                TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_dodo_payment_attempts_user_time
      ON dodo_payment_attempts(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dodo_payment_attempts_subscription
      ON dodo_payment_attempts(dodo_subscription_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dodo_payment_attempts_payment
      ON dodo_payment_attempts(dodo_payment_id)
      WHERE dodo_payment_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dodo_payment_attempts_checkout
      ON dodo_payment_attempts(dodo_checkout_session_id)
      WHERE dodo_checkout_session_id IS NOT NULL;

    -- Idempotency table for Dodo webhook deliveries. webhook_id comes
    -- from the Standard Webhooks header and is unique per delivery event.
    CREATE TABLE IF NOT EXISTS dodo_webhook_events (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_id         TEXT NOT NULL UNIQUE,
      event_type         TEXT,
      received_at        TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at       TEXT,
      processing_status  TEXT NOT NULL,
      payload_hash       TEXT NOT NULL,
      error              TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dodo_webhook_events_status
      ON dodo_webhook_events(processing_status, received_at DESC);

    -- Cached account credit balance. Amounts are stored in USD cents.
    -- credit_transactions remains the audit trail.
    CREATE TABLE IF NOT EXISTS credit_balances (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL UNIQUE,
      balance_cents  INTEGER NOT NULL DEFAULT 0,
      currency       TEXT NOT NULL DEFAULT 'usd',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Reusable credit wallet ledger. This branch writes purchase rows
    -- only; future Pods Managed AI work can add debit rows.
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                   INTEGER NOT NULL,
      type                      TEXT NOT NULL,
      amount_cents              INTEGER NOT NULL,
      balance_after_cents       INTEGER NOT NULL,
      currency                  TEXT NOT NULL DEFAULT 'usd',
      dodo_payment_id           TEXT,
      dodo_checkout_session_id  TEXT,
      billing_event_id          INTEGER,
      description               TEXT,
      created_at                TEXT NOT NULL DEFAULT (datetime('now')),
      metadata_json             TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (billing_event_id) REFERENCES billing_events(id)
    );
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_time
      ON credit_transactions(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_dodo_payment
      ON credit_transactions(dodo_payment_id)
      WHERE dodo_payment_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_dodo_checkout
      ON credit_transactions(dodo_checkout_session_id)
      WHERE dodo_checkout_session_id IS NOT NULL;

    -- Sub-cent carry for metered Pods Managed AI usage. Per-request upstream
    -- costs are fractions of a cent; we accumulate them here in micro-units
    -- (1 USD = 1,000,000 micro-units, so 1 cent = 10,000 micro-units) and only
    -- debit the wallet a whole cent once the carry crosses it. Mirrors the
    -- sub_micro_cents carry on pod_meter_state.
    CREATE TABLE IF NOT EXISTS managed_usage_accrual (
      user_id            INTEGER NOT NULL UNIQUE,
      carry_micro_units  INTEGER NOT NULL DEFAULT 0,
      total_micro_units  INTEGER NOT NULL DEFAULT 0,
      updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  // Forward-compat: older DBs may not have pod_email_token. Try to add it;
  // swallow the "duplicate column" error if it's already there.
  try {
    db.exec("ALTER TABLE pod_domains ADD COLUMN pod_email_token TEXT");
  } catch (err) {
    if (!String(err).toLowerCase().includes("duplicate column")) {
      throw err;
    }
  }
  // Forward-compat: managed-AI usage debits store the gateway's per-request
  // id here so a retried usage callback can't double-charge. Unique partial
  // index enforces idempotency. Older DBs predate the column.
  try {
    db.exec("ALTER TABLE credit_transactions ADD COLUMN managed_request_id TEXT");
  } catch (err) {
    if (!String(err).toLowerCase().includes("duplicate column")) {
      throw err;
    }
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_managed_request
      ON credit_transactions(managed_request_id)
      WHERE managed_request_id IS NOT NULL;
  `);
  // Refund tracking: any time an admin sweeps funds back to the payer
  // (admin:refund) we record the tx signature here. Independent of the
  // status column — a refund can apply to underpaid OR confirmed OR
  // overpaid invoices.
  try {
    db.exec("ALTER TABLE invoices ADD COLUMN refund_tx_signature TEXT");
  } catch (err) {
    if (!String(err).toLowerCase().includes("duplicate column")) {
      throw err;
    }
  }
  try {
    db.exec("ALTER TABLE subscriptions ADD COLUMN provider_updated_at TEXT");
  } catch (err) {
    if (!String(err).toLowerCase().includes("duplicate column")) {
      throw err;
    }
  }
  // Same trick for the new email_verified_at column. Existing users on
  // production were created before email-verification existed, so we
  // backfill them as verified to avoid locking them out.
  try {
    db.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
    db.exec(
      "UPDATE users SET email_verified_at = datetime('now') WHERE email_verified_at IS NULL",
    );
  } catch (err) {
    if (!String(err).toLowerCase().includes("duplicate column")) {
      throw err;
    }
  }
  // Phase 0+1 billing-side columns on users. All are nullable / defaulted
  // so existing rows continue to work unchanged.
  //   is_admin              — admin RBAC gate for /api/billing/admin/*
  //   kyc_status            — NULL = no KYC required. 'verified' / 'pending'
  //                           reserved for the future enforcement layer.
  //   kyc_threshold_cents   — NULL = no per-user gate. If set, invoice
  //                           creation above this lifetime total is blocked
  //                           until kyc_status = 'verified'.
  //   promo_credits_received— per Q2 decision: $5 grant happens once per
  //                           user (across all identities). Non-zero means
  //                           already claimed; guards against double-grant
  //                           when a wallet-only user later links an email.
  //   referral_code         — opaque per-user code. NULL until first read,
  //                           then assigned on demand.
  for (const col of [
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN kyc_status TEXT",
    "ALTER TABLE users ADD COLUMN kyc_threshold_cents INTEGER",
    "ALTER TABLE users ADD COLUMN promo_credits_received INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN referral_code TEXT",
    // Per-user billing-config override layer. NULL = no overrides for
    // this user (falls through to billing_config table → DEFAULTS map).
    // Stored as a JSON object: { "feature.auto_suspend_enabled": false,
    // "pricing.invoice.max_usd_cents": 500000 } etc. Most users will
    // never have a row; populated by /api/billing/admin/config when
    // grandfathering or VIP-tier flagging is needed.
    "ALTER TABLE users ADD COLUMN config_overrides_json TEXT",
    // One-free-pod quota for the cohort tiers. NULL = quota unused. Set
    // to the short uuid of the pod the user claimed as their free pod;
    // unset when that pod is deleted. The meter, storage rollup, and
    // burn-rate calc all consult this when deciding whether to debit.
    "ALTER TABLE users ADD COLUMN cohort_free_pod_uuid_short TEXT",
    // Future-proof RBAC. Values: 'user' (default), 'support', 'finance',
    // 'admin'. v1 only reads 'admin' vs everything-else — the extra
    // values exist so we can split roles later without another ALTER.
    // Backfilled from is_admin below to keep the two in sync.
    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
    // Account suspension. NULL = active. ISO timestamp = suspended at
    // that time. Suspended users keep their data but can't sign in
    // (auth.ts checks this) and their pods stay stopped.
    "ALTER TABLE users ADD COLUMN suspended_at TEXT",
    "ALTER TABLE users ADD COLUMN suspended_reason TEXT",
    "ALTER TABLE users ADD COLUMN last_login_at TEXT",
    // Session revocation cutoff. Any session cookie with iat < this is
    // rejected. Bumped to now() by /api/admin/users/[id]/revoke-sessions.
    "ALTER TABLE users ADD COLUMN session_min_iat INTEGER",
  ]) {
    try {
      db.exec(col);
    } catch (err) {
      if (!String(err).toLowerCase().includes("duplicate column")) throw err;
    }
  }
  // Unique index on referral_code, partial so NULL rows don't collide.
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL",
    );
  } catch {
    // older sqlite without partial-index support — non-fatal
  }

  // Backfill role from is_admin so the two columns agree. Non-destructive:
  // only writes when role is the default 'user' AND is_admin=1.
  try {
    db.exec(
      "UPDATE users SET role = 'admin' WHERE is_admin = 1 AND role = 'user'",
    );
  } catch {
    // role column might not exist on a brand-new DB before the migration
    // ran in the same process — db.exec above already added it, so this
    // catch is only defensive.
  }

  // -------- Bootstrap admin from BOOTSTRAP_ADMIN_EMAIL env var --------
  // Lets operator promote themselves to admin without manually running
  // SQL on the prod box after deploy. Idempotent:
  //   - env var missing             → no-op
  //   - email doesn't match a user  → log a warning, retry next boot
  //   - email matches               → set is_admin=1 if not already,
  //                                   log on first promotion only
  //
  // Runs once per process boot inside getDb() the first time db.ts is
  // imported (which happens on the first request handler that touches
  // the DB). Safe to call on every boot — the UPDATE is a no-op once
  // is_admin is already 1.
  //
  // Why here and not server.mjs: server.mjs is plain JS and can't
  // import this TS file. The cost of running this in db init is one
  // SELECT + at most one UPDATE per process lifetime. Negligible.
  bootstrapAdminFromEnv(db);

  _db = db;
  return db;
}

function bootstrapAdminFromEnv(db: DB): void {
  const emails = allowedAdminEmails();
  if (emails.length === 0) return;
  try {
    for (const email of emails) {
      const row = db
        .prepare<[string], { id: number; is_admin: number }>(
          "SELECT id, is_admin FROM users WHERE LOWER(email) = ?",
        )
        .get(email);
      if (!row) {
        console.warn(
          `[bootstrap-admin] admin email '${email}' has no matching user yet — sign up with that email, then restart the server to promote.`,
        );
        continue;
      }
      if (row.is_admin === 1) {
        // Already an admin; quiet success.
        continue;
      }
      db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(row.id);
      console.warn(
        `[bootstrap-admin] promoted user_id=${row.id} (${email}) to is_admin=1 via admin allowlist`,
      );
    }
  } catch (err) {
    // Don't crash the DB init on a bootstrap failure.
    console.warn(
      `[bootstrap-admin] failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Proxy that defers DB open until first method use. Lets Next build-time worker
// imports of this module avoid touching the file at once.
const db = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb();
    const v = (real as unknown as Record<string | symbol, unknown>)[
      prop as string
    ];
    return typeof v === "function" ? (v as Function).bind(real) : v;
  },
});

export default db;
