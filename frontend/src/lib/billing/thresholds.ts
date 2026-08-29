import "server-only";
import db, { type UserBillingStateRow, type UserRow } from "../db";
import { getBalanceCents } from "./ledger";
import { suspendUserPodsInDb, resumeUserPodsInDb } from "./meter";
import { applicationApi, type ServerAttributes } from "../pelican";
import {
  sendWarnLowEmail,
  sendSuspendEmail,
  sendPurgeWarnEmail,
  sendPurgedEmail,
  sendResumedEmail,
} from "./emails";
import { getCurrentBurnPerDayCents } from "./usage";
import { isWalletSyntheticEmail } from "../auth";
import { withLock } from "./locks";
import { billingLog } from "./logger";
import { getConfig } from "./config";

/**
 * Balance-threshold state machine. Drives the warn → grace → suspend
 * → purge progression. Designed to run after every debit AND on a
 * periodic schedule (so a user can fall into 'suspend' from sitting at
 * < -50 even when no debit fires).
 *
 *   balance > WARN_CENTS                    → state=green   (clear all flags)
 *   0 < balance ≤ WARN_CENTS                → state=warn    (email once)
 *   SUSPEND_FLOOR_CENTS < balance ≤ 0       → state=grace   (start 24h clock)
 *   balance ≤ SUSPEND_FLOOR_CENTS OR
 *     grace_started_at older than 24h       → state=suspend (power-stop pods,
 *                                                           email)
 *   suspended for ≥ 7d                      → state=warn2   (email "23 days
 *                                                           to delete")
 *   suspended for ≥ 30d                     → state=purge   (delete pods +
 *                                                           pod_meter_state rows)
 *
 * The thresholds live as exported constants so tests can drive them.
 * Email send and Pelican calls are pluggable for the same reason.
 */

/** Legacy export — preserved for any caller that imported the constant.
 * NEW code should call getConfig("threshold.warn_cents") so admin
 * tuning applies live. These are read once at module load. */
export const WARN_CENTS = 100;
export const SUSPEND_FLOOR_CENTS = -50;
export const GRACE_WINDOW_SECONDS = 24 * 60 * 60;
export const PURGE_WARN_AT_SECONDS = 7 * 24 * 60 * 60;
export const PURGE_AT_SECONDS = 30 * 24 * 60 * 60;

function thresholds(userId?: number): {
  warn: number;
  floor: number;
  grace: number;
  purgeWarn: number;
  purge: number;
  autoSuspendEnabled: boolean;
  emailsEnabled: boolean;
} {
  return {
    warn: getConfig("threshold.warn_cents", { userId }),
    floor: getConfig("threshold.suspend_floor_cents", { userId }),
    grace: getConfig("threshold.grace_window_seconds", { userId }),
    purgeWarn: getConfig("threshold.purge_warn_at_seconds", { userId }),
    purge: getConfig("threshold.purge_at_seconds", { userId }),
    autoSuspendEnabled: getConfig("feature.auto_suspend_enabled", { userId }),
    emailsEnabled: getConfig("feature.emails_enabled", { userId }),
  };
}

export type ThresholdState = "green" | "warn" | "grace" | "suspend" | "warn2" | "purge";

export type ThresholdSideEffect =
  | { kind: "send_warn_low_email"; userId: number; balanceCents: number }
  | { kind: "send_suspend_email"; userId: number }
  | { kind: "send_purge_warn_email"; userId: number; daysUntilPurge: number }
  | { kind: "send_purged_email"; userId: number; podsDeleted: number }
  | { kind: "send_resumed_email"; userId: number; podsResumed: number }
  | { kind: "power_stop_pods"; userId: number; podShorts: string[] }
  | { kind: "power_start_pods"; userId: number; podShorts: string[] }
  | { kind: "delete_pods"; userId: number; podShorts: string[] };

/** Pluggable side-effect runner. Tests pass a recorder; production wires
 * up the real email + Pelican power calls (defaultEffectRunner below). */
export type EffectRunner = (effect: ThresholdSideEffect) => Promise<void>;

