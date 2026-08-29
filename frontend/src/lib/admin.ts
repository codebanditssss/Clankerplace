// Admin RBAC + audit log helpers.
//
// Two entry points:
//   - requireAdmin()          — server-component / route-handler gate.
//                               Returns the admin's CurrentUser or throws
//                               a NotAdmin error the caller maps to 404
//                               (never 403 — we don't even acknowledge the
//                               admin surface exists for non-admins).
//   - auditAdminAction(...)   — write one row to admin_audit_log. Caller
//                               MUST pre-scrub secrets from before/after.
//                               Best-effort write — never throws (we don't
//                               want a logger bug blocking the action).
//
// Impersonation lives here too: startImpersonation, endImpersonation,
// resolveImpersonationCookie. The cookie is `pods_admin_imp` and carries
// a random token whose hash is in admin_impersonations.
import "server-only";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import db, {
  type AdminAuditLogRow,
  type AdminImpersonationRow,
  type UserRow,
} from "@/lib/db";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { isAllowedAdminEmail } from "@/lib/admin-allowlist";

export const ADMIN_IMP_COOKIE = "pods_admin_imp";
const IMP_TTL_SEC = 30 * 60; // 30 min hard cap

export class NotAdminError extends Error {
  constructor() {
    super("not an admin");
    this.name = "NotAdminError";
  }
}

/**
 * Server-only gate. Use at the top of every server component under
 * /admin and every /api/admin/** route handler. Throws NotAdminError
 * for non-admins so the layout can render a 404, never a 403.
 *
 * Reads the role column (preferred) and falls back to is_admin=1 for
 * legacy rows.
 */
export async function requireAdmin(): Promise<CurrentUser & { role: string }> {
  const user = await getCurrentUser();
  if (!user) throw new NotAdminError();
  const row = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(user.id);
  if (!row) throw new NotAdminError();
  if (row.suspended_at) throw new NotAdminError(); // suspended admin = no access
  const role = row.role ?? "user";
  if (role !== "admin" && row.is_admin !== 1 && !isAllowedAdminEmail(row.email)) {
    throw new NotAdminError();
  }
  return { ...user, role };
}

/**
 * Resolve `requireAdmin()` to a boolean. Useful in the root layout where
 * we don't want to throw — we only want to know whether to render the
 * admin nav at all.
 */
export async function isAdminUser(): Promise<boolean> {
  try {
    await requireAdmin();
    return true;
  } catch {
    return false;
  }
}

export type AdminAction =
  // user actions
  | "user.suspend"
  | "user.unsuspend"
  | "user.grant_credit"
  | "user.force_password_reset"
  | "user.migrate_legacy_wallet"
  | "user.resend_verification"
  | "user.revoke_sessions"
  | "user.delete"
  | "user.promote_role"
  | "user.impersonate.start"
  | "user.impersonate.end"
  // pod actions
  | "pod.restart"
  | "pod.stop"
  | "pod.kill"
  | "pod.delete"
  | "pod.reassign"
  // billing actions
  | "invoice.mark_paid"
  | "invoice.refund"
  | "invoice.void"
  | "ledger.adjust"
  | "promo.create"
  | "promo.disable"
  // config
  | "config.update";

/**
 * Append a row to admin_audit_log. Best-effort — failures are logged
 * to stderr and swallowed. NEVER pass raw secrets in before/after;
 * callers must scrub password hashes, OAuth tokens, legacy billing secrets,
 * etc. first.
 */
