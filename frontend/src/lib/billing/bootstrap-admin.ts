import "server-only";
import db from "../db";
import { isAllowedAdminEmail } from "../admin-allowlist";

/**
 * Operator bootstrap: any user whose email matches BOOTSTRAP_ADMIN_EMAIL
 * gets `is_admin = 1` automatically. Wired into:
 *
 *   1. db.ts (every process boot) — covers the "user already exists"
 *      case + the "env var changed" case.
 *   2. lib/auth.ts signup paths (verifySignupOtp, findOrCreateOauthUser,
 *      findOrCreateWalletUser) — covers the "user just signed up" case
 *      so the operator doesn't need to restart the server to claim
 *      admin after their first login.
 *
 * Idempotent. Failure modes are non-fatal (log + continue) so admin
 * promotion can never block signup or app boot.
 *
 * To switch admin: change BOOTSTRAP_ADMIN_EMAIL env var and restart.
 * The previous admin's is_admin flag is NOT cleared by the env switch
 * — call setAdmin({makeAdmin: false}) via the API to demote, or do it
 * with SQL.
 */

export function bootstrapAdminEmail(): string | null {
  const v = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!v) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
    console.warn(
      `[bootstrap-admin] BOOTSTRAP_ADMIN_EMAIL='${v}' is not a valid email; ignoring`,
    );
    return null;
  }
  return v;
}

/** Promote one specific user-by-id if their email matches the bootstrap
 * env. Used at signup-completion time. */
export function maybePromoteAdmin(userId: number, email: string): void {
  if (!isAllowedAdminEmail(email)) return;
  try {
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(userId);
    console.warn(
      `[bootstrap-admin] auto-promoted user_id=${userId} (${email}) at signup`,
    );
  } catch (err) {
    console.warn(
      `[bootstrap-admin] auto-promote failed for ${email}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