/** Pure decision function — given balance + current bookkeeping, what
 * state are we in and what new bookkeeping should be written? Tested
 * exhaustively in tests/lib/thresholds.test.ts.
 *
 * Reads thresholds from config (admin-tunable). Pass `userId` to apply
 * any per-user override; omit for global defaults.
 *
 * `burnPerDayCents` (optional, default 0): when 0 AND balance is
 * non-negative, force 'green' — no warn/suspend emails. Without this,
 * a cohort founding/paid-unlocked user (free-forever) with $0 balance
 * and 5 running pods would still get "running low" emails even though
 * they're not burning anything. Pass the value from
 * getCurrentBurnPerDayCents() (which already returns 0 for those
 * cohorts) at every real call site. */
export function classify(args: {
  balanceCents: number;
  /** Current bookkeeping row, or null if user has no row yet. */
  state: UserBillingStateRow | null;
  nowSeconds: number;
  /** Optional — when provided, per-user overrides apply via getConfig. */
  userId?: number;
  /** Optional — when 0 AND balance >= 0, classify is a no-op (returns
   * green). Defaults to a large number when omitted (preserves the
   * pre-fix behavior of always processing, for callers that haven't
   * been updated). */
  burnPerDayCents?: number;
}): {
  threshold: ThresholdState;
  /** Patch to apply to user_billing_state. Keys to set; null clears them. */
  patch: Partial<
    Omit<UserBillingStateRow, "user_id" | "updated_at">
  >;
  /** Which side effects the caller should run AFTER persisting the patch. */
  effects: ThresholdSideEffect["kind"][];
} {
  const s = args.state;
  const { balanceCents, nowSeconds } = args;
  const burnPerDayCents = args.burnPerDayCents ?? Number.POSITIVE_INFINITY;
  const t = thresholds(args.userId);
  const effects: ThresholdSideEffect["kind"][] = [];
  const patch: Partial<Omit<UserBillingStateRow, "user_id" | "updated_at">> =
    {};

  // Already-purged users stay purged regardless of balance — explicit
  // admin re-enable required.
  if (s?.purged_at != null) {
    return { threshold: "purge", patch: {}, effects: [] };
  }

  // Zero burn + non-negative balance → green, no matter what the
  // balance is. Catches the cohort free-forever case: $0 balance +
  // running pods + founding (or paid-unlocked) cohort = no spending
  // happening, no need to warn or suspend. Also catches users who
  // stopped all pods and just have a dust balance sitting there.
  //
  // If the user was previously in warn/grace/suspend, clear those
  // flags so the next time they have actual burn the warn email can
  // re-fire.
  if (burnPerDayCents === 0 && balanceCents >= 0) {
    if (s?.suspended_at != null) {
      effects.push("power_start_pods");
      if (t.emailsEnabled) effects.push("send_resumed_email");
      patch.suspended_at = null;
      patch.purge_warned_at = null;
    }
    if (s?.warn_low_sent_at != null) patch.warn_low_sent_at = null;
    if (s?.grace_started_at != null) patch.grace_started_at = null;
    return { threshold: "green", patch, effects };
  }

  // ---- happy path: green ----
  if (balanceCents > t.warn) {
    // Resume if previously suspended (a fresh top-up brought them out).
    if (s?.suspended_at != null) {
      effects.push("power_start_pods");
      effects.push("send_resumed_email");
      patch.suspended_at = null;
      patch.purge_warned_at = null;
    }
    if (s?.warn_low_sent_at != null) patch.warn_low_sent_at = null;
    if (s?.grace_started_at != null) patch.grace_started_at = null;
    return { threshold: "green", patch, effects };
  }

  // ---- warn: balance between 1 and WARN_CENTS ----
  if (balanceCents > 0) {
    if (s?.suspended_at != null) {
      // Resume — user topped up at least a little, even if not enough
      // to clear the warn band. Better UX than keeping them suspended.
      effects.push("power_start_pods");
      effects.push("send_resumed_email");
      patch.suspended_at = null;
      patch.purge_warned_at = null;
    }
    if (s?.warn_low_sent_at == null) {
      patch.warn_low_sent_at = nowSeconds;
      effects.push("send_warn_low_email");
    }
    if (s?.grace_started_at != null) patch.grace_started_at = null;
    return { threshold: "warn", patch, effects };
  }

  // ---- balance ≤ 0 ----
  // Two cuts to suspend:
  //   1. balance dropped below the floor (-50¢ default) → instant suspend.
  //   2. balance is in the grace band (between floor and 0) and
  //      grace_started_at is more than 24h old → suspend.
  // Both are gated by feature.auto_suspend_enabled — when off we still
  // track grace_started_at but never emit suspend effects.
  const inFloorBreach = balanceCents <= t.floor;
  const graceStarted = s?.grace_started_at ?? null;
  const graceExpired =
    graceStarted != null && nowSeconds - graceStarted >= t.grace;

  if (
    t.autoSuspendEnabled &&
    s?.suspended_at == null &&
    (inFloorBreach || graceExpired)
  ) {
    // ---- suspend ----
    patch.suspended_at = nowSeconds;
    effects.push("power_stop_pods");
    if (t.emailsEnabled) effects.push("send_suspend_email");
    return { threshold: "suspend", patch, effects };
  }

  if (s?.suspended_at != null) {
    // Already suspended. Maybe time to warn about purge, or to purge.
    const sinceSuspend = nowSeconds - s.suspended_at;
    if (sinceSuspend >= t.purge) {
      patch.purged_at = nowSeconds;
      effects.push("delete_pods");
      if (t.emailsEnabled) effects.push("send_purged_email");
      return { threshold: "purge", patch, effects };
    }
    if (sinceSuspend >= t.purgeWarn && s.purge_warned_at == null) {
      patch.purge_warned_at = nowSeconds;
      if (t.emailsEnabled) effects.push("send_purge_warn_email");
      return { threshold: "warn2", patch, effects };
    }
    if (sinceSuspend >= t.purgeWarn && s.purge_warned_at != null) {
      return { threshold: "warn2", patch, effects };
    }
    return { threshold: "suspend", patch, effects };
  }

  // Grace state (balance ≤ 0 but > floor, not yet 24h old).
  if (graceStarted == null) {
    patch.grace_started_at = nowSeconds;
  }
  return { threshold: "grace", patch, effects };
}

