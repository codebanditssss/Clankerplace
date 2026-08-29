import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createSubscriptionCheckout } from "@/lib/billing/dodo";
import { isActiveSubscriptionStatus, isSelfServePlanId } from "@/lib/billing/plans";
import { getBillingCustomerByUser } from "@/lib/billing/customers";
import { getCurrentSubscription } from "@/lib/billing/subscriptions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const plan = (body as { plan?: unknown })?.plan;
  if (typeof plan !== "string" || !isSelfServePlanId(plan)) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  try {
    const current = getCurrentSubscription(me.id);
    if (
      current?.dodo_subscription_id &&
      isActiveSubscriptionStatus(current.status)
    ) {
      return NextResponse.json(
        {
          error: "billing_portal_required",
          message:
            "You already have an active subscription. Use Manage billing to change plans.",
        },
        { status: 409 },
      );
    }
    const customer = getBillingCustomerByUser(me.id);
    const session = await createSubscriptionCheckout({
      plan,
      userId: me.id,
      email: me.email,
      existingCustomerId: customer?.dodo_customer_id ?? current?.dodo_customer_id,
      returnUrl: `${requestOrigin(req)}/billing`,
    });
    return NextResponse.json(session);
  } catch (err) {
    console.error("[billing/checkout] failed:", err);
    return NextResponse.json(
      { error: "checkout_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

function requestOrigin(req: NextRequest): string {
  const configured = process.env.PODS_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}
