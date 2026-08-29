import "server-only";
import db, { type CreditBalanceRow, type CreditTransactionRow } from "@/lib/db";

export type CreditBalanceSnapshot = {
  balance_cents: number;
  balance_usd: string;
  currency: string;
  transactions: CreditTransactionRow[];
};

export function getCreditBalance(userId: number): CreditBalanceRow {
  const existing = db
    .prepare<[number], CreditBalanceRow>(
      `SELECT * FROM credit_balances WHERE user_id = ?`,
    )
    .get(userId);
  if (existing) return existing;

  db.prepare(
    `INSERT OR IGNORE INTO credit_balances (user_id, balance_cents, currency)
     VALUES (?, 0, 'usd')`,
  ).run(userId);

  return db
    .prepare<[number], CreditBalanceRow>(
      `SELECT * FROM credit_balances WHERE user_id = ?`,
    )
    .get(userId)!;
}

export function listCreditTransactions(
  userId: number,
  limit = 25,
): CreditTransactionRow[] {
  return db
    .prepare<[number, number], CreditTransactionRow>(
      `SELECT *
         FROM credit_transactions
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .all(userId, limit);
}

export function getCreditSnapshot(userId: number): CreditBalanceSnapshot {
  const balance = getCreditBalance(userId);
  return {
    balance_cents: balance.balance_cents,
    balance_usd: (balance.balance_cents / 100).toFixed(2),
    currency: balance.currency,
    transactions: listCreditTransactions(userId),
  };
}

export const recordCreditPurchase = db.transaction(
  (input: {
    userId: number;
    amountCents: number;
    dodoPaymentId?: string | null;
    dodoCheckoutSessionId?: string | null;
    billingEventId?: number | null;
    description?: string | null;
    metadata?: unknown;
  }): { inserted: boolean; balance_cents: number } => {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error("credit purchase amount must be a positive integer number of cents");
    }

    const current = getCreditBalance(input.userId);
    const nextBalance = current.balance_cents + input.amountCents;
    const metadataJson =
      input.metadata === undefined ? null : JSON.stringify(input.metadata);

    const result = db
      .prepare(
        `INSERT OR IGNORE INTO credit_transactions (
           user_id,
           type,
           amount_cents,
           balance_after_cents,
           currency,
           dodo_payment_id,
           dodo_checkout_session_id,
           billing_event_id,
           description,
           metadata_json
         )
         VALUES (?, 'purchase', ?, ?, 'usd', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.userId,
        input.amountCents,
        nextBalance,
        input.dodoPaymentId ?? null,
        input.dodoCheckoutSessionId ?? null,
        input.billingEventId ?? null,
        input.description ?? "Credit purchase",
        metadataJson,
      );

    if (result.changes === 0) {
      return {
        inserted: false,
        balance_cents: current.balance_cents,
      };
    }

    db.prepare(
      `UPDATE credit_balances
          SET balance_cents = ?,
              updated_at = datetime('now')
        WHERE user_id = ?`,
    ).run(nextBalance, input.userId);

    return {
      inserted: true,
      balance_cents: nextBalance,
    };
  },
);

export const recordCreditAdjustment = db.transaction(
  (input: {
    userId: number;
    amountCents: number;
    adminUserId: number;
    reason: string;
  }): { balance_cents: number; transaction_id: number } => {
    if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
      throw new Error("credit adjustment amount must be a non-zero integer number of cents");
    }
    const reason = input.reason.trim();
    if (!reason) throw new Error("credit adjustment reason is required");

    const current = getCreditBalance(input.userId);
    const nextBalance = current.balance_cents + input.amountCents;
    if (nextBalance < 0) {
      throw new Error("credit adjustment cannot make the wallet balance negative");
    }

    const result = db
      .prepare(
        `INSERT INTO credit_transactions (
           user_id,
           type,
           amount_cents,
           balance_after_cents,
           currency,
           description,
           metadata_json
         )
         VALUES (?, 'admin_adjustment', ?, ?, 'usd', ?, ?)`,
      )
      .run(
        input.userId,
        input.amountCents,
        nextBalance,
        reason,
        JSON.stringify({ admin_user_id: input.adminUserId, reason }),
      );

    db.prepare(
      `UPDATE credit_balances
          SET balance_cents = ?,
              updated_at = datetime('now')
        WHERE user_id = ?`,
    ).run(nextBalance, input.userId);

    return {
      balance_cents: nextBalance,
      transaction_id: Number(result.lastInsertRowid),
    };
  },
);