export function auditAdminAction(opts: {
  actorId: number;
  action: AdminAction;
  targetType: "user" | "pod" | "invoice" | "ledger" | "promo" | "config" | "system";
  targetId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): void {
  try {
    db.prepare(
      `INSERT INTO admin_audit_log
         (actor_user_id, action, target_type, target_id,
          before_json, after_json, ip, user_agent, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      opts.actorId,
      opts.action,
      opts.targetType,
      opts.targetId == null ? null : String(opts.targetId),
      opts.before == null ? null : JSON.stringify(opts.before),
      opts.after == null ? null : JSON.stringify(opts.after),
      opts.ip ?? null,
      opts.userAgent ?? null,
      Math.floor(Date.now() / 1000),
    );
  } catch (err) {
    console.error("[admin] audit log write failed", err);
  }
}

/**
 * Convenience: read IP + UA from the current request headers so callers
 * don't have to thread them. Returns {ip, userAgent} that you spread
 * into auditAdminAction.
 */
export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null;
  const userAgent = h.get("user-agent") ?? null;
  return { ip, userAgent };
}

/**
 * Strip values that should never reach the audit log even by accident.
 * Use on row objects before passing to auditAdminAction.
 */
export function scrubRow<T extends Record<string, unknown>>(row: T): Partial<T> {
  const SECRET_KEYS = new Set([
    "password_hash",
    "pelican_client_token",
    "code_hash",
    "token_hash",
    "ciphertext_hex",
    "auth_tag_hex",
    "iv_hex",
    "secret_key",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

// --- Impersonation ---

/**
 * Start an impersonation session. Inserts the row, sets the cookie, and
 * audits. Returns the random token (also stored hashed in DB).
 */
export async function startImpersonation(
  adminId: number,
  targetUserId: number,
  reason: string | null,
): Promise<void> {
  if (adminId === targetUserId) throw new Error("cannot impersonate self");
  // End any prior active session for this admin first — one at a time.
  endActiveImpersonations(adminId);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  const expires = now + IMP_TTL_SEC;
  const { ip, userAgent } = await requestMeta();
  db.prepare(
    `INSERT INTO admin_impersonations
       (admin_user_id, target_user_id, token_hash, reason, started_at, expires_at, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(adminId, targetUserId, tokenHash, reason, now, expires, ip);
  const jar = await cookies();
  jar.set(ADMIN_IMP_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: IMP_TTL_SEC,
    domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
  });
  auditAdminAction({
    actorId: adminId,
    action: "user.impersonate.start",
    targetType: "user",
    targetId: targetUserId,
    after: { reason, expires_at: expires },
    ip,
    userAgent,
  });
}

/** End any open impersonation sessions for this admin (close-on-logout). */
export function endActiveImpersonations(adminId: number): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE admin_impersonations
        SET ended_at = ?
      WHERE admin_user_id = ?
        AND ended_at IS NULL`,
  ).run(now, adminId);
}

export async function endImpersonationFromCookie(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_IMP_COOKIE)?.value;
  if (!token) return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare<[string], AdminImpersonationRow>(
      "SELECT * FROM admin_impersonations WHERE token_hash = ? AND ended_at IS NULL",
    )
    .get(tokenHash);
  if (row) {
    db.prepare(
      "UPDATE admin_impersonations SET ended_at = ? WHERE id = ?",
    ).run(now, row.id);
    auditAdminAction({
      actorId: row.admin_user_id,
      action: "user.impersonate.end",
      targetType: "user",
      targetId: row.target_user_id,
    });
  }
  jar.set(ADMIN_IMP_COOKIE, "", {
    path: "/",
    maxAge: 0,
    domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
  });
}

/**
 * Returns the impersonation context (admin → target) if the cookie is
 * present, valid, and not expired/ended. Null otherwise.
 */
export async function readImpersonation(): Promise<
  | { adminUserId: number; targetUserId: number; expiresAt: number }
  | null
> {
  const jar = await cookies();
  const token = jar.get(ADMIN_IMP_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = db
    .prepare<[string], AdminImpersonationRow>(
      "SELECT * FROM admin_impersonations WHERE token_hash = ? AND ended_at IS NULL",
    )
    .get(tokenHash);
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    // expired — auto-close
    db.prepare(
      "UPDATE admin_impersonations SET ended_at = ? WHERE id = ?",
    ).run(Math.floor(Date.now() / 1000), row.id);
    return null;
  }
  return {
    adminUserId: row.admin_user_id,
    targetUserId: row.target_user_id,
    expiresAt: row.expires_at,
  };
}

// --- Read helpers for the audit page ---

export function listAuditLog(opts: {
  actorId?: number;
  targetType?: string;
  targetId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}): AdminAuditLogRow[] {
  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (opts.actorId != null) {
    filters.push("actor_user_id = ?");
    params.push(opts.actorId);
  }
  if (opts.targetType) {
    filters.push("target_type = ?");
    params.push(opts.targetType);
  }
  if (opts.targetId) {
    filters.push("target_id = ?");
    params.push(opts.targetId);
  }
  if (opts.action) {
    filters.push("action = ?");
    params.push(opts.action);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  return db
    .prepare<unknown[], AdminAuditLogRow>(
      `SELECT * FROM admin_audit_log ${where}
       ORDER BY ts DESC, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
    )
    .all(...params);
}

export function countAuditLog(opts: {
  actorId?: number;
  targetType?: string;
  targetId?: string;
  action?: string;
}): number {
  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (opts.actorId != null) {
    filters.push("actor_user_id = ?");
    params.push(opts.actorId);
  }
  if (opts.targetType) {
    filters.push("target_type = ?");
    params.push(opts.targetType);
  }
  if (opts.targetId) {
    filters.push("target_id = ?");
    params.push(opts.targetId);
  }
  if (opts.action) {
    filters.push("action = ?");
    params.push(opts.action);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const row = db
    .prepare<unknown[], { c: number }>(
      `SELECT COUNT(*) c FROM admin_audit_log ${where}`,
    )
    .get(...params);
  return row?.c ?? 0;
}