/** Get-or-create the user_billing_state row. NULL-safe; the meter tick
 * may evaluate users who've never had a state row before. */
export function readOrInitState(userId: number, nowSeconds: number): UserBillingStateRow {
  const row = db
    .prepare<[number], UserBillingStateRow>(
      `SELECT * FROM user_billing_state WHERE user_id = ?`,
    )
    .get(userId);
  if (row) return row;
  db.prepare(
    `INSERT INTO user_billing_state (user_id, updated_at) VALUES (?, ?)`,
  ).run(userId, nowSeconds);
  return {
    user_id: userId,
    warn_low_sent_at: null,
    grace_started_at: null,
    suspended_at: null,
    purge_warned_at: null,
    purged_at: null,
    updated_at: nowSeconds,
  };
}

function writePatch(
  userId: number,
  patch: Partial<Omit<UserBillingStateRow, "user_id" | "updated_at">>,
  nowSeconds: number,
): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) {
    db.prepare(
      `UPDATE user_billing_state SET updated_at = ? WHERE user_id = ?`,
    ).run(nowSeconds, userId);
    return;
  }
  const sets = keys.map((k) => `${String(k)} = ?`).join(", ");
  const vals = keys.map((k) => (patch as Record<string, number | null>)[k as string]);
  db.prepare(
    `UPDATE user_billing_state SET ${sets}, updated_at = ? WHERE user_id = ?`,
  ).run(...vals, nowSeconds, userId);
}

/**
 * Evaluate one user's threshold state and run all matching side-effects
 * via the supplied effect runner. Wraps state-row write in a transaction
 * so partial failure can't leave us in a half-updated state.
 *
 * Used by:
 *   - the meter tick after each pod debit (per affected user_id)
 *   - the daily threshold sweep (every user with non-trivial billing)
 *   - the credit-invoice path (resume on top-up)
 */
