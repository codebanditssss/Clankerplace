// /admin — dashboard home. KPI strip, system health, alerts, and a
// recent-activity feed. All read-only — mutations live in /admin/users,
// /admin/pods, /admin/billing.

import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import {
  getDashboardKpis,
  getAlerts,
  getRecentAuditFeed,
  getRecentSignups,
} from "@/lib/admin-stats";
import { KpiCard } from "@/components/admin/kpi-card";
import { HealthStrip } from "@/components/admin/health-strip";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function timeAgo(unixOrIso: number | string): string {
  const t =
    typeof unixOrIso === "number"
      ? unixOrIso * 1000
      : Date.parse(unixOrIso.replace(" ", "T") + "Z");
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function AdminDashboard() {
  const kpis = getDashboardKpis();
  const alerts = getAlerts();
  const audit = getRecentAuditFeed(15);
  const signups = getRecentSignups(8);

  const alertItems: { label: string; count: number; href: string }[] = [];
  if (alerts.stuckSignups)
    alertItems.push({
      label: `${alerts.stuckSignups} signups stuck > 24h`,
      count: alerts.stuckSignups,
      href: "/admin/users?filter=pending",
    });
  if (alerts.failedWebhooks)
    alertItems.push({
      label: `${alerts.failedWebhooks} Dodo webhook failures need review`,
      count: alerts.failedWebhooks,
      href: "/admin/billing",
    });
  if (alerts.suspendedUsers)
    alertItems.push({
      label: `${alerts.suspendedUsers} suspended users`,
      count: alerts.suspendedUsers,
      href: "/admin/users?filter=suspended",
    });

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)]">
            Snapshot of the platform — refresh the page for the latest.
          </p>
        </div>
      </header>

      <HealthStrip />

      <section>
        <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
          Key metrics
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>
      </section>

      {alertItems.length > 0 && (
        <section className="border border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)]/40 px-5 py-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-[color:var(--acc-amber)]">
            <AlertTriangle className="h-3.5 w-3.5" /> Alerts
          </div>
          <ul className="space-y-1.5">
            {alertItems.map((a) => (
              <li key={a.label}>
                <Link
                  href={a.href}
                  className="group flex items-center gap-2 text-[13px] tracking-tight text-[color:var(--text-primary)] hover:text-[color:var(--acc-amber)]"
                >
                  <span>{a.label}</span>
                  <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
          <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-5 py-3">
            <h2 className="text-[13px] font-semibold tracking-tight">
              Recent signups
            </h2>
            <Link
              href="/admin/users"
              className="text-[11px] tracking-tight text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
            >
              all users →
            </Link>
          </div>
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {signups.length === 0 && (
              <li className="px-5 py-6 text-center text-[12px] text-[color:var(--text-tertiary)]">
                No users yet.
              </li>
            )}
            {signups.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/admin/users/${u.id}`}
                  className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-[color:var(--bg-3)]"
                >
                  <span className="flex items-center gap-2 text-[13px] tracking-tight text-[color:var(--text-primary)]">
                    {u.email}
                    {u.role === "admin" && <Badge tone="purple">admin</Badge>}
                    {u.suspended_at && (
                      <Badge tone="red">suspended</Badge>
                    )}
                  </span>
                  <span className="text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
                    {timeAgo(u.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
          <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-5 py-3">
            <h2 className="text-[13px] font-semibold tracking-tight">
              Recent admin activity
            </h2>
            <Link
              href="/admin/audit"
              className="text-[11px] tracking-tight text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
            >
              full log →
            </Link>
          </div>
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {audit.length === 0 && (
              <li className="px-5 py-6 text-center text-[12px] text-[color:var(--text-tertiary)]">
                No admin actions yet.
              </li>
            )}
            {audit.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between px-5 py-3 text-[13px] tracking-tight"
              >
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{a.action}</Badge>
                  <span className="text-[color:var(--text-secondary)]">
                    {a.target_type}
                    {a.target_id && (
                      <span className="text-[color:var(--text-tertiary)]">
                        :{a.target_id}
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
                    by {a.actor_email}
                  </span>
                  <span className="text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
                    {timeAgo(a.ts)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
