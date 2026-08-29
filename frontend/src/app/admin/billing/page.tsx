// /admin/billing - Dodo subscriptions, credit purchases, and provider events.

import Link from "next/link";
import db from "@/lib/db";
import { FilterBar, Pagination } from "@/components/admin/filter-bar";
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
} from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/admin/kpi-card";
import { CopyId } from "@/components/admin/copy-id";
import { isActiveSubscriptionStatus } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type SubscriptionAdminRow = {
  id: number;
  user_id: number;
  user_email: string | null;
  dodo_customer_id: string | null;
  dodo_subscription_id: string | null;
  plan: string;
  status: string;
  renewal_date: string | null;
  updated_at: string;
};

type CreditAdminRow = {
  id: number;
  user_id: number;
  user_email: string | null;
  amount_cents: number;
  balance_after_cents: number;
  dodo_payment_id: string | null;
  description: string | null;
  created_at: string;
};

type BillingEventAdminRow = {
  id: number;
  user_id: number | null;
  user_email: string | null;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  processed_at: string;
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const status = typeof sp.status === "string" ? sp.status : "all";
  const page =
    typeof sp.page === "string" ? Math.max(1, parseInt(sp.page, 10)) : 1;

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q) {
    where.push(
      `(LOWER(u.email) LIKE LOWER(?)
        OR s.dodo_customer_id LIKE ?
        OR s.dodo_subscription_id LIKE ?)`,
    );
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status !== "all") {
    where.push("s.status = ?");
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const subscriptions = db
    .prepare<unknown[], SubscriptionAdminRow>(
      `SELECT s.id,
              s.user_id,
              u.email AS user_email,
              s.dodo_customer_id,
              s.dodo_subscription_id,
              s.plan,
              s.status,
              s.renewal_date,
              s.updated_at
         FROM subscriptions s
         LEFT JOIN users u ON u.id = s.user_id
         ${whereSql}
         ORDER BY
           CASE WHEN s.status IN ('active','trialing') THEN 0 ELSE 1 END,
           s.updated_at DESC,
           s.id DESC
         LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const total =
    db
      .prepare<unknown[], { c: number }>(
        `SELECT COUNT(*) c
           FROM subscriptions s
           LEFT JOIN users u ON u.id = s.user_id
           ${whereSql}`,
      )
      .get(...params)?.c ?? 0;

  const activeSubscriptions =
    db
      .prepare<unknown[], { c: number }>(
        "SELECT COUNT(*) c FROM subscriptions WHERE status IN ('active','trialing')",
      )
      .get()?.c ?? 0;
  const creditPurchases =
    db
      .prepare<unknown[], { c: number }>(
        "SELECT COALESCE(SUM(amount_cents),0) c FROM credit_transactions WHERE type = 'purchase'",
      )
      .get()?.c ?? 0;
  const totalCreditBalance =
    db
      .prepare<unknown[], { c: number }>(
        "SELECT COALESCE(SUM(balance_cents),0) c FROM credit_balances",
      )
      .get()?.c ?? 0;
  const failedWebhooks =
    db
      .prepare<unknown[], { c: number }>(
        "SELECT COUNT(*) c FROM dodo_webhook_events WHERE processing_status = 'failed'",
      )
      .get()?.c ?? 0;

  const recentCredits = db
    .prepare<[number], CreditAdminRow>(
      `SELECT c.id,
              c.user_id,
              u.email AS user_email,
              c.amount_cents,
              c.balance_after_cents,
              c.dodo_payment_id,
              c.description,
              c.created_at
         FROM credit_transactions c
         LEFT JOIN users u ON u.id = c.user_id
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ?`,
    )
    .all(20);

  const recentEvents = db
    .prepare<[number], BillingEventAdminRow>(
      `SELECT e.id,
              e.user_id,
              u.email AS user_email,
              e.event_type,
              e.resource_type,
              e.resource_id,
              e.processed_at
         FROM billing_events e
         LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.processed_at DESC, e.id DESC
         LIMIT ?`,
    )
    .all(20);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)]">
          Dodo subscriptions, credit wallet purchases, and webhook activity.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Active subscriptions" value={activeSubscriptions} />
        <KpiCard
          label="Credit purchases"
          value={`$${(creditPurchases / 100).toFixed(2)}`}
        />
        <KpiCard
          label="Credit balances"
          value={`$${(totalCreditBalance / 100).toFixed(2)}`}
        />
        <KpiCard label="Failed webhooks" value={failedWebhooks} />
      </div>

      <FilterBar
        searchPlaceholder="Search by user email or Dodo id..."
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "all", label: "all" },
              { value: "active", label: "active" },
              { value: "trialing", label: "trialing" },
              { value: "cancelled", label: "cancelled" },
              { value: "expired", label: "expired" },
              { value: "unpaid", label: "unpaid" },
              { value: "past_due", label: "past_due" },
              { value: "suspended", label: "suspended" },
            ],
          },
        ]}
      />

      <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
        <Table>
          <THead>
            <tr>
              <TH>User</TH>
              <TH>Plan</TH>
              <TH>Status</TH>
              <TH>Subscription</TH>
              <TH>Customer</TH>
              <TH>Renewal</TH>
              <TH>Updated</TH>
            </tr>
          </THead>
          <TBody>
            {subscriptions.length === 0 && (
              <tr>
                <TD>
                  <div className="px-3 py-12 text-center text-[13px] text-[color:var(--text-tertiary)]">
                    No subscriptions match these filters.
                  </div>
                </TD>
              </tr>
            )}
            {subscriptions.map((sub) => (
              <TR key={sub.id} href={`/admin/users/${sub.user_id}`}>
                <TD>{sub.user_email ?? `uid ${sub.user_id}`}</TD>
                <TD className="capitalize">{sub.plan}</TD>
                <TD>
                  <Badge
                    tone={isActiveSubscriptionStatus(sub.status) ? "green" : "red"}
                  >
                    {sub.status}
                  </Badge>
                </TD>
                <TD>
                  {sub.dodo_subscription_id ? (
                    <CopyId
                      value={sub.dodo_subscription_id}
                      display={shortId(sub.dodo_subscription_id)}
                    />
                  ) : (
                    "-"
                  )}
                </TD>
                <TD>
                  {sub.dodo_customer_id ? (
                    <CopyId
                      value={sub.dodo_customer_id}
                      display={shortId(sub.dodo_customer_id)}
                    />
                  ) : (
                    "-"
                  )}
                </TD>
                <TD>{formatDate(sub.renewal_date)}</TD>
                <TD>{formatDate(sub.updated_at)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination total={total} page={page} pageSize={PAGE_SIZE} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-tight">
              Recent credit purchases
            </h2>
            <Link
              href="/admin/billing/ledger"
              className="text-[11px] tracking-tight text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
            >
              legacy ledger
            </Link>
          </div>
          <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
            <Table>
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>User</TH>
                  <TH>Payment</TH>
                  <TH align="right">Amount</TH>
                  <TH align="right">Balance</TH>
                </tr>
              </THead>
              <TBody>
                {recentCredits.length === 0 && (
                  <tr>
                    <TD>
                      <div className="px-3 py-8 text-center text-[12px] text-[color:var(--text-tertiary)]">
                        No credit purchases yet.
                      </div>
                    </TD>
                  </tr>
                )}
                {recentCredits.map((credit) => (
                  <TR key={credit.id} href={`/admin/users/${credit.user_id}`}>
                    <TD>{formatDate(credit.created_at)}</TD>
                    <TD>{credit.user_email ?? `uid ${credit.user_id}`}</TD>
                    <TD>
                      {credit.dodo_payment_id ? (
                        <CopyId
                          value={credit.dodo_payment_id}
                          display={shortId(credit.dodo_payment_id)}
                        />
                      ) : (
                        credit.description ?? "purchase"
                      )}
                    </TD>
                    <TD align="right">
                      ${(credit.amount_cents / 100).toFixed(2)}
                    </TD>
                    <TD align="right">
                      ${(credit.balance_after_cents / 100).toFixed(2)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[13px] font-semibold tracking-tight">
            Recent billing events
          </h2>
          <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
            <Table>
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>Event</TH>
                  <TH>User</TH>
                  <TH>Resource</TH>
                </tr>
              </THead>
              <TBody>
                {recentEvents.length === 0 && (
                  <tr>
                    <TD>
                      <div className="px-3 py-8 text-center text-[12px] text-[color:var(--text-tertiary)]">
                        No billing events yet.
                      </div>
                    </TD>
                  </tr>
                )}
                {recentEvents.map((event) => (
                  <TR key={event.id}>
                    <TD>{formatDate(event.processed_at)}</TD>
                    <TD>
                      <Badge tone="neutral">{event.event_type}</Badge>
                    </TD>
                    <TD>
                      {event.user_id ? (
                        <Link
                          href={`/admin/users/${event.user_id}`}
                          className="hover:text-[color:var(--text-secondary)]"
                        >
                          {event.user_email ?? `uid ${event.user_id}`}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </TD>
                    <TD>
                      {event.resource_id ? (
                        <CopyId
                          value={event.resource_id}
                          display={`${event.resource_type ?? "resource"}:${shortId(event.resource_id)}`}
                        />
                      ) : (
                        event.resource_type ?? "-"
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}