export async function evaluateUser(
  userId: number,
  opts: {
    nowSeconds?: number;
    effectRunner?: EffectRunner;
  } = {},
): Promise<{
  threshold: ThresholdState;
  effects: ThresholdSideEffect["kind"][];
}> {
  // Per-user lock — see BILLING_AUDIT.md §1.5. Two concurrent evaluators
  // (for example meter tick plus an admin adjustment)
  // for the SAME user must serialize so the email side-effects don't
  // double-fire. Different user_ids run in parallel.
  return withLock(`user:${userId}`, async () => {
    const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    const runner = opts.effectRunner ?? defaultEffectRunner;

    const balanceCents = getBalanceCents(userId);
    // getCurrentBurnPerDayCents returns 0 for cohort free-forever users,
    // so passing it here is what makes classify() recognize "user has
    // only free pods, no spending happening, don't warn".
    const burnPerDayCents = getCurrentBurnPerDayCents(userId);
    const state = readOrInitState(userId, nowSeconds);
    const verdict = classify({
      balanceCents,
      burnPerDayCents,
      state,
      nowSeconds,
      userId,
    });

    // Persist the patch.
    writePatch(userId, verdict.patch, nowSeconds);

    if (verdict.effects.length > 0) {
      billingLog.info("thresholds.transition", {
        user_id: userId,
        threshold: verdict.threshold,
        effects: verdict.effects,
        balance_cents: balanceCents,
      });
    }

    // Run side effects.
    for (const kind of verdict.effects) {
      const effect = materializeEffect(kind, userId, balanceCents, verdict, nowSeconds);
      if (!effect) continue;
      try {
        await runner(effect);
      } catch (err) {
        // Don't crash the tick on a side-effect failure (an email vendor
        // outage shouldn't stop suspension from happening). The
        // user_billing_state row's timestamps already record the intent.
        billingLog.error("thresholds.effect_failed", {
          user_id: userId,
          kind,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { threshold: verdict.threshold, effects: verdict.effects };
  });
}

function materializeEffect(
  kind: ThresholdSideEffect["kind"],
  userId: number,
  balanceCents: number,
  verdict: ReturnType<typeof classify>,
  _nowSeconds: number,
): ThresholdSideEffect | null {
  switch (kind) {
    case "send_warn_low_email":
      return { kind, userId, balanceCents };
    case "send_suspend_email":
      return { kind, userId };
    case "send_purge_warn_email":
      return { kind, userId, daysUntilPurge: 23 };
    case "send_purged_email":
      return { kind, userId, podsDeleted: 0 };
    case "send_resumed_email":
      return { kind, userId, podsResumed: 0 };
    case "power_stop_pods": {
      const pods = suspendUserPodsInDb(userId);
      return { kind, userId, podShorts: pods };
    }
    case "power_start_pods": {
      const pods = resumeUserPodsInDb(userId);
      return { kind, userId, podShorts: pods };
    }
    case "delete_pods": {
      // Mark pods deleted in our DB so they stop accruing storage. The
      // *actual* Pelican DELETE happens in the runner.
      const pods = db
        .prepare<[number], { pod_uuid_short: string }>(
          `SELECT pod_uuid_short FROM pod_meter_state
            WHERE user_id = ?
              AND state IN ('running','stopped','suspended')
              AND economy_mode = 'legacy'`,
        )
        .all(userId)
        .map((r) => r.pod_uuid_short);
      for (const p of pods) {
        db.prepare(
          `UPDATE pod_meter_state SET state = 'deleted', updated_at = ? WHERE pod_uuid_short = ?`,
        ).run(_nowSeconds, p);
      }
      return { kind, userId, podShorts: pods };
    }
  }
  // Exhaustiveness — TS will catch missed cases above.
  void verdict;
  return null;
}

/** Production effect runner: emails via auth-emails.ts, power calls via
 * Pelican Application API. Best-effort; failures are logged but never
 * thrown (the caller already wraps in try/catch). */
export const defaultEffectRunner: EffectRunner = async (effect) => {
  switch (effect.kind) {
    case "send_warn_low_email":
    case "send_suspend_email":
    case "send_purge_warn_email":
    case "send_purged_email":
    case "send_resumed_email": {
      await sendThresholdEmail(effect);
      return;
    }
    case "power_stop_pods": {
      for (const podShort of effect.podShorts) {
        await pelicanPower(podShort, "stop").catch((err) => {
          console.warn(
            `[thresholds] pelican stop failed for ${podShort}: ${String(err)}`,
          );
        });
      }
      return;
    }
    case "power_start_pods": {
      for (const podShort of effect.podShorts) {
        await pelicanPower(podShort, "start").catch((err) => {
          console.warn(
            `[thresholds] pelican start failed for ${podShort}: ${String(err)}`,
          );
        });
      }
      return;
    }
    case "delete_pods": {
      for (const podShort of effect.podShorts) {
        await pelicanDelete(podShort).catch((err) => {
          console.warn(
            `[thresholds] pelican delete failed for ${podShort}: ${String(err)}`,
          );
        });
      }
      return;
    }
  }
};

async function sendThresholdEmail(
  effect: Extract<
    ThresholdSideEffect,
    {
      kind:
        | "send_warn_low_email"
        | "send_suspend_email"
        | "send_purge_warn_email"
        | "send_purged_email"
        | "send_resumed_email";
    }
  >,
): Promise<void> {
  const user = db
    .prepare<[number], Pick<UserRow, "id" | "email">>(
      `SELECT id, email FROM users WHERE id = ?`,
    )
    .get(effect.userId);
  if (!user) return;
  // Wallet-only users have a synthetic, non-deliverable email of the
  // form <address>@wallet.pods.local — skip silently. (When they add a
  // real email later, future events will deliver.) Anything else is a
  // real address and we attempt to send.
  if (isWalletSyntheticEmail(user.email)) {
    console.log(
      `[thresholds] skipping ${effect.kind} for wallet-only user ${effect.userId} (no email on file)`,
    );
    return;
  }
  switch (effect.kind) {
    case "send_warn_low_email":
      await sendWarnLowEmail({
        to: user.email,
        balanceCents: effect.balanceCents,
        burnPerDayCents: getCurrentBurnPerDayCents(effect.userId),
      });
      return;
    case "send_suspend_email":
      await sendSuspendEmail({ to: user.email });
      return;
    case "send_purge_warn_email":
      await sendPurgeWarnEmail({
        to: user.email,
        daysUntilPurge: effect.daysUntilPurge,
      });
      return;
    case "send_purged_email":
      await sendPurgedEmail({
        to: user.email,
        podsDeleted: effect.podsDeleted,
      });
      return;
    case "send_resumed_email":
      await sendResumedEmail({
        to: user.email,
        podsResumed: effect.podsResumed,
      });
      return;
  }
}

async function pelicanPower(
  podShort: string,
  signal: "start" | "stop" | "restart",
): Promise<void> {
  // Find Pelican's internal server id for this pod (the power endpoint
  // takes the numeric id, not uuid_short).
  const found = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(podShort)}`);
  const srv = found.data?.[0]?.attributes;
  if (!srv) {
    console.warn(`[thresholds] pelican power: pod ${podShort} not found`);
    return;
  }
  // We use the Application API's suspend endpoint for `stop` to *also*
  // gate panel-side access (graceful "user is past-due"), not just stop
  // the container. The Client API is per-user — the threshold runner
  // doesn't have a user session, so the Application API is the right path.
  if (signal === "stop") {
    await applicationApi(`/servers/${srv.id}/suspend`, { method: "POST" });
    return;
  }
  if (signal === "start") {
    await applicationApi(`/servers/${srv.id}/unsuspend`, { method: "POST" });
    return;
  }
  // restart — not currently invoked by the threshold engine. No-op.
}

async function pelicanDelete(podShort: string): Promise<void> {
  const found = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(podShort)}`);
  const srv = found.data?.[0]?.attributes;
  if (!srv) return;
  await applicationApi(`/servers/${srv.id}?force=true`, { method: "DELETE" });
}

/** Walk every user with a non-zero billing state row + every user with
 * an open pod_meter_state — used by the periodic threshold sweep so users
 * who haven't had a recent debit (e.g. all pods stopped, suspended-but-
 * grace-window-running-out) still progress through the state machine. */
export async function runThresholdSweep(opts: {
  nowSeconds?: number;
  effectRunner?: EffectRunner;
} = {}): Promise<{ users_evaluated: number; transitions: number }> {
  const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const users = db
    .prepare<[], { user_id: number }>(
      `SELECT DISTINCT u.id AS user_id
         FROM users u
    LEFT JOIN user_billing_state ubs ON ubs.user_id = u.id
    LEFT JOIN pod_meter_state pms ON pms.user_id = u.id
      AND pms.state != 'deleted' AND pms.economy_mode = 'legacy'
        WHERE ubs.user_id IS NOT NULL
           OR pms.user_id IS NOT NULL`,
    )
    .all();

  let transitions = 0;
  for (const u of users) {
    const r = await evaluateUser(u.user_id, {
      nowSeconds,
      effectRunner: opts.effectRunner,
    });
    if (r.effects.length > 0) transitions++;
  }
  return { users_evaluated: users.length, transitions };
}
