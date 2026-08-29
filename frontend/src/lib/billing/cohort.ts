import "server-only";
import db, { type UserRow } from "../db";
import { getConfig } from "./config";

/**
 * Cohort-based pricing.
 *
 *   Cohort 'founding' (users.id ≤ cohort.founding_size, default 5):
 *     ONE free pod of any tier (any size, any template). The user's
 *     remaining pods are billed as standard PAYG. Free-slot is tied to
 *     a specific pod by uuid; deleting that pod releases the slot so
 *     the next deploy gets the free seat again.
 *
 *   Cohort 'paid_cohort' (default positions 6..15):
 *     Same one-free-pod entitlement, but only after the user has paid
 *     at least cohort.paid_unlock_cents (default $5) cumulative. Until
 *     they pay, the first deploy is blocked with a 402 "needs_topup".
 *     After they pay, the next deploy claims the free slot.
 *
 *   Cohort 'payg' (everyone else):
 *     Standard pay-as-you-go for every pod. No free slot.
 *
 * Master flag 'feature.cohort_pricing_enabled' turns the whole thing
 * off; every user becomes 'payg'.
 *
 * Locked-at-signup design rationale:
 * - users.id is monotonic and never reused (sqlite AUTOINCREMENT).
 * - Even if user #2 deletes their account, slot #2 is gone forever;
 *   the next signup gets user.id #16+, not #2.
 *
 * The free slot itself is tied to a specific pod via
 *   users.cohort_free_pod_uuid_short
 * which is set when an eligible user deploys their first pod (the
 * deploy route calls claimFreePodSlot) and unset when that pod is
 * deleted (the delete route calls releaseFreePodSlot). The meter,
 * storage rollup, and burn-rate calc all consult isPodFreeForUser to
 * decide debit-or-skip.
 */

export type Cohort = "founding" | "paid_cohort" | "payg";

export type DeployTier =
  | "founding_free"
  | "founding_payg"
  | "paid_cohort_free"
  | "paid_cohort_payg"
  | "payg";

export type DeployGateResult =
  | { ok: true; tier: DeployTier; will_be_free: boolean }
  | {
      ok: false;
      reason: "needs_topup";
      message: string;
      required_cents: number;
      have_topped_up_cents: number;
    };

/** Master switch — when false, every user is 'payg' regardless of id. */
export function isCohortPricingEnabled(): boolean {
  return getConfig("feature.cohort_pricing_enabled");
}

/** Pure function over (userId, config). Doesn't touch the user row. */
export function cohortForUserId(userId: number): Cohort {
  if (!isCohortPricingEnabled()) return "payg";
  if (!Number.isInteger(userId) || userId < 1) return "payg";
  const founding = getConfig("cohort.founding_size");
  const paid = getConfig("cohort.paid_size");
  if (userId <= founding) return "founding";
  if (userId <= founding + paid) return "paid_cohort";
  return "payg";
}

/** Lifetime sum of invoice_credit ledger entries — what the user has
 * actually paid (not promos, not refunds, not manual adjustments).
 * Used to check whether a paid_cohort user has cleared their $5 gate. */
export function getLifetimeTopupCents(userId: number): number {
  const row = db
    .prepare<[number], { s: number | null }>(
      `SELECT SUM(delta_cents) AS s FROM credit_ledger
        WHERE user_id = ? AND reason = 'invoice_credit'`,
    )
    .get(userId);
  return Math.max(0, row?.s ?? 0);
}

/** Has this user paid the unlock gate (if any)?
 *   - founding: always true (no gate)
 *   - paid_cohort: true iff lifetime top-up ≥ paid_unlock_cents
 *   - payg: false (no entitlement to unlock)
 *
 * This says nothing about whether the user has consumed their free
 * slot — only whether they're entitled to one. Use isPodFreeForUser
 * for the per-pod debit-or-skip decision.
 */
export function isUserCohortEligible(userId: number): boolean {
  const c = cohortForUserId(userId);
  if (c === "founding") return true;
  if (c === "paid_cohort") {
    const have = getLifetimeTopupCents(userId);
    const need = getConfig("cohort.paid_unlock_cents");
    return have >= need;
  }
  return false;
}

