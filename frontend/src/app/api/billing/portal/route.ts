import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createCustomerPortal } from "@/lib/billing/dodo";
import { getBillingCustomerByUser } from "@/lib/billing/customers";
import { getCurrentSubscription } from "@/lib/billing/subscriptions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const current = getCurrentSubscription(me.id);
  const customer = getBillingCustomerByUser(me.id);
  const dodoCustomerId = customer?.dodo_customer_id ?? current?.dodo_customer_id;
  if (!dodoCustomerId) {
    return NextResponse.json(
      { error: "no_dodo_customer", message: "Subscribe or buy credits before opening the billing portal." },
      { status: 409 },
    );
  }

  try {
    const session = await createCustomerPortal({
      dodoCustomerId,
      returnUrl: `${requestOrigin(req)}/billing`,
    });
    return NextResponse.json(session);
  } catch (err) {
    console.error("[billing/portal] failed:", err);
    return NextResponse.json(
      { error: "portal_failed", message: err instanceof Error ? err.message : String(err) },
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
