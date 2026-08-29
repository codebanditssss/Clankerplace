// Stats aggregations for the admin dashboard. Cheap SQLite queries — no
// caching layer needed at our scale (<100 users, <50 pods). Each helper
// returns a plain object the dashboard page can spread into a KPI card.

import "server-only";
import db from "@/lib/db";

export type Kpi = {
  label: string;
  value: number | string;
  delta?: { value: number; label: string };
  trend?: number[]; // sparkline values
  href?: string;
};

function num(sql: string, params: unknown[] = []): number {
  const row = db
    .prepare<unknown[], { c: number }>(sql)
    .get(...params);
  return row?.c ?? 0;
}

/** All KPIs the dashboard top row renders. Computed in a single trip. */
export function getDashboardKpis(): Kpi[] {
  const totalUsers = num("SELECT COUNT(*) c FROM users");
  const usersLast24h = num(
    "SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now','-1 day')",
  );
  const usersPrev24h = num(
    "SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now','-2 days') AND created_at < datetime('now','-1 day')",
  );
  const activePods = num("SELECT COUNT(*) c FROM pod_domains");
  const activeSubscriptions = num(
    "SELECT COUNT(*) c FROM subscriptions WHERE status IN ('active','trialing')",
  );
  const creditPurchaseCents = num(
    "SELECT COALESCE(SUM(amount_cents),0) c FROM credit_transactions WHERE type = 'purchase'",
  );
  const oauthUsers = num(
    "SELECT COUNT(DISTINCT user_id) c FROM oauth_identities",
  );
  const walletUsers = num(
    "SELECT COUNT(DISTINCT user_id) c FROM wallet_identities",
  );

  // 7-day spark for signups (one bucket per day).
  const signupSpark = db
    .prepare<unknown[], { c: number }>(
      `WITH days(d) AS (
         SELECT date('now','-6 days')
         UNION ALL SELECT date('now','-5 days')
         UNION ALL SELECT date('now','-4 days')
         UNION ALL SELECT date('now','-3 days')
         UNION ALL SELECT date('now','-2 days')
         UNION ALL SELECT date('now','-1 day')
         UNION ALL SELECT date('now')
       )
       SELECT (SELECT COUNT(*) FROM users WHERE date(created_at) = d) c
       FROM days`,
    )
    .all()
    .map((r) => r.c);

  // 7-day spark for active pods (snapshot — we approximate with creation cumulative).
  const podsSpark = db
    .prepare<unknown[], { c: number }>(
      `WITH days(d) AS (
         SELECT date('now','-6 days')
         UNION ALL SELECT date('now','-5 days')
         UNION ALL SELECT date('now','-4 days')
         UNION ALL SELECT date('now','-3 days')
         UNION ALL SELECT date('now','-2 days')
         UNION ALL SELECT date('now','-1 day')
         UNION ALL SELECT date('now')
       )
       SELECT (SELECT COUNT(*) FROM pod_domains WHERE date(created_at) <= d) c
       FROM days`,
    )
    .all()
    .map((r) => r.c);

  return [
    {
      label: "Total users",
      value: totalUsers,
      delta: {
        value: usersLast24h - usersPrev24h,
        label: "vs prev 24h",
      },
      trend: signupSpark,
      href: "/admin/users",
    },
    {
      label: "Signups (24h)",
      value: usersLast24h,
      delta: {
        value: usersLast24h - usersPrev24h,
        label: "vs prev 24h",
      },
      trend: signupSpark,
      href: "/admin/users",
    },
    {
      label: "Active pods",
      value: activePods,
      trend: podsSpark,
      href: "/admin/pods",
    },
    {
      label: "Credit purchases",
      value: `$${(creditPurchaseCents / 100).toFixed(2)}`,
      href: "/admin/billing",
    },
    {
      label: "Active subscriptions",
      value: activeSubscriptions,
      href: "/admin/billing",
    },
    {
      label: "OAuth / wallet users",
      value: `${oauthUsers} / ${walletUsers}`,
      href: "/admin/users",
    },
  ];
}

/** Alerts surface anomalies — counted on every page render. */
export function getAlerts() {
  return {
    stuckSignups: num(
      `SELECT COUNT(*) c FROM pending_signups
        WHERE last_sent_at < datetime('now','-1 day')`,
    ),
    failedWebhooks: num(
      "SELECT COUNT(*) c FROM dodo_webhook_events WHERE processing_status = 'failed'",
    ),
    suspendedUsers: num(
      "SELECT COUNT(*) c FROM users WHERE suspended_at IS NOT NULL",
    ),
  };
}

/** Recent activity = last N audit-log entries joined with actor email. */
export function getRecentAuditFeed(limit = 20) {
  return db
    .prepare<[number], {
      id: number;
      ts: number;
      action: string;
      target_type: string;
      target_id: string | null;
      actor_email: string;
    }>(
      `SELECT a.id, a.ts, a.action, a.target_type, a.target_id, u.email AS actor_email
         FROM admin_audit_log a
         JOIN users u ON u.id = a.actor_user_id
         ORDER BY a.ts DESC, a.id DESC
         LIMIT ?`,
    )
    .all(limit);
}

/** Recent user signups for the dashboard feed. */
export function getRecentSignups(limit = 10) {
  return db
    .prepare<[number], {
      id: number;
      email: string;
      created_at: string;
      role: string;
      suspended_at: string | null;
    }>(
      `SELECT id, email, created_at, role, suspended_at
         FROM users
         ORDER BY created_at DESC
         LIMIT ?`,
    )
    .all(limit);
}