/** Read the user's current claimed free-pod slot (a short uuid) or NULL. */
export function getFreePodUuid(userId: number): string | null {
  const row = db
    .prepare<[number], { u: string | null }>(
      `SELECT cohort_free_pod_uuid_short AS u FROM users WHERE id = ?`,
    )
    .get(userId);
  return row?.u ?? null;
}

/** Per-pod free-or-paid decision. Single source of truth used by the
 * meter (tickPod), storage rollup, and burn rate calc. Returns true
 * only when:
 *   1. cohort pricing is enabled, AND
 *   2. the user is in founding or paid-unlocked, AND
 *   3. THIS pod is the one they've claimed as their free slot.
 *
 * Pods other than the claimed one always bill as PAYG, even for
 * founding users.
 */
export function isPodFreeForUser(
  userId: number,
  podUuidShort: string,
): boolean {
  if (!isUserCohortEligible(userId)) return false;
  const claimed = getFreePodUuid(userId);
  return claimed != null && claimed === podUuidShort;
}

/** Claim the free pod slot for the user, idempotently.
 *
 * Effects:
 *   - If the user has NO existing slot AND is cohort-eligible, set
 *     users.cohort_free_pod_uuid_short to podUuidShort. Returns true.
 *   - If the slot is already set to a different pod, returns false.
 *     (The caller should bill this new pod as PAYG.)
 *   - If the slot is already set to THIS pod, returns true (idempotent
 *     re-claim, e.g. a deploy retry).
 *   - If the user is not cohort-eligible, returns false unconditionally.
 *
 * Safe to call from the deploy route after Pelican confirms server
 * creation. Throws nothing; failure to claim just means PAYG.
 */
export function claimFreePodSlot(
  userId: number,
  podUuidShort: string,
): boolean {
  if (!isUserCohortEligible(userId)) return false;
  const existing = getFreePodUuid(userId);
  if (existing === podUuidShort) return true;
  if (existing != null) return false;
  // Use a conditional UPDATE so concurrent deploys can't both win the
  // claim (race window: two deploys land within the same tick).
  const r = db
    .prepare(
      `UPDATE users
          SET cohort_free_pod_uuid_short = ?
        WHERE id = ? AND cohort_free_pod_uuid_short IS NULL`,
    )
    .run(podUuidShort, userId);
  return r.changes === 1;
}

/** Release the free pod slot when the user's claimed pod is deleted.
 * No-op if the deleted pod doesn't match the user's slot (PAYG pods
 * deleting don't free up anything). */
export function releaseFreePodSlot(
  userId: number,
  podUuidShort: string,
): void {
  db.prepare(
    `UPDATE users
        SET cohort_free_pod_uuid_short = NULL
      WHERE id = ? AND cohort_free_pod_uuid_short = ?`,
  ).run(userId, podUuidShort);
}

/** Pre-deploy gate. Four outcomes:
 *
 *   { ok: true, tier: 'founding_free',     will_be_free: true  }
 *   { ok: true, tier: 'founding_payg',     will_be_free: false } (slot used)
 *   { ok: true, tier: 'paid_cohort_free',  will_be_free: true  }
 *   { ok: true, tier: 'paid_cohort_payg',  will_be_free: false }
 *   { ok: true, tier: 'payg',              will_be_free: false }
 *   { ok: false, reason: 'needs_topup',    ... }                 (paid cohort
 *                                                                 hasn't paid)
 *
 * The gate NEVER blocks a 2nd-or-later deploy for founding / paid-cohort
 * users: it just flips will_be_free to false. The meter takes care of
 * the actual debits via isPodFreeForUser; the gate only exists to (a)
 * stop unpaid paid_cohort users and (b) tell the UI what to show.
 */
