// POST /api/admin/users/[id]/delete
// Hard-delete a user. Cascades manually because some legacy tables have no
// FK constraints. Pelican-side users/servers are not deleted here; support can
// clean those up from the Pelican panel if needed.

import { NextResponse } from "next/server";
import db, { type UserRow } from "@/lib/db";
import {
  NotAdminError,
  auditAdminAction,
  requestMeta,
  requireAdmin,
  scrubRow,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

const TABLES_BY_USER_ID = [
  "credit_ledger",
  "credit_transactions",
  "billing_events",
  "credit_balances",
  "billing_customers",
  "subscriptions",
  "invoices",
  "oauth_identities",
  "wallet_identities",
  "account_email_login_migrations",
  "password_reset_codes",
  "pod_meter_state",
  "pod_domains",
  "promo_redemptions",
  "user_billing_state",
] as const;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    if (e instanceof NotAdminError) {
      return new NextResponse("not found", { status: 404 });
    }
    throw e;
  }

  const { id } = await ctx.params;
  const userId = parseInt(id, 10);
  if (userId === admin.id) {
    return NextResponse.json(
      { error: "you cannot delete yourself" },
      { status: 400 },
    );
  }

  const before = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!before) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const tx = db.transaction(() => {
    // pod_emails has no user_id column, so remove those rows before deleting
    // the pod ownership rows that identify this user's pod UUIDs.
    try {
      db.prepare(
        `DELETE FROM pod_emails
          WHERE pod_uuid_short IN (
            SELECT pod_uuid_short FROM pod_domains WHERE user_id = ?
            UNION
            SELECT pod_uuid_short FROM pod_meter_state WHERE user_id = ?
          )`,
      ).run(userId, userId);
    } catch {
      // Table may not exist on legacy DBs.
    }

    try {
      db.prepare(
        `DELETE FROM invoice_keypairs
          WHERE invoice_id IN (
            SELECT id FROM invoices WHERE user_id = ?
          )`,
      ).run(userId);
    } catch {
      // Table may not exist on legacy DBs.
    }

    for (const table of TABLES_BY_USER_ID) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      } catch {
        // Table may not exist on legacy DBs.
      }
    }

    try {
      db.prepare("DELETE FROM pending_signups WHERE email = ?").run(before.email);
    } catch {
      // ignore
    }

    try {
      db.prepare(
        "DELETE FROM referrals WHERE referrer_user_id = ? OR referee_user_id = ?",
      ).run(userId, userId);
    } catch {
      // ignore
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  tx();

  const meta = await requestMeta();
  auditAdminAction({
    actorId: admin.id,
    action: "user.delete",
    targetType: "user",
    targetId: userId,
    before: scrubRow(before),
    ...meta,
  });
  return NextResponse.json({ ok: true });
}
