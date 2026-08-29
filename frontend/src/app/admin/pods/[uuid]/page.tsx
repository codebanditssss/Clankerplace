// /admin/pods/[uuid] — pod detail page.
//
// Header carries status pill, owner link, copyable uuid. Tabs cover:
//   Overview     — config + env + limits
//   Domains      — pod_domains rows (auto + manual)
//   Emails       — pod_emails (in/out)
//   Audit        — admin actions touching this pod

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Boxes,
  ExternalLink,
  Globe,
  Hash,
  Mail,
} from "lucide-react";
import db, { type PodEmailRow } from "@/lib/db";
import { getAdminPodDetail } from "@/lib/admin-pods";
import { listAuditLog } from "@/lib/admin";
import { Badge, StatusDot } from "@/components/ui/badge";
import { PodActions } from "@/components/admin/pod-actions";
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

const TABS = ["overview", "domains", "emails", "audit"] as const;
type Tab = (typeof TABS)[number];

type Params = Promise<{ uuid: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PodDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { uuid } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]+$/i.test(uuid)) notFound();
  const detail = await getAdminPodDetail(uuid);
  if (!detail) notFound();
  const { domain, pelican } = detail;
  const slug = domain?.slug ?? pelican?.identifier ?? uuid.slice(0, 8);

  const tab = (typeof sp.tab === "string" && TABS.includes(sp.tab as Tab)
    ? sp.tab
    : "overview") as Tab;

  // Domain siblings (every pod_domains row for this pod, including manual ones)
  const domains = db
    .prepare<[string], typeof domain extends infer D ? D extends infer X ? X : never : never>(
      `SELECT * FROM pod_domains WHERE pod_full_uuid = ? ORDER BY id DESC`,
    )
    .all(uuid);

  const emails = db
    .prepare<[string], PodEmailRow>(
      `SELECT * FROM pod_emails WHERE pod_uuid_short = ? ORDER BY id DESC LIMIT 100`,
    )
    .all(uuid.slice(0, 8));

  const audit = listAuditLog({
    targetType: "pod",
    targetId: uuid,
    limit: 50,
  });

  return (
    <div className="space-y-6">
      <Link
        href="/admin/pods"
        className="inline-flex items-center gap-1.5 text-[12px] tracking-tight text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
      >
        <ArrowLeft className="h-3 w-3" /> Back to pods
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Boxes className="h-5 w-5 text-[color:var(--text-secondary)]" />
            <h1 className="text-[22px] font-semibold tracking-tight">{slug}</h1>
            {pelican && (
              <>
                {pelican.suspended ? (
                  <Badge tone="red">suspended</Badge>
                ) : pelican.container.installed === 1 ? (
                  <Badge tone="green">
                    <StatusDot tone="green" /> installed
                  </Badge>
                ) : (
                  <Badge tone="amber">installing</Badge>
                )}
              </>
            )}
            {pelican?.node != null && (
              <Badge tone={pelican.node === 1 ? "neutral" : "blue"}>
                node {pelican.node}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[12px] tracking-tight text-[color:var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <Hash className="h-3 w-3" /> <CopyId value={uuid} display={uuid.slice(0, 8)} />
            </span>
            {domain?.user_email && (
              <Link
                href={`/admin/users/${domain.user_id}`}
                className="inline-flex items-center gap-1.5 hover:text-[color:var(--text-secondary)]"
              >
                <Mail className="h-3 w-3" /> {domain.user_email}
              </Link>
            )}
            {domain && (
              <a
                href={`https://${domain.slug}.bigcat.pw`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-[color:var(--text-secondary)]"
              >
                <Globe className="h-3 w-3" />
                {domain.slug}.bigcat.pw
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {pelican && (
              <a
                href={`${process.env.PELICAN_URL ?? "https://pods-ml-prototype.eastus.cloudapp.azure.com"}/admin/servers/view/${pelican.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-[color:var(--text-secondary)]"
              >
                Open in Pelican <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        <PodActions
          uuid={uuid}
          slug={slug}
          installed={pelican?.container.installed === 1}
          suspended={!!pelican?.suspended}
        />
      </header>

      <nav className="flex border-b border-[color:var(--border)]">
        {TABS.map((t) => {
          const active = t === tab;
          return (
            <Link
              key={t}
              href={`/admin/pods/${uuid}?tab=${t}`}
              className={`-mb-px border-b-2 px-4 py-2 text-[12px] tracking-tight transition-colors ${
                active
                  ? "border-[color:var(--text-primary)] text-[color:var(--text-primary)]"
                  : "border-transparent text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
              }`}
            >
              {t}
            </Link>
          );
        })}
      </nav>

      {tab === "overview" && (
        <OverviewTab pelican={pelican} domain={domain} />
      )}
      {tab === "domains" && <DomainsTab domains={domains as unknown as (NonNullable<typeof domain>)[]} />}
      {tab === "emails" && <EmailsTab emails={emails} />}
      {tab === "audit" && <AuditTab rows={audit} />}
    </div>
  );
}

function OverviewTab({
  pelican,
  domain,
}: {
  pelican: NonNullable<Awaited<ReturnType<typeof getAdminPodDetail>>>["pelican"];
  domain: NonNullable<Awaited<ReturnType<typeof getAdminPodDetail>>>["domain"];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Pelican">
        {pelican ? (
          <>
            <KV label="ID" value={String(pelican.id)} />
            <KV label="Name" value={pelican.name} />
            <KV label="Node" value={String(pelican.node)} />
            <KV label="Egg" value={String(pelican.egg)} />
            <KV label="Image" value={pelican.container.image} mono />
            <KV
              label="Installed"
              value={pelican.container.installed === 1 ? "yes" : "no"}
            />
            <KV
              label="Suspended"
              value={pelican.suspended ? "yes" : "no"}
            />
          </>
        ) : (
          <span className="text-[12px] tracking-tight text-[color:var(--text-tertiary)]">
            (Pelican unreachable or pod has been removed there.)
          </span>
        )}
      </Card>
      <Card title="Limits">
        {pelican ? (
          <>
            <KV label="Memory" value={`${pelican.limits.memory} MB`} />
            <KV label="Disk" value={`${pelican.limits.disk} MB`} />
            <KV label="CPU" value={`${pelican.limits.cpu}%`} />
            <KV
              label="DB allowed"
              value={String(pelican.feature_limits.databases)}
            />
            <KV
              label="Backups"
              value={String(pelican.feature_limits.backups)}
            />
          </>
        ) : (
          <span className="text-[12px] tracking-tight text-[color:var(--text-tertiary)]">—</span>
        )}
      </Card>
      <Card title="Domain">
        {domain ? (
          <>
            <KV label="Slug" value={domain.slug} />
            <KV label="Kind" value={domain.kind} />
            <KV label="Port" value={String(domain.port)} />
            <KV
              label="Container IP"
              value={domain.container_ip ?? "—"}
              mono
            />
            <KV label="Created" value={domain.created_at} />
          </>
        ) : (
          <span className="text-[12px] tracking-tight text-[color:var(--text-tertiary)]">
            No domain registered.
          </span>
        )}
      </Card>
      {pelican && (
        <div className="lg:col-span-3">
          <Card title="Environment">
            <pre className="overflow-x-auto rounded-sm bg-[color:var(--bg-3)] p-3 font-mono text-[11px] tracking-tight text-[color:var(--text-secondary)]">
              {Object.entries(pelican.container.environment)
                .map(([k, v]) => {
                  const isSecret = /KEY|TOKEN|SECRET|PASSWORD/i.test(k);
                  return `${k}=${isSecret ? "••••••••" : v}`;
                })
                .join("\n")}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
}

function DomainsTab({
  domains,
}: {
  domains: NonNullable<Awaited<ReturnType<typeof getAdminPodDetail>>>["domain"][];
}) {
  if (domains.length === 0) {
    return <EmptyState message="No domains registered for this pod." />;
  }
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
      <Table>
        <THead>
          <tr>
            <TH>Slug</TH>
            <TH>Kind</TH>
            <TH>Port</TH>
            <TH>Container IP</TH>
            <TH>Created</TH>
            <TH></TH>
          </tr>
        </THead>
        <TBody>
          {domains.filter((d) => d != null).map((d) => (
            <TR key={d!.id}>
              <TD>
                <a
                  href={`https://${d!.slug}.bigcat.pw`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[color:var(--text-primary)] hover:underline"
                >
                  {d!.slug}.bigcat.pw
                </a>
              </TD>
              <TD>
                <Badge tone={d!.kind === "auto" ? "blue" : "neutral"}>
                  {d!.kind}
                </Badge>
              </TD>
              <TD>{d!.port}</TD>
              <TD>
                <span className="font-mono text-[11px] text-[color:var(--text-tertiary)]">
                  {d!.container_ip ?? "—"}
                </span>
              </TD>
              <TD>{d!.created_at}</TD>
              <TD>
                <a
                  href={`https://${d!.slug}.bigcat.pw`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function EmailsTab({ emails }: { emails: PodEmailRow[] }) {
  if (emails.length === 0) {
    return <EmptyState message="No emails sent or received by this pod." />;
  }
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
      <Table>
        <THead>
          <tr>
            <TH>When</TH>
            <TH>Dir</TH>
            <TH>From</TH>
            <TH>To</TH>
            <TH>Subject</TH>
          </tr>
        </THead>
        <TBody>
          {emails.map((e) => (
            <TR key={e.id}>
              <TD>
                <span className="text-[color:var(--text-tertiary)]">
                  {e.received_at ?? e.sent_at ?? e.created_at}
                </span>
              </TD>
              <TD>
                <Badge tone={e.direction === "in" ? "blue" : "neutral"}>
                  {e.direction}
                </Badge>
              </TD>
              <TD>
                <span className="text-[color:var(--text-secondary)]">{e.from_addr}</span>
              </TD>
              <TD>
                <span className="text-[color:var(--text-secondary)]">{e.to_addr}</span>
              </TD>
              <TD>
                <span className="text-[color:var(--text-primary)]">
                  {e.subject || <em>(no subject)</em>}
                </span>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function AuditTab({ rows }: { rows: ReturnType<typeof listAuditLog> }) {
  if (rows.length === 0) {
    return <EmptyState message="No admin actions have touched this pod." />;
  }
  return (
    <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
      <Table>
        <THead>
          <tr>
            <TH>When</TH>
            <TH>Action</TH>
            <TH>Actor UID</TH>
            <TH>IP</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((a) => (
            <TR key={a.id}>
              <TD>{new Date(a.ts * 1000).toLocaleString()}</TD>
              <TD>
                <Badge tone="neutral">{a.action}</Badge>
              </TD>
              <TD>{a.actor_user_id}</TD>
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
