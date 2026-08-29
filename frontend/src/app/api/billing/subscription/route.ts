import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  canCreatePod,
  countActivePods,
  getCurrentSubscription,
} from "@/lib/billing/subscriptions";
import {
  getPlanResourceLimits,
  PLANS,
  type PlanId,
} from "@/lib/billing/plans";
import { getLatestDodoPaymentAttempt } from "@/lib/billing/payment-attempts";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const subscription = getCurrentSubscription(me.id);
  const gate = canCreatePod(me.id);
  const activePodCount = subscription?.active_pod_count ?? countActivePods(me.id);
  const paymentAttempt = getLatestDodoPaymentAttempt(me.id, {
    subscriptionId: subscription?.dodo_subscription_id,
    plan: subscription?.plan,
    subscriptionOnly: true,
  });
  const gateMessage =
    !gate.ok && paymentAttempt?.status === "failed"
      ? paymentAttempt.error_message
        ? `Payment failed: ${paymentAttempt.error_message}`
        : "Payment failed. Retry checkout or update your payment method."
      : gate.ok
        ? null
        : gate.message;
  if (!subscription) {
    return NextResponse.json({
      subscription: null,
      active_pod_count: activePodCount,
      active_pod_limit: 0,
      plan_resource_limits: null,
      payment_attempt: paymentAttempt ? serializePaymentAttempt(paymentAttempt) : null,
      can_create_pod: false,
      gate_reason: gate.ok ? null : gate.reason,
      message: gateMessage,
    });
  }

  const plan = PLANS[subscription.plan as PlanId] ?? null;
  const resourceLimits = getPlanResourceLimits(subscription.plan);
  return NextResponse.json({
    subscription: {
      plan: subscription.plan,
      plan_name: plan?.name ?? subscription.plan,
      status: subscription.status,
      renewal_date: subscription.renewal_date,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end === 1,
    },
    payment_attempt: paymentAttempt ? serializePaymentAttempt(paymentAttempt) : null,
    active_pod_count: subscription.active_pod_count,
    active_pod_limit: subscription.plan_limit,
    plan_resource_limits: resourceLimits
      ? {
          ram_gb: resourceLimits.ramGb,
          cpu: resourceLimits.cpu,
          ram_mib: resourceLimits.ramMib,
          cpu_percent: resourceLimits.cpuPercent,
        }
      : null,
    can_create_pod: gate.ok,
    gate_reason: gate.ok ? null : gate.reason,
    message: gateMessage,
  });
}

function serializePaymentAttempt(attempt: {
  status: string;
  event_type: string;
  error_code: string | null;
  error_message: string | null;
  invoice_url: string | null;
  receipt_url: string | null;
  updated_at: string;
}) {
  return {
    status: attempt.status,
    event_type: attempt.event_type,
    error_code: attempt.error_code,
    error_message: attempt.error_message,
    invoice_url: attempt.invoice_url,
    receipt_url: attempt.receipt_url,
    updated_at: attempt.updated_at,
  };
}