export function canDeployAnotherPod(userId: number): DeployGateResult {
  const c = cohortForUserId(userId);
  const slotUsed = getFreePodUuid(userId) != null;

  if (c === "founding") {
    return {
      ok: true,
      tier: slotUsed ? "founding_payg" : "founding_free",
      will_be_free: !slotUsed,
    };
  }
  if (c === "payg") {
    return { ok: true, tier: "payg", will_be_free: false };
  }
  // paid_cohort: must have paid the unlock first.
  const have = getLifetimeTopupCents(userId);
  const need = getConfig("cohort.paid_unlock_cents");
  if (have < need) {
    return {
      ok: false,
      reason: "needs_topup",
      message:
        `You're in the paid-cohort tier (first ${getConfig("cohort.founding_size") + getConfig("cohort.paid_size")} signups). ` +
        `Pay $${(need / 100).toFixed(0)} once to unlock your free pod. ` +
        `You've paid $${(have / 100).toFixed(2)} so far.`,
      required_cents: need,
      have_topped_up_cents: have,
    };
  }
  return {
    ok: true,
    tier: slotUsed ? "paid_cohort_payg" : "paid_cohort_free",
    will_be_free: !slotUsed,
  };
}

export type CohortSummary = {
  cohort: Cohort;
  /** What the UI renders.
   *   free_available      → user has an unused free slot to claim now
   *   free_in_use         → user has claimed their free slot (some pod uses it)
   *   paid_cohort_locked  → paid_cohort user who hasn't topped up the unlock
   *   payg                → everyone else
   */
  effective_tier:
    | "free_available"
    | "free_in_use"
    | "paid_cohort_locked"
    | "payg";
  user_id: number;
  founding_size: number;
  paid_size: number;
  paid_unlock_cents: number;
  lifetime_topup_cents: number;
  cohort_position: number;
  pricing_enabled: boolean;
  /** Short uuid of the pod currently consuming the free slot, or null
   * when the slot is available. PAYG users always see null. */
  free_pod_uuid_short: string | null;
};

export function getCohortSummary(userId: number): CohortSummary {
  const cohort = cohortForUserId(userId);
  const founding = getConfig("cohort.founding_size");
  const paid = getConfig("cohort.paid_size");
  const unlock = getConfig("cohort.paid_unlock_cents");
  const topup = getLifetimeTopupCents(userId);
  const freePod = getFreePodUuid(userId);

  let effective: CohortSummary["effective_tier"];
  if (cohort === "founding") {
    effective = freePod ? "free_in_use" : "free_available";
  } else if (cohort === "paid_cohort") {
    if (topup < unlock) effective = "paid_cohort_locked";
    else effective = freePod ? "free_in_use" : "free_available";
  } else {
    effective = "payg";
  }

  return {
    cohort,
    effective_tier: effective,
    user_id: userId,
    founding_size: founding,
    paid_size: paid,
    paid_unlock_cents: unlock,
    lifetime_topup_cents: topup,
    cohort_position: userId,
    pricing_enabled: isCohortPricingEnabled(),
    free_pod_uuid_short: cohort === "payg" ? null : freePod,
  };
}

/** Back-compat shim. Old callers used isUserFreeForever(userId) which
 * predates the per-pod model. New code should call isPodFreeForUser
 * directly. Kept here only so a stale import doesn't crash, but it
 * always returns false: callers that need the right answer MUST switch
 * to the per-pod gate. Throws in dev so it's not silently misused. */
export function isUserFreeForever(_userId: number): boolean {
  if (process.env.NODE_ENV !== "production") {
    throw new Error(
      "isUserFreeForever is deprecated — use isPodFreeForUser(userId, podUuidShort)",
    );
  }
  return false;
}

/** Lookup helper for the deploy route — returns the user row so the
 * route can read cohort_free_pod_uuid_short without a separate query. */
export function getUserCohortRow(userId: number): Pick<
  UserRow,
  "id" | "cohort_free_pod_uuid_short"
> | null {
  return (
    db
      .prepare<
        [number],
        Pick<UserRow, "id" | "cohort_free_pod_uuid_short">
      >(
        `SELECT id, cohort_free_pod_uuid_short FROM users WHERE id = ?`,
      )
      .get(userId) ?? null
  );
}
