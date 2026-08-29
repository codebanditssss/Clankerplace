import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCreditSnapshot } from "@/lib/billing/credits";
import { CREDIT_PACKS } from "@/lib/billing/plans";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const snapshot = getCreditSnapshot(me.id);
  return NextResponse.json({
    balance_cents: snapshot.balance_cents,
    balance_usd: snapshot.balance_usd,
    currency: snapshot.currency,
    packs: Object.values(CREDIT_PACKS).map((pack) => ({
      id: pack.id,
      label: pack.label,
      amount_cents: pack.amountCents,
    })),
    transactions: snapshot.transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount_cents: tx.amount_cents,
      balance_after_cents: tx.balance_after_cents,
      description: tx.description,
      created_at: tx.created_at,
    })),
  });
}
