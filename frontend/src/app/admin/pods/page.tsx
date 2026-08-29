// /admin/pods — paginated list across ALL pods (not user-scoped).

import { listAdminPods } from "@/lib/admin-pods";
import { FilterBar, Pagination } from "@/components/admin/filter-bar";
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
} from "@/components/admin/data-table";
import { Badge, StatusDot } from "@/components/ui/badge";
import { CopyId } from "@/components/admin/copy-id";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PodsListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const node = typeof sp.node === "string" ? parseInt(sp.node, 10) : undefined;
  const kind = (typeof sp.kind === "string" ? sp.kind : "all") as
    | "all"
    | "auto"
    | "manual";
  const page =
    typeof sp.page === "string" ? Math.max(1, parseInt(sp.page, 10)) : 1;

  const { rows, total } = await listAdminPods({
    q,
    node: Number.isFinite(node) ? node : undefined,
    kind,
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight">Pods</h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)]">
          {total} {total === 1 ? "pod" : "pods"} across all users
        </p>
      </header>

      <FilterBar
        searchPlaceholder="Search by slug, uuid, or owner email…"
        filters={[
          {
            key: "node",
            label: "Node",
            options: [
              { value: "all", label: "all" },
              { value: "1", label: "1" },
              { value: "2", label: "2" },
            ],
          },
          {
            key: "kind",
            label: "Kind",
            options: [
              { value: "all", label: "all" },
              { value: "auto", label: "auto" },
              { value: "manual", label: "manual" },
            ],
          },
        ]}
      />

      <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
        <Table>
          <THead>
            <tr>
              <TH>Slug</TH>
              <TH>Owner</TH>
              <TH>UUID</TH>
              <TH>Node</TH>
              <TH>Egg</TH>
              <TH>Status</TH>
              <TH>Kind</TH>
              <TH>Container IP</TH>
              <TH>Created</TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && (
              <tr>
                <TD>
                  <div className="px-3 py-12 text-center text-[13px] text-[color:var(--text-tertiary)]">
                    No pods match these filters.
                  </div>
                </TD>
              </tr>
            )}
            {rows.map((p) => (
              <TR key={p.id} href={`/admin/pods/${p.pod_full_uuid}`}>
                <TD>
                  <span className="flex items-center gap-2">
                    <StatusDot
                      tone={
                        p.pelican_suspended
                          ? "red"
                          : p.pelican_installed
                            ? "green"
                            : "amber"
                      }
                    />
                    <span className="text-[color:var(--text-primary)]">
                      {p.slug}
                    </span>
                  </span>
                </TD>
                <TD>
                  <span className="text-[color:var(--text-secondary)]">
                    {p.user_email ?? `uid ${p.user_id}`}
                  </span>
                </TD>
                <TD>
                  <CopyId
                    value={p.pod_full_uuid}
                    display={p.pod_uuid_short}
                  />
                </TD>
                <TD>
                  {p.pelican_node != null ? (
                    <Badge tone={p.pelican_node === 1 ? "neutral" : "blue"}>
                      node {p.pelican_node}
                    </Badge>
                  ) : (
                    <span className="text-[color:var(--text-tertiary)]">—</span>
                  )}
                </TD>
                <TD>
                  {p.pelican_egg != null ? (
                    <span className="text-[color:var(--text-tertiary)]">
                      {p.pelican_egg}
                    </span>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD>
                  {p.pelican_suspended ? (
                    <Badge tone="red">suspended</Badge>
                  ) : p.pelican_installed ? (
                    <Badge tone="green">installed</Badge>
                  ) : (
                    <Badge tone="amber">installing</Badge>
                  )}
                </TD>
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
                  <DateCell value={p.created_at} />
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

function DateCell({ value }: { value: string }) {
  const t = Date.parse(value.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return <span>{value}</span>;
  return (
    <span className="text-[color:var(--text-tertiary)]">
      {new Date(t).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}
    </span>
  );
}
