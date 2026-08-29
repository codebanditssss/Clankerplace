import "server-only";
import db, { type CreditLedgerRow, type LedgerReason } from "../db";

/**
 * Append-only credit ledger. The ledger is the single source of truth
 * for a user's balance — there is no "users.balance_cents" column to
 * keep in sync. Balance = SUM(delta_cents) WHERE user_id = ?.
 *
 * Insert is the only write op (never UPDATE, never DELETE). Refunds and
 * adjustments are *new rows* with negative deltas, preserving the
 * audit trail.
 *
 * Idempotency for invoice credits relies on the partial unique index
 * `idx_ledger_invoice_credit_uniq` — a second attempt to credit the
 * same invoice raises SQLITE_CONSTRAINT and the caller (reconciler)
 * swallows it.
 */

export function getBalanceCents(userId: number): number {
  const row = db
    .prepare<[number], { balance: number | null }>(
      `SELECT COALESCE(SUM(delta_cents), 0) AS balance FROM credit_ledger WHERE user_id = ?`,
    )
    .get(userId);
  return row?.balance ?? 0;
}

export function listRecent(
  userId: number,
  limit = 25,
): CreditLedgerRow[] {
  return db
    .prepare<[number, number], CreditLedgerRow>(
      `SELECT * FROM credit_ledger
        WHERE user_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT ?`,
    )
    .all(userId, limit);
}

export type CreditArgs = {
  userId: number;
  delta_cents: number;
  reason: LedgerReason;
  ref_invoice_id?: string | null;
  ref_pod_uuid?: string | null;
  note?: string | null;
};

export function insertLedger(args: CreditArgs): CreditLedgerRow {
  if (!Number.isInteger(args.delta_cents) || args.delta_cents === 0) {
    throw new Error("delta_cents must be a non-zero integer");
  }
  const ts = Math.floor(Date.now() / 1000);
  const info = db
    .prepare(
      `INSERT INTO credit_ledger
         (user_id, delta_cents, reason, ref_invoice_id, ref_pod_uuid, note, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.userId,
      args.delta_cents,
      args.reason,
      args.ref_invoice_id ?? null,
      args.ref_pod_uuid ?? null,
      args.note ?? null,
      ts,
    );
  return db
    .prepare<[number], CreditLedgerRow>(
      `SELECT * FROM credit_ledger WHERE id = ?`,
    )
    .get(Number(info.lastInsertRowid))!;
}

/**
 * Convenience: credit an invoice. Wraps insertLedger with the right
 * reason + ref. Idempotent — second call raises SQLITE_CONSTRAINT on
 * the partial unique index.
 */
export function creditInvoice(args: {
  invoiceId: string;
  userId: number;
  usdAmountCents: number;
  note?: string;
}): CreditLedgerRow {
  return insertLedger({
    userId: args.userId,
    delta_cents: args.usdAmountCents,
    reason: "invoice_credit",
    ref_invoice_id: args.invoiceId,
    note: args.note ?? null,
  });
}

/** Issue a refund for an existing invoice credit. Negative delta with
 * the SAME ref_invoice_id but reason='refund' — the partial unique
 * index is scoped to 'invoice_credit' so a refund row doesn't conflict. */
export function refundInvoice(args: {
  invoiceId: string;
  userId: number;
  usdAmountCents: number;
  note?: string;
}): CreditLedgerRow {
  return insertLedger({
    userId: args.userId,
    delta_cents: -Math.abs(args.usdAmountCents),
    reason: "refund",
    ref_invoice_id: args.invoiceId,
    note: args.note ?? null,
  });
}

/** Pod-hour burn (negative delta) — used by future metering job. */
export function burnPodHour(args: {
  userId: number;
  podUuid: string;
  costCents: number;
  note?: string;
}): CreditLedgerRow {
  return insertLedger({
    userId: args.userId,
    delta_cents: -Math.abs(args.costCents),
    reason: "pod_hour",
    ref_pod_uuid: args.podUuid,
    note: args.note ?? null,
  });
}
