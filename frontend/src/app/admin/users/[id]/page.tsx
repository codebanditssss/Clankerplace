// /admin/users/[id] — user detail with action toolbar + sub-tabs
// (overview, pods, invoices, credit, identities, audit).
//
// The page is a server component; sub-tab views are simple in-page
// sections (no client-side tab state — selecting a tab is a query
// param so the URL is shareable).

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, Mail, Shield, Wallet } from "lucide-react";
import { getUserDetail } from "@/lib/admin-users";
import { listAuditLog } from "@/lib/admin";
import { Badge } from "@/components/ui/badge";
import { UserActions } from "@/components/admin/user-actions";
import { CopyId } from "@/components/admin/copy-id";
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
} from "@/components/admin/data-table";

export const dynamic = "force-dynamic";

const TABS = ["overview", "pods", "invoices", "credit", "legacy_credit", "identities", "audit"] as const;
type Tab = (typeof TABS)[number];

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const userId = parseInt(id, 10);
  if (!Number.isInteger(userId) || userId <= 0) notFound();

  const detail = getUserDetail(userId);
  if (!detail) notFound();
  const { user, oauthIdentities, walletIdentities, pods, invoices, creditTransactions, legacyLedger, balance_cents } =
    detail;

  const tab = (typeof sp.tab === "string" && TABS.includes(sp.tab as Tab)
    ? sp.tab
    : "overview") as Tab;

  const audit = listAuditLog({
    targetType: "user",
    targetId: String(userId),
    limit: 50,
  });

  return (
    <div className="space-y-6">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-[12px] tracking-tight text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
      >
        <ArrowLeft className="h-3 w-3" /> Back to users
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight">
              {user.email}
            </h1>
            {(user.role === "admin" || user.is_admin) && (
              <Badge tone="red">admin</Badge>
            )}
            {user.suspended_at && <Badge tone="red">suspended</Badge>}
            {!user.email_verified_at && (
              <Badge tone="amber">unverified</Badge>
            )}
            {oauthIdentities.length > 0 && (
              <Badge tone="blue">
                {oauthIdentities.map((o) => o.provider).join(" + ")}
              </Badge>
            )}
            {walletIdentities.length > 0 && <Badge tone="purple">wallet</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[12px] tracking-tight text-[color:var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3 w-3" /> user id <CopyId value={String(user.id)} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> pelican id <CopyId value={String(user.pelican_user_id)} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> joined{" "}
              <FormattedTs value={user.created_at} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> AI credits{" "}
              <span
                className={
                  balance_cents > 0
                    ? "text-[color:var(--acc-green)]"
                    : balance_cents < 0
                      ? "text-[color:var(--acc-red)]"
                      : "text-[color:var(--text-secondary)]"
                }
              >
                ${(balance_cents / 100).toFixed(2)}
              </span>
            </span>
          </div>
          {user.suspended_at && (
            <div className="text-[12px] tracking-tight text-[color:var(--acc-red)]">
              Suspended <FormattedTs value={user.suspended_at} />
              {user.suspended_reason ? ` — ${user.suspended_reason}` : ""}
            </div>
          )}
        </div>
        <UserActions
          userId={user.id}
          email={user.email}
          isSuspended={!!user.suspended_at}
          isAdmin={user.role === "admin" || user.is_admin === 1}
          isVerified={!!user.email_verified_at}
        />
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-[color:var(--border)]">
        {TABS.map((t) => {
          const active = t === tab;
          const count = countFor(t, { pods, invoices, creditTransactions, legacyLedger, oauthIdentities, walletIdentities, audit });
          return (
            <Link
              key={t}
              href={`/admin/users/${user.id}?tab=${t}`}
              className={`-mb-px border-b-2 px-4 py-2 text-[12px] tracking-tight transition-colors ${
                active
                  ? "border-[color:var(--text-primary)] text-[color:var(--text-primary)]"
                  : "border-transparent text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
              }`}
            >
              {t === "invoices"
                ? "legacy invoices"
                : t === "credit"
                  ? "AI credits"
                  : t === "legacy_credit"
                    ? "legacy ledger"
                    : t}
              {count != null && (
                <span className="ml-1.5 rounded border border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-1.5 py-0 text-[10px] text-[color:var(--text-tertiary)]">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {tab === "overview" && (
        <OverviewTab detail={detail} />
      )}
      {tab === "pods" && <PodsTab pods={pods} />}
      {tab === "invoices" && <InvoicesTab invoices={invoices} />}
      {tab === "credit" && <CreditTab transactions={creditTransactions} />}
      {tab === "legacy_credit" && <LegacyCreditTab ledger={legacyLedger} />}
      {tab === "identities" && (
        <IdentitiesTab
          oauth={oauthIdentities}
          wallets={walletIdentities}
        />
      )}
      {tab === "audit" && <AuditTab rows={audit} />}
    </div>
  );
}

function countFor(t: Tab, data: { pods: unknown[]; invoices: unknown[]; creditTransactions: unknown[]; legacyLedger: unknown[]; oauthIdentities: unknown[]; walletIdentities: unknown[]; audit: unknown[] }) {
  switch (t) {
    case "pods":
      return data.pods.length;
    case "invoices":
      return data.invoices.length;
    case "credit":
      return data.creditTransactions.length;
    case "legacy_credit":
      return data.legacyLedger.length;
    case "identities":
      return data.oauthIdentities.length + data.walletIdentities.length;
    case "audit":
      return data.audit.length;
    default:
      return null;
  }
}

function OverviewTab({
  detail,
}: {
  detail: ReturnType<typeof getUserDetail>;
}) {
  if (!detail) return null;
  const { user, balance_cents, pods, invoices } = detail;
  const confirmedInvoices = invoices.filter(
    (i) => i.status === "confirmed" || i.status === "swept",
  );
  const lifetimeCents = confirmedInvoices.reduce(
    (a, i) => a + i.usd_amount_cents,
    0,
  );
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Account">
        <KV label="ID" value={String(user.id)} mono />
        <KV label="Pelican ID" value={String(user.pelican_user_id)} mono />
        <KV label="Role" value={user.role || (user.is_admin ? "admin" : "user")} />
        <KV
          label="Email verified"
          value={
            user.email_verified_at ? (
              <FormattedTs value={user.email_verified_at} />
            ) : (
              <span className="text-[color:var(--acc-amber)]">no</span>
            )
          }
        />
        <KV
          label="Status"
          value={
            user.suspended_at ? (
              <span className="text-[color:var(--acc-red)]">suspended</span>
            ) : (
              <span className="text-[color:var(--acc-green)]">active</span>
            )
          }
        />
        <KV
          label="KYC"
          value={user.kyc_status ?? "—"}
        />
      </Card>
      <Card title="Billing">
        <KV
          label="AI Credits"
          value={
            <span
              className={
                balance_cents > 0
                  ? "text-[color:var(--acc-green)]"
                  : balance_cents < 0
                    ? "text-[color:var(--acc-red)]"
                    : ""
              }
            >
              ${(balance_cents / 100).toFixed(2)}
            </span>
          }
        />
        <KV
          label="Lifetime paid"
          value={`$${(lifetimeCents / 100).toFixed(2)}`}
        />
        <KV
          label="Promo credits received"
          value={`$${(user.promo_credits_received / 100).toFixed(2)}`}
        />
        <KV
          label="Cohort free pod"
          value={user.cohort_free_pod_uuid_short ?? "—"}
        />
      </Card>
      <Card title="Activity">
        <KV
          label="Pods"
          value={String(pods.length)}
        />
        <KV
          label="Invoices"
          value={String(invoices.length)}
        />
        <KV
          label="Joined"
          value={<FormattedTs value={user.created_at} />}
        />
        <KV
          label="Last login"
          value={
            user.last_login_at ? (
              <FormattedTs value={user.last_login_at} />
            ) : (
              "—"
            )
          }
        />
      </Card>
    </div>
  );
}

function PodsTab({ pods }: { pods: ReturnType<typeof getUserDetail> extends infer R ? R extends { pods: infer P } ? P : never : never }) {
  if (pods.length === 0) {
    return <EmptyState message="No pods deployed by this user." />;
  }
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
      <Table>
        <THead>
          <tr>
            <TH>Slug</TH>
            <TH>UUID</TH>
            <TH>Port</TH>
            <TH>Kind</TH>
            <TH>IP</TH>
            <TH>Created</TH>
          </tr>
        </THead>
        <TBody>
          {pods.map((p) => (
            <TR key={p.id} href={`/admin/pods/${p.pod_full_uuid}`}>
              <TD>
                <span className="text-[color:var(--text-primary)]">{p.slug}</span>
              </TD>
              <TD>
                <CopyId value={p.pod_full_uuid} display={p.pod_uuid_short} />
              </TD>
              <TD>{p.port}</TD>
              <TD>
                <Badge tone={p.kind === "auto" ? "blue" : "neutral"}>
                  {p.kind}
                </Badge>
              </TD>
              <TD>
                <span className="font-mono text-[11px] text-[color:var(--text-tertiary)]">
                  {p.container_ip ?? "—"}
                </span>
              </TD>
              <TD>
                <FormattedTs value={p.created_at} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function InvoicesTab({ invoices }: { invoices: ReturnType<typeof getUserDetail> extends infer R ? R extends { invoices: infer P } ? P : never : never }) {
  if (invoices.length === 0) {
    return <EmptyState message="No legacy invoices for this user." />;
  }
  return (
    <div className="space-y-3">
      <div className="border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[12px] leading-relaxed text-amber-100">
        Legacy Solana invoice records are read-only historical data. Active
        billing uses Dodo subscriptions and credit purchases.
      </div>
      <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
      <Table>
        <THead>
          <tr>
            <TH>ID</TH>
            <TH>Amount</TH>
            <TH>Currency</TH>
            <TH>Status</TH>
            <TH>Created</TH>
            <TH>Confirmed</TH>
          </tr>
        </THead>
        <TBody>
          {invoices.map((inv) => (
            <TR key={inv.id}>
              <TD>
                <CopyId value={inv.id} display={inv.id.slice(0, 8)} />
              </TD>
              <TD>${(inv.usd_amount_cents / 100).toFixed(2)}</TD>
              <TD>{inv.currency}</TD>
              <TD>
                <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
              </TD>
              <TD>
                <FormattedUnixTs value={inv.created_at} />
              </TD>
              <TD>
                {inv.confirmed_at ? (
                  <FormattedUnixTs value={inv.confirmed_at} />
                ) : (
                  "—"
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      </div>
    </div>
  );
}

function CreditTab({ transactions }: { transactions: ReturnType<typeof getUserDetail> extends infer R ? R extends { creditTransactions: infer L } ? L : never : never }) {
  if (transactions.length === 0) {
    return <EmptyState message="No AI credit wallet transactions yet." />;
  }
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
      <Table>
        <THead>
          <tr>
            <TH>When</TH>
            <TH>Type</TH>
            <TH align="right">Amount</TH>
            <TH align="right">Balance</TH>
            <TH>Description</TH>
          </tr>
        </THead>
        <TBody>
          {transactions.map((tx) => (
            <TR key={tx.id}>
              <TD>
                <FormattedTs value={tx.created_at} />
              </TD>
              <TD>
                <Badge tone="neutral">{tx.type}</Badge>
              </TD>
              <TD align="right">
                <span
                  className={
                    tx.amount_cents > 0
                      ? "text-[color:var(--acc-green)]"
                      : tx.amount_cents < 0
                        ? "text-[color:var(--acc-red)]"
                        : ""
                  }
                >
                  {tx.amount_cents > 0 ? "+" : ""}
                  ${(tx.amount_cents / 100).toFixed(2)}
                </span>
              </TD>
              <TD align="right">${(tx.balance_after_cents / 100).toFixed(2)}</TD>
              <TD>
                <span className="text-[color:var(--text-tertiary)]">{tx.description ?? ""}</span>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function LegacyCreditTab({ ledger }: { ledger: ReturnType<typeof getUserDetail> extends infer R ? R extends { legacyLedger: infer L } ? L : never : never }) {
  if (ledger.length === 0) {
    return <EmptyState message="No legacy infrastructure credit ledger entries." />;
  }
  return (
    <div className="space-y-3">
      <div className="border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[12px] leading-relaxed text-amber-100">
        Legacy infrastructure credit ledger entries are read-only historical
        data. Active AI credit balance uses Dodo credit transactions.
      </div>
      <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
        <Table>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Reason</TH>
              <TH align="right">Delta</TH>
              <TH>Ref</TH>
              <TH>Note</TH>
            </tr>
          </THead>
          <TBody>
            {ledger.map((l) => (
              <TR key={l.id}>
                <TD>
                  <FormattedUnixTs value={l.ts} />
                </TD>
                <TD>
                  <Badge tone="neutral">{l.reason}</Badge>
                </TD>
                <TD align="right">
                  <span
                    className={
                      l.delta_cents > 0
                        ? "text-[color:var(--acc-green)]"
                        : l.delta_cents < 0
                          ? "text-[color:var(--acc-red)]"
                          : ""
                    }
                  >
                    {l.delta_cents > 0 ? "+" : ""}
                    ${(l.delta_cents / 100).toFixed(2)}
                  </span>
                </TD>
                <TD>
                  {l.ref_invoice_id && (
                    <CopyId value={l.ref_invoice_id} display={l.ref_invoice_id.slice(0, 8)} />
                  )}
                  {l.ref_pod_uuid && !l.ref_invoice_id && (
                    <CopyId value={l.ref_pod_uuid} display={l.ref_pod_uuid.slice(0, 8)} />
                  )}
                </TD>
                <TD>
                  <span className="text-[color:var(--text-tertiary)]">{l.note ?? ""}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

function IdentitiesTab({
  oauth,
  wallets,
}: {
  oauth: ReturnType<typeof getUserDetail> extends infer R ? R extends { oauthIdentities: infer P } ? P : never : never;
  wallets: ReturnType<typeof getUserDetail> extends infer R ? R extends { walletIdentities: infer P } ? P : never : never;
}) {
  if (oauth.length === 0 && wallets.length === 0) {
    return <EmptyState message="Only email/password — no OAuth or wallet linked." />;
  }
  return (
    <div className="space-y-4">
      {oauth.length > 0 && (
        <Card title="OAuth identities">
          <ul className="space-y-2">
            {oauth.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between text-[12px] tracking-tight"
              >
                <span className="flex items-center gap-2">
                  <Badge tone="blue">{o.provider}</Badge>
                  <span className="text-[color:var(--text-secondary)]">
                    {o.email_at_link ?? "—"}
                  </span>
                </span>
                <span className="font-mono text-[11px] text-[color:var(--text-tertiary)]">
                  {o.provider_user_id.slice(0, 16)}…
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {wallets.length > 0 && (
        <Card title="Legacy wallets">
          <ul className="space-y-2">
            {wallets.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between text-[12px] tracking-tight"
              >
                <span className="flex items-center gap-2">
                  <Badge tone="purple">{w.is_primary ? "primary" : "linked"}</Badge>
                  <CopyId value={w.address} display={`${w.address.slice(0, 6)}…${w.address.slice(-4)}`} />
                </span>
                <FormattedTs value={w.created_at} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function AuditTab({ rows }: { rows: ReturnType<typeof listAuditLog> }) {
  if (rows.length === 0) {
    return <EmptyState message="No admin actions have been taken on this user yet." />;
  }
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
      <Table>
        <THead>
          <tr>
            <TH>When</TH>
            <TH>Action</TH>
            <TH>Actor</TH>
            <TH>IP</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((a) => (
            <TR key={a.id}>
              <TD>
                <FormattedUnixTs value={a.ts} />
              </TD>
              <TD>
                <Badge tone="neutral">{a.action}</Badge>
              </TD>
              <TD>
                <span className="font-mono text-[11px] text-[color:var(--text-tertiary)]">
                  uid {a.actor_user_id}
                </span>
              </TD>
              <TD>
                <span className="font-mono text-[11px] text-[color:var(--text-tertiary)]">
                  {a.ip ?? "—"}
                </span>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
      <div className="border-b border-[color:var(--border-subtle)] px-5 py-3 text-[11px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
        {title}
      </div>
      <div className="space-y-2 px-5 py-4">{children}</div>
    </div>
  );
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px] tracking-tight">
      <span className="text-[color:var(--text-tertiary)]">{label}</span>
      <span
        className={
          mono
            ? "font-mono text-[11px] text-[color:var(--text-primary)]"
            : "text-[color:var(--text-primary)]"
        }
      >
        {value}
      </span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)] py-12 text-center text-[13px] tracking-tight text-[color:var(--text-tertiary)]">
      {message}
    </div>
  );
}

function FormattedTs({ value }: { value: string }) {
  // SQLite ISO without TZ → assume UTC.
  const t = Date.parse(value.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return <span>{value}</span>;
  return <span>{new Date(t).toLocaleString()}</span>;
}

function FormattedUnixTs({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <span>—</span>;
  return <span>{new Date(value * 1000).toLocaleString()}</span>;
}

function statusTone(status: string): "neutral" | "blue" | "green" | "amber" | "red" {
  switch (status) {
    case "confirmed":
    case "swept":
      return "green";
    case "pending":
      return "amber";
    case "failed":
    case "expired":
    case "underpaid":
      return "red";
    default:
      return "neutral";
  }
}
