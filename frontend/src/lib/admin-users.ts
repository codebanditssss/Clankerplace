// Server-only readers for admin user pages. Build the queries here so
// the page components stay declarative, and so /api/admin endpoints
// (CSV export, search) can share them.

import "server-only";
import db, {
  type CreditLedgerRow,
  type CreditTransactionRow,
  type InvoiceRow,
  type OauthIdentityRow,
  type PodDomainRow,
  type UserRow,
  type WalletIdentityRow,
} from "@/lib/db";

export type UsersFilter = {
  q?: string;
  status?: "all" | "active" | "suspended" | "pending" | "admin";
  authMethod?: "all" | "email" | "google" | "github" | "wallet";
  page?: number;
  pageSize?: number;
  sort?: "newest" | "oldest" | "most_pods" | "balance";
};

export type UsersListItem = {
  id: number;
  email: string;
  role: string;
  is_admin: number;
  email_verified_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  created_at: string;
  last_login_at: string | null;
  pod_count: number;
  balance_cents: number;
  oauth_providers: string;
  has_wallet: number;
};

export function listUsers(filter: UsersFilter): {
  rows: UsersListItem[];
  total: number;
} {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.q) {
    where.push("LOWER(u.email) LIKE LOWER(?)");
    params.push(`%${filter.q}%`);
  }
  switch (filter.status) {
    case "suspended":
      where.push("u.suspended_at IS NOT NULL");
      break;
    case "active":
      where.push("u.suspended_at IS NULL");
      break;
    case "pending":
      where.push("u.email_verified_at IS NULL");
      break;
    case "admin":
      where.push("(u.role = 'admin' OR u.is_admin = 1)");
      break;
  }
  switch (filter.authMethod) {
    case "google":
      where.push(
        "u.id IN (SELECT user_id FROM oauth_identities WHERE provider = 'google')",
      );
      break;
    case "github":
      where.push(
        "u.id IN (SELECT user_id FROM oauth_identities WHERE provider = 'github')",
      );
      break;
    case "wallet":
      where.push("u.id IN (SELECT user_id FROM wallet_identities)");
      break;
    case "email":
      // Email-only: not in oauth, not in wallet, no wallet sentinel.
      where.push(
        `u.id NOT IN (SELECT user_id FROM oauth_identities)
          AND u.id NOT IN (SELECT user_id FROM wallet_identities)`,
      );
      break;
  }

  const order =
    filter.sort === "oldest"
      ? "u.created_at ASC"
      : filter.sort === "most_pods"
        ? "pod_count DESC, u.id DESC"
        : filter.sort === "balance"
          ? "balance_cents DESC, u.id DESC"
          : "u.id DESC"; // newest

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db
    .prepare<unknown[], UsersListItem>(
      `SELECT u.id,
              u.email,
              u.role,
              u.is_admin,
              u.email_verified_at,
              u.suspended_at,
              u.suspended_reason,
              u.created_at,
              u.last_login_at,
              (SELECT COUNT(*) FROM pod_domains WHERE user_id = u.id) AS pod_count,
              (SELECT COALESCE(balance_cents,0) FROM credit_balances WHERE user_id = u.id) AS balance_cents,
              (SELECT GROUP_CONCAT(provider) FROM oauth_identities WHERE user_id = u.id) AS oauth_providers,
              (SELECT COUNT(*) FROM wallet_identities WHERE user_id = u.id) > 0 AS has_wallet
         FROM users u
         ${whereSql}
         ORDER BY ${order}
         LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset);

  const totalRow = db
    .prepare<unknown[], { c: number }>(
      `SELECT COUNT(*) c FROM users u ${whereSql}`,
    )
    .get(...params);

  return { rows, total: totalRow?.c ?? 0 };
}

export type UserDetail = {
  user: UserRow;
  oauthIdentities: OauthIdentityRow[];
  walletIdentities: WalletIdentityRow[];
  pods: PodDomainRow[];
  invoices: InvoiceRow[];
  creditTransactions: CreditTransactionRow[];
  legacyLedger: CreditLedgerRow[];
  balance_cents: number;
};

export function getUserDetail(userId: number): UserDetail | null {
  const user = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!user) return null;
  const oauthIdentities = db
    .prepare<[number], OauthIdentityRow>(
      "SELECT * FROM oauth_identities WHERE user_id = ? ORDER BY id DESC",
    )
    .all(userId);
  const walletIdentities = db
    .prepare<[number], WalletIdentityRow>(
      "SELECT * FROM wallet_identities WHERE user_id = ? ORDER BY id DESC",
    )
    .all(userId);
  const pods = db
    .prepare<[number], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE user_id = ? ORDER BY id DESC",
    )
    .all(userId);
  const invoices = db
    .prepare<[number], InvoiceRow>(
      "SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    )
    .all(userId);
  const creditTransactions = db
    .prepare<[number], CreditTransactionRow>(
      "SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100",
    )
    .all(userId);
  const legacyLedger = db
    .prepare<[number], CreditLedgerRow>(
      "SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT 100",
    )
    .all(userId);
  const balance = db
    .prepare<[number], { c: number }>(
      "SELECT COALESCE(balance_cents,0) c FROM credit_balances WHERE user_id = ?",
    )
    .get(userId);
  return {
    user,
    oauthIdentities,
    walletIdentities,
    pods,
    invoices,
    creditTransactions,
    legacyLedger,
    balance_cents: balance?.c ?? 0,
  };
}
