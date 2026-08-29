import "server-only";
import db, { type BillingCustomerRow } from "@/lib/db";

export function getBillingCustomerByUser(
  userId: number,
): BillingCustomerRow | null {
  return (
    db
      .prepare<[number], BillingCustomerRow>(
        `SELECT * FROM billing_customers WHERE user_id = ?`,
      )
      .get(userId) ?? null
  );
}

export function upsertBillingCustomer(input: {
  userId: number;
  dodoCustomerId: string | null | undefined;
  email?: string | null;
  metadata?: unknown;
}): void {
  if (!input.dodoCustomerId) return;
  const metadataJson =
    input.metadata === undefined ? null : JSON.stringify(input.metadata);
  db.prepare(
    `INSERT INTO billing_customers (
       user_id,
       dodo_customer_id,
       email,
       metadata_json,
       updated_at
     )
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       dodo_customer_id = excluded.dodo_customer_id,
       email = COALESCE(excluded.email, billing_customers.email),
       metadata_json = COALESCE(excluded.metadata_json, billing_customers.metadata_json),
       updated_at = datetime('now')`,
  ).run(
    input.userId,
    input.dodoCustomerId,
    input.email ?? null,
    metadataJson,
  );
}
