import { NextResponse, type NextRequest } from "next/server";
import { recordManagedUsage } from "@/lib/billing/credits";
import { getConfig } from "@/lib/billing/config";

export const runtime = "nodejs";

/**
 * Internal-only usage ingestion for the managed-AI gateway worker.
 *
 * The worker calls this after a Pods Managed inference completes, reporting
 * the upstream's real inference cost (USD). We apply the configured markup
 * and debit the user's credit wallet (sub-cent costs accrue in micro-units;
 * see recordManagedUsage). Protected by the MANAGED_USAGE_TOKEN shared
 * secret. Idempotent on request_id.
 *
 * 1 USD = 1,000,000 micro-units (1 cent = 10,000 micro-units).
 */
const MICRO_UNITS_PER_USD = 1_000_000;

type UsageBody = {
  user_id?: unknown;
  request_id?: unknown;
  model?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  upstream_cost_usd?: unknown;
  pod_short?: unknown;
};

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-internal-token");
  const expected = process.env.MANAGED_USAGE_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "managed_usage_not_configured" }, { status: 503 });
  }
  if (!token || token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: UsageBody;
  try {
    body = (await req.json()) as UsageBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const userId = Number(body.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "invalid_user_id" }, { status: 400 });
  }
  const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
  if (!requestId) {
    return NextResponse.json({ error: "missing_request_id" }, { status: 400 });
  }

  const upstreamCostUsd = Number(body.upstream_cost_usd);
  const safeCost = Number.isFinite(upstreamCostUsd) && upstreamCostUsd > 0 ? upstreamCostUsd : 0;
  const markup = getConfig("managed.markup_multiplier", { userId });

  // Cost the user pays, in micro-units, before accrual rounding.
  const costMicroUnits = Math.round(safeCost * markup * MICRO_UNITS_PER_USD);

  try {
    const result = recordManagedUsage({
      userId,
      costMicroUnits,
      requestId,
      description: "Pods Managed AI usage",
      metadata: {
        model: typeof body.model === "string" ? body.model : undefined,
        pod_short: typeof body.pod_short === "string" ? body.pod_short : undefined,
        prompt_tokens: Number.isFinite(Number(body.prompt_tokens))
          ? Number(body.prompt_tokens)
          : undefined,
        completion_tokens: Number.isFinite(Number(body.completion_tokens))
          ? Number(body.completion_tokens)
          : undefined,
        upstream_cost_usd: safeCost,
        markup,
      },
    });
    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      charged_cents: result.charged_cents,
      balance_cents: result.balance_cents,
      cost_micro_units: costMicroUnits,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[managed-usage] debit failed:", msg);
    return NextResponse.json({ error: "debit_failed", message: msg }, { status: 500 });
  }
}
