import "server-only";
import db, { type UserRow } from "../db";
import { getCurrentUser, type CurrentUser } from "../auth";
import { isAllowedAdminEmail } from "../admin-allowlist";
import { getBalanceCents, insertLedger } from "./ledger";
import { evaluateUser } from "./thresholds";

/**
 * Admin-only billing operations. Shared by /api/billing/admin/*
 * routes. Every operation:
 *
 *   1. Re-verifies that the caller is `users.is_admin = 1`.
 *   2. Logs the action with the admin's user_id + the target user_id
 *      so abuse is traceable post-hoc.
 *   3. Goes through the same atomic ledger insert path as the meter +
 *      payment flows — admin adjustments are not a privileged backdoor
 *      that bypasses idempotency or the reason enum.
 */

export class AdminError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(msg);
    this.name = "AdminError";
  }
}

/** Guard for every admin route. Throws AdminError if the caller is not
 * signed in OR is not an admin. Returns the admin's CurrentUser on
 * success. */
export async function requireAdmin(): Promise<CurrentUser> {
  const me = await getCurrentUser();
  if (!me) throw new AdminError("unauthorized", "not signed in");
  const row = db
    .prepare<[number], Pick<UserRow, "email" | "is_admin">>(
      `SELECT email, is_admin FROM users WHERE id = ?`,
    )
    .get(me.id);
  if (!row || (row.is_admin !== 1 && !isAllowedAdminEmail(row.email))) {
    throw new AdminError("forbidden", "admin access required");
  }
  return me;
}

/** Apply a manual ledger adjustment. Positive = credit (give the user
 * money), negative = debit (claw back). Always tagged with
 * reason='manual_adjustment' and a required `reason_note` so we can
 * audit what an admin did months later. */
export function adjustBalance(args: {
  admin: CurrentUser;
  targetUserId: number;
  deltaCents: number;
  note: string;
}): { newBalanceCents: number; ledgerId: number } {
  if (!Number.isInteger(args.deltaCents) || args.deltaCents === 0) {
    throw new AdminError(
      "bad_delta",
      "delta_cents must be a non-zero integer",
    );
  }
  if (args.note.trim().length < 3) {
    throw new AdminError("note_required", "audit note must be at least 3 chars");
  }
  const target = db
    .prepare<[number], Pick<UserRow, "id" | "email">>(
      `SELECT id, email FROM users WHERE id = ?`,
    )
    .get(args.targetUserId);
  if (!target) {
    throw new AdminError("target_not_found", `no user with id=${args.targetUserId}`);
  }
  const noteWithAuditor = `[admin=${args.admin.id}] ${args.note.trim()}`;
  const entry = insertLedger({
    userId: target.id,
    delta_cents: args.deltaCents,
    reason: "manual_adjustment",
    note: noteWithAuditor,
  });
  console.log(
    `[billing-admin] adjust user=${target.email} delta=${args.deltaCents}¢ by admin_id=${args.admin.id}: ${args.note}`,
  );
  return {
    newBalanceCents: getBalanceCents(target.id),
    ledgerId: entry.id,
  };
}

/** Drift check — for every user with a balance row OR a ledger entry,
 * confirm SUM(credit_ledger.delta_cents) matches what getBalanceCents()
 * reports. With the single-table append-only ledger pattern these
 * MUST agree (there's no separate balance column to drift against).
 *
 * Why we still run this: catches schema bugs early (e.g. a forgotten
 * `WHERE user_id` would inflate the balance for everyone) and
 * unexpected ledger writes from outside insertLedger().
 *
 * Returns rows where computed_balance != reported_balance OR where
 * the ledger has any malformed rows (NULL user_id, etc.). Empty array
 * is the happy path. */
export function runReconciliation(): {
  users_checked: number;
  drift: Array<{
    user_id: number;
    email: string;
    reported_cents: number;
    computed_cents: number;
    drift_cents: number;
  }>;
  malformed: Array<{ id: number; reason: string }>;
} {
  const users = db
    .prepare<[], { user_id: number; email: string }>(
      `SELECT DISTINCT u.id AS user_id, u.email
         FROM users u JOIN credit_ledger l ON l.user_id = u.id`,
    )
    .all();
  const drift: ReturnType<typeof runReconciliation>["drift"] = [];
  for (const u of users) {
    const reported = getBalanceCents(u.user_id);
    const computed =
      (
        db
          .prepare<[number], { s: number | null }>(
            `SELECT SUM(delta_cents) AS s FROM credit_ledger WHERE user_id = ?`,
          )
          .get(u.user_id) ?? { s: 0 }
      ).s ?? 0;
    if (reported !== computed) {
      drift.push({
        user_id: u.user_id,
        email: u.email,
        reported_cents: reported,
        computed_cents: computed,
        drift_cents: reported - computed,
      });
    }
  }
  const malformed = db
    .prepare<[], { id: number; reason: string }>(
      `SELECT id, 'null_user_id_or_delta' AS reason FROM credit_ledger
        WHERE user_id IS NULL OR delta_cents IS NULL`,
    )
    .all();
  return { users_checked: users.length, drift, malformed };
}

/** Force a user's threshold evaluation. Used when an admin manually
 * tops up a user's balance and wants the suspend-resume to fire right
 * away (rather than waiting for the next sweep tick). */
export async function reevaluateThresholds(userId: number): Promise<void> {
  await evaluateUser(userId);
}

/** Flip a user's is_admin bit. Bootstraps the very first admin —
 * subsequent admins are made via the admin UI (when it exists) or by
 * the existing admin calling this. Refuses to remove the LAST admin so
 * we can't lock ourselves out by demoting everyone. */
export function setAdmin(args: {
  admin: CurrentUser;
  targetUserId: number;
  makeAdmin: boolean;
}): { wasAdmin: boolean; isAdmin: boolean } {
  if (args.admin.id === args.targetUserId && !args.makeAdmin) {
    // Self-demotion — only allow if at least one OTHER admin exists.
    const others = db
      .prepare<[number], { c: number }>(
        `SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND id != ?`,
      )
      .get(args.admin.id);
    if (!others || others.c === 0) {
      throw new AdminError(
        "last_admin",
        "refuse to demote the last remaining admin",
      );
    }
  }
  const target = db
    .prepare<[number], Pick<UserRow, "id" | "is_admin">>(
      `SELECT id, is_admin FROM users WHERE id = ?`,
    )
    .get(args.targetUserId);
  if (!target) {
    throw new AdminError("target_not_found", `no user with id=${args.targetUserId}`);
  }
  db.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(
    args.makeAdmin ? 1 : 0,
    args.targetUserId,
  );
  return { wasAdmin: target.is_admin === 1, isAdmin: args.makeAdmin };
}
