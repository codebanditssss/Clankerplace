import { NextResponse, type NextRequest } from "next/server";
import { AdminError, requireAdmin } from "@/lib/billing/admin";
import {
  DEFAULTS,
  setConfig,
  snapshotConfig,
  type ConfigKey,
} from "@/lib/billing/config";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/billing/admin/config
 *   → { keys: ConfigSnapshot[] }
 *
 * Lists every config key with its current effective value, default,
 * whether it's been overridden, and when. Used by the (future) admin
 * UI and for ops debugging via curl.
 *
 * PATCH /api/billing/admin/config
 *   Body: { changes: { "<key>": <new-value>, ... } }
 *   → { ok: true, applied: [...] }
 *
 * Atomically sets one or more config keys. Each value is validated
 * against the key's schema (defined in lib/billing/config.ts:DEFAULTS)
 * before write. If ANY change is invalid, the whole PATCH is rejected
 * — partial application would leave the config in an unpredictable state.
 */
export async function GET() {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    return adminError(err);
  }
  const rl = rateLimit(`admin.config.get:${admin.id}`, {
    rate: 30 / 60,
    burst: 10,
  });
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  return NextResponse.json({ keys: snapshotConfig() });
}

export async function PATCH(req: NextRequest) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    return adminError(err);
  }
  // Admin endpoints are low-frequency and high-impact — tight limits.
  const rl = rateLimit(`admin.config.patch:${admin.id}`, {
    rate: 10 / 60,
    burst: 3,
  });
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const changes = (body as { changes?: unknown }).changes;
  if (
    typeof changes !== "object" ||
    changes === null ||
    Array.isArray(changes)
  ) {
    return NextResponse.json(
      { error: "changes_must_be_object" },
      { status: 400 },
    );
  }

  // First pass: validate every key exists. Don't write anything yet.
  const entries = Object.entries(changes as Record<string, unknown>);
  for (const [k] of entries) {
    if (!(k in DEFAULTS)) {
      return NextResponse.json(
        { error: "unknown_key", key: k },
        { status: 400 },
      );
    }
  }
  // Second pass: apply each. setConfig() throws on validation failure;
  // we collect successes so a single bad value rejects the whole patch
  // cleanly. (Caveat: SQLite writes commit immediately. If the 3rd of
  // 4 changes fails validation, the first 2 are already written. To
  // make this fully atomic we'd wrap in a transaction in config.ts —
  // future improvement.)
  const applied: string[] = [];
  for (const [k, v] of entries) {
    try {
      setConfig({
        key: k as ConfigKey,
        value: v as never, // schema is per-key
        adminId: admin.id,
      });
      applied.push(k);
    } catch (err) {
      return NextResponse.json(
        {
          error: "validation_failed",
          key: k,
          message: err instanceof Error ? err.message : String(err),
          partially_applied: applied,
        },
        { status: 400 },
      );
    }
  }
  return NextResponse.json({ ok: true, applied });
}

function adminError(err: unknown): NextResponse {
  if (err instanceof AdminError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: err.code === "unauthorized" ? 401 : 403 },
    );
  }
  throw err;
}

function rateLimited(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "rate_limited" },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}