/**
 * Debit the credit wallet for metered Pods Managed AI usage.
 *
 * Called from /api/internal/managed/usage when the gateway reports a
 * completed inference. The cost arrives in MICRO-UNITS (1 USD = 1,000,000
 * micro-units, so 1 cent = 10,000 micro-units) because per-request upstream
 * costs are fractions of a cent. We accumulate the sub-cent remainder in
 * managed_usage_accrual.carry_micro_units and only move whole cents off the
 * wallet once the carry crosses a cent — so nothing is lost to rounding.
 *
 * Idempotent on `requestId` (the gateway's per-request id) via the unique
 * idx_credit_transactions_managed_request index: a retried callback is a
 * no-op. Both the carry update and the wallet debit happen atomically inside
 * this transaction, so a duplicate can never double-count the carry either.
 *
 * The wallet IS allowed to go negative: the gateway hard-blocks NEW requests
 * at the floor, but an in-flight request that completes after the balance
 * crosses zero must still be recorded truthfully.
 */
const MICRO_UNITS_PER_CENT = 10_000;

export const recordManagedUsage = db.transaction(
  (input: {
    userId: number;
    costMicroUnits: number;
    requestId: string;
    description?: string | null;
    metadata?: unknown;
  }): {
    inserted: boolean;
    balance_cents: number;
    charged_cents: number;
  } => {
    if (
      !Number.isInteger(input.costMicroUnits) ||
      input.costMicroUnits < 0
    ) {
      throw new Error("managed usage cost must be a non-negative integer number of micro-units");
    }
    const requestId = input.requestId.trim();
    if (!requestId) throw new Error("managed usage requestId is required");

    // Idempotency: bail if we've already recorded this gateway request.
    const dup = db
      .prepare<[string], { id: number }>(
        `SELECT id FROM credit_transactions WHERE managed_request_id = ?`,
      )
      .get(requestId);
    if (dup) {
      const current = getCreditBalance(input.userId);
      return { inserted: false, balance_cents: current.balance_cents, charged_cents: 0 };
    }

    const current = getCreditBalance(input.userId);

    // Load (or seed) the per-user sub-cent carry.
    db.prepare(
      `INSERT OR IGNORE INTO managed_usage_accrual (user_id, carry_micro_units, total_micro_units)
       VALUES (?, 0, 0)`,
    ).run(input.userId);
    const accrual = db
      .prepare<[number], { carry_micro_units: number; total_micro_units: number }>(
        `SELECT carry_micro_units, total_micro_units FROM managed_usage_accrual WHERE user_id = ?`,
      )
      .get(input.userId)!;

    const totalCarry = accrual.carry_micro_units + input.costMicroUnits;
    const chargedCents = Math.floor(totalCarry / MICRO_UNITS_PER_CENT);
    const newCarry = totalCarry - chargedCents * MICRO_UNITS_PER_CENT;
    const nextBalance = current.balance_cents - chargedCents;
    const metadataJson =
      input.metadata === undefined ? null : JSON.stringify(input.metadata);

    db.prepare(
      `INSERT INTO credit_transactions (
         user_id,
         type,
         amount_cents,
         balance_after_cents,
         currency,
         description,
         metadata_json,
         managed_request_id
       )
       VALUES (?, 'managed_ai_usage', ?, ?, 'usd', ?, ?, ?)`,
    ).run(
      input.userId,
      -chargedCents,
      nextBalance,
      input.description ?? "Pods Managed AI usage",
      metadataJson,
      requestId,
    );

    db.prepare(
      `UPDATE managed_usage_accrual
          SET carry_micro_units = ?,
              total_micro_units = total_micro_units + ?,
              updated_at = datetime('now')
        WHERE user_id = ?`,
    ).run(newCarry, input.costMicroUnits, input.userId);

    if (chargedCents !== 0) {
      db.prepare(
        `UPDATE credit_balances
            SET balance_cents = ?,
                updated_at = datetime('now')
          WHERE user_id = ?`,
      ).run(nextBalance, input.userId);
    }

    return { inserted: true, balance_cents: nextBalance, charged_cents: chargedCents };
  },
);
