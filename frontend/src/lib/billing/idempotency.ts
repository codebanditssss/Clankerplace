import "server-only";
import db from "../db";

/**
 * Idempotency-Key support for mutating billing endpoints.
 *
 * Pattern (mirrors Stripe's): client sends `Idempotency-Key: <random>`
 * header. Server scopes it by endpoint identity so the same key can't
 * accidentally be reused on /admin/adjust AND /admin/suspend.
 *
 *   const replay = lookupIdempotent({ key, scope });
 *   if (replay) return NextResponse.json(replay.response, { status: replay.status });
 *   // ... do the work ...
 *   storeIdempotent({ key, scope, response, status });
 *
 * Idempotency rows expire 24h after creation; the meter tick (or any
 * other periodic job) can prune via pruneExpiredIdempotency().
 */

export type IdempotencyHit<T> = {
  response: T;
  status: number;
  created_at: number;
};

const TTL_SECONDS = 24 * 60 * 60;

export function lookupIdempotent<T>(args: {
  key: string;
  scope: string;
}): IdempotencyHit<T> | null {
  const row = db
    .prepare<
      [string, string, number],
      {
        response_json: string;
        status_code: number;
        created_at: number;
      }
    >(
      `SELECT response_json, status_code, created_at
         FROM idempotency_keys
        WHERE key = ? AND scope = ? AND expires_at > ?`,
    )
    .get(args.key, args.scope, Math.floor(Date.now() / 1000));
  if (!row) return null;
  try {
    const response = JSON.parse(row.response_json) as T;
    return {
      response,
      status: row.status_code,
      created_at: row.created_at,
    };
  } catch {
    // Corrupted row — pretend it doesn't exist so the caller re-runs.
    // A future prune will clean it up.
    return null;
  }
}

export function storeIdempotent<T>(args: {
  key: string;
  scope: string;
  response: T;
  status: number;
}): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT OR REPLACE INTO idempotency_keys
       (key, scope, response_json, status_code, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    args.key,
    args.scope,
    JSON.stringify(args.response),
    args.status,
    now,
    now + TTL_SECONDS,
  );
}

export function pruneExpiredIdempotency(
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number {
  const r = db
    .prepare(`DELETE FROM idempotency_keys WHERE expires_at < ?`)
    .run(nowSeconds);
  return r.changes;
}

/** Basic shape validation: 8–128 chars, ASCII printable only. Caller
 * is the source of randomness; we just guard against header pollution. */
export function isValidIdempotencyKey(key: string): boolean {
  if (typeof key !== "string") return false;
  if (key.length < 8 || key.length > 128) return false;
  return /^[\x21-\x7e]+$/.test(key);
}
