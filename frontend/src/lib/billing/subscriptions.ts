import "server-only";
import db, { type SubscriptionRow } from "@/lib/db";
import {
  isActiveSubscriptionStatus,
  isBlockedSubscriptionStatus,
  PLANS,
  type PlanId,
} from "./plans";

export type CurrentSubscription = SubscriptionRow & {
  plan_limit: number | null;
  active_pod_count: number;
  is_active: boolean;
};

export type DeployGateResult =
  | {
      ok: true;
      subscription: CurrentSubscription;
      active_pod_count: number;
      active_pod_limit: number | null;
    }
  | {
      ok: false;
      reason:
        | "no_subscription"
        | "account_suspended"
        | "subscription_inactive"
        | "pod_limit_exceeded"
        | "unknown_plan";
      message: string;
      status?: string | null;
      plan?: string | null;
      active_pod_count?: number;
      active_pod_limit?: number | null;
    };

export function getCurrentSubscription(userId: number): CurrentSubscription | null {
  const row =
    db
      .prepare<[number], SubscriptionRow>(
        `SELECT *
           FROM subscriptions
          WHERE user_id = ?
          ORDER BY
            CASE WHEN status IN ('active','trialing') THEN 0 ELSE 1 END,
            updated_at DESC,
            id DESC
          LIMIT 1`,
      )
      .get(userId) ?? null;

  if (!row) return null;
  const plan = PLANS[row.plan as PlanId];
  const activePodCount = countActivePods(userId);
  return {
    ...row,
    plan_limit: plan?.activePodLimit ?? null,
    active_pod_count: activePodCount,
    is_active: isActiveSubscriptionStatus(row.status),
  };
}

export function countActivePods(userId: number): number {
  const row = db
    .prepare<[number, number], { count: number }>(
      `SELECT COUNT(DISTINCT pod_uuid_short) AS count
         FROM (
           SELECT pod_uuid_short
             FROM pod_meter_state
            WHERE user_id = ?
              AND state IN ('provisioning','running','stopped','suspended')
           UNION
           SELECT pod_uuid_short
             FROM pod_domains
            WHERE user_id = ?
         )`,
    )
    .get(userId, userId);
  return row?.count ?? 0;
}

export function canCreatePod(userId: number): DeployGateResult {
  const user = db
    .prepare<[number], { suspended_at: string | null }>(
      `SELECT suspended_at FROM users WHERE id = ?`,
    )
    .get(userId);
  if (user?.suspended_at) {
    return {
      ok: false,
      reason: "account_suspended",
      message: "This account is suspended and cannot create new pods.",
    };
  }

  const subscription = getCurrentSubscription(userId);
  if (!subscription) {
    return {
      ok: false,
      reason: "no_subscription",
      message: "Choose a subscription plan to create a new pod.",
    };
  }

  if (isBlockedSubscriptionStatus(subscription.status)) {
    return {
      ok: false,
      reason: "subscription_inactive",
      message: "Your subscription is not active. Manage billing to continue.",
      status: subscription.status,
      plan: subscription.plan,
    };
  }

  const plan = PLANS[subscription.plan as PlanId];
  if (!plan) {
    return {
      ok: false,
      reason: "unknown_plan",
      message: "Your subscription plan is not recognized. Contact support.",
      status: subscription.status,
      plan: subscription.plan,
    };
  }

  const limit = plan.activePodLimit;
  if (limit !== null && subscription.active_pod_count >= limit) {
    return {
      ok: false,
      reason: "pod_limit_exceeded",
      message: `Your ${plan.name} plan includes ${limit} active pod${limit === 1 ? "" : "s"}. Upgrade to create another pod.`,
      status: subscription.status,
      plan: subscription.plan,
      active_pod_count: subscription.active_pod_count,
      active_pod_limit: limit,
    };
  }

  return {
    ok: true,
    subscription,
    active_pod_count: subscription.active_pod_count,
    active_pod_limit: limit,
  };
}

export function upsertSubscriptionFromDodo(input: {
  userId: number;
  plan: PlanId;
  status: string;
  dodoCustomerId?: string | null;
  dodoSubscriptionId?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  cancelledAt?: string | null;
  renewalDate?: string | null;
  providerUpdatedAt?: string | null;
  rawPayload?: unknown;
}): void {
  const payload = input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload);
  db.prepare(
    `INSERT INTO subscriptions (
       user_id,
       dodo_customer_id,
       dodo_subscription_id,
       plan,
       status,
       current_period_start,
       current_period_end,
       cancel_at_period_end,
       cancelled_at,
       renewal_date,
       provider_updated_at,
       raw_status_payload_json,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(dodo_subscription_id) DO UPDATE SET
       user_id = excluded.user_id,
       dodo_customer_id = COALESCE(excluded.dodo_customer_id, subscriptions.dodo_customer_id),
       plan = excluded.plan,
       status = excluded.status,
       current_period_start = COALESCE(excluded.current_period_start, subscriptions.current_period_start),
       current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
       cancel_at_period_end = CASE
         WHEN ? THEN excluded.cancel_at_period_end
         ELSE subscriptions.cancel_at_period_end
       END,
       cancelled_at = excluded.cancelled_at,
       renewal_date = COALESCE(excluded.renewal_date, subscriptions.renewal_date),
       provider_updated_at = excluded.provider_updated_at,
       raw_status_payload_json = excluded.raw_status_payload_json,
       updated_at = datetime('now')
     WHERE subscriptions.provider_updated_at IS NULL
        OR (
          excluded.provider_updated_at IS NOT NULL
          AND datetime(excluded.provider_updated_at) >= datetime(subscriptions.provider_updated_at)
        )`,
  ).run(
    input.userId,
    input.dodoCustomerId ?? null,
    input.dodoSubscriptionId ?? null,
    input.plan,
    input.status,
    input.currentPeriodStart ?? null,
    input.currentPeriodEnd ?? null,
    input.cancelAtPeriodEnd ? 1 : 0,
    input.cancelledAt ?? null,
    input.renewalDate ?? input.currentPeriodEnd ?? null,
    input.providerUpdatedAt ?? null,
    payload,
    input.cancelAtPeriodEnd === undefined ? 0 : 1,
  );
}
