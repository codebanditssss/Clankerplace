// /admin/audit — append-only log of every admin action.

import db from "@/lib/db";
import { listAuditLog, countAuditLog } from "@/lib/admin";
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
import { CopyId } from "@/components/admin/copy-id";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const action = typeof sp.action === "string" && sp.action !== "all" ? sp.action : undefined;
  const targetType =
    typeof sp.target === "string" && sp.target !== "all" ? sp.target : undefined;
  const page = typeof sp.page === "string" ? Math.max(1, parseInt(sp.page, 10)) : 1;

  // q is interpreted as target_id contains.
  const opts = {
    action,
    targetType,
    targetId: q,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const rows = listAuditLog(opts);
  const total = countAuditLog({
    action,
    targetType,
    targetId: q,
  });

  // Resolve actor emails in one trip.
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_user_id)));
  const actors = actorIds.length
    ? db
        .prepare<unknown[], { id: number; email: string }>(
          `SELECT id, email FROM users WHERE id IN (${actorIds.map(() => "?").join(",")})`,
        )
        .all(...actorIds)
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a.email]));

  // Distinct values for the filter dropdowns.
  const actionOptions = db
    .prepare<unknown[], { v: string }>(
      "SELECT DISTINCT action AS v FROM admin_audit_log ORDER BY action",
    )
    .all()
    .map((r) => r.v);
  const targetOptions = db
    .prepare<unknown[], { v: string }>(
      "SELECT DISTINCT target_type AS v FROM admin_audit_log ORDER BY target_type",
    )
    .all()
    .map((r) => r.v);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)]">
          {total} {total === 1 ? "entry" : "entries"} — append-only, never edited or deleted.
        </p>
      </header>

      <FilterBar
        searchPlaceholder="Filter by target ID (user id, pod uuid, invoice id)…"
        filters={[
          {
            key: "action",
            label: "Action",
            options: [
              { value: "all", label: "all" },
              ...actionOptions.map((a) => ({ value: a, label: a })),
            ],
          },
          {
            key: "target",
            label: "Target",
            options: [
              { value: "all", label: "all" },
              ...targetOptions.map((t) => ({ value: t, label: t })),
            ],
          },
        ]}
      />

      <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
        <Table>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Target</TH>
              <TH>IP</TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && (
              <tr>
                <TD>
                  <div className="px-3 py-12 text-center text-[13px] text-[color:var(--text-tertiary)]">
                    No log entries match these filters.
                  </div>
                </TD>
              </tr>
            )}
            {rows.map((a) => (
              <TR key={a.id}>
                <TD>
                  <span className="text-[color:var(--text-tertiary)]">
                    {new Date(a.ts * 1000).toLocaleString()}
                  </span>
                </TD>
                <TD>
                  {actorMap.get(a.actor_user_id) ?? `uid ${a.actor_user_id}`}
                </TD>
                <TD>
                  <Badge tone="neutral">{a.action}</Badge>
                </TD>
                <TD>
                  <span className="font-mono text-[11px] text-[color:var(--text-tertiary)]">
                    {a.target_type}
                  </span>
                  {a.target_id && (
                    <>
                      {": "}
                      {targetLink(a.target_type, a.target_id)}
                    </>
                  )}
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
        <Pagination total={total} page={page} pageSize={PAGE_SIZE} />
      </div>
    </div>
  );
}

function targetLink(type: string, id: string) {
  if (type === "user") {
    return (
      <a
        href={`/admin/users/${id}`}
        className="text-[color:var(--text-secondary)] hover:underline"
      >
        {id}
      </a>
    );
  }
  if (type === "pod") {
    return (
      <a
        href={`/admin/pods/${id}`}
        className="text-[color:var(--text-secondary)] hover:underline"
      >
        <CopyId value={id} display={id.slice(0, 8)} />
      </a>
    );
  }
  if (type === "invoice") {
    return <CopyId value={id} display={id.slice(0, 8)} />;
  }
  return <span className="text-[color:var(--text-secondary)]">{id}</span>;
}
