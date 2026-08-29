import { NextResponse, type NextRequest } from "next/server";
import { AdminError, requireAdmin } from "@/lib/billing/admin";
import { DEFAULTS, resetConfig, type ConfigKey } from "@/lib/billing/config";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/billing/admin/config/reset
 *   Body: { keys: [<key>, ...] }
 *   → { ok: true, reset: [...] }
 *
 * Removes the billing_config row(s), so subsequent reads fall back
 * to the code default. Use this to "undo" an admin change without
 * having to remember the original default value.
 */
export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof AdminError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.code === "unauthorized" ? 401 : 403 },
      );
    }
    throw err;
  }
  const rl = rateLimit(`admin.config.reset:${admin.id}`, {
    rate: 10 / 60,
    burst: 3,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const keys = (body as { keys?: unknown }).keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    return NextResponse.json(
      { error: "keys_array_required" },
      { status: 400 },
    );
  }
  const reset: string[] = [];
  for (const k of keys) {
    if (typeof k !== "string" || !(k in DEFAULTS)) {
      return NextResponse.json(
        { error: "unknown_key", key: k, partial: reset },
        { status: 400 },
      );
    }
    resetConfig({ key: k as ConfigKey, adminId: admin.id });
    reset.push(k);
  }
  return NextResponse.json({ ok: true, reset });
}
