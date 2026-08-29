// /admin/users — paginated user list with filter bar.
//
// Filters & sort are URL-state so the page is deep-linkable. Each row
// links to /admin/users/[id].

import { listUsers, type UsersFilter } from "@/lib/admin-users";
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

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PAGE_SIZE = 50;

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const filter: UsersFilter = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    status: (typeof sp.status === "string"
      ? sp.status
      : "all") as UsersFilter["status"],
    authMethod: (typeof sp.auth === "string"
      ? sp.auth
      : "all") as UsersFilter["authMethod"],
    sort: (typeof sp.sort === "string"
      ? sp.sort
      : "newest") as UsersFilter["sort"],
    page: typeof sp.page === "string" ? Math.max(1, parseInt(sp.page, 10)) : 1,
    pageSize: PAGE_SIZE,
  };
  const { rows, total } = listUsers(filter);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)]">
            {total} {total === 1 ? "user" : "users"}
          </p>
        </div>
      </header>

      <FilterBar
        searchPlaceholder="Search by email…"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "all", label: "all" },
              { value: "active", label: "active" },
              { value: "suspended", label: "suspended" },
              { value: "pending", label: "unverified" },
              { value: "admin", label: "admins" },
            ],
          },
          {
            key: "auth",
            label: "Auth",
            options: [
              { value: "all", label: "all" },
              { value: "email", label: "email only" },
              { value: "google", label: "google" },
              { value: "github", label: "github" },
              { value: "wallet", label: "wallet" },
            ],
          },
          {
            key: "sort",
            label: "Sort",
            options: [
              { value: "newest", label: "newest" },
              { value: "oldest", label: "oldest" },
              { value: "most_pods", label: "most pods" },
              { value: "balance", label: "AI credits" },
            ],
          },
        ]}
      />

      <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
        <Table>
          <THead>
            <tr>
              <TH>Email</TH>
              <TH>Auth</TH>
              <TH>Role</TH>
              <TH align="right">Pods</TH>
              <TH align="right">AI Credits</TH>
              <TH>Signed up</TH>
              <TH>Last login</TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && (
              <tr>
                <TD>
                  <div className="px-3 py-12 text-center text-[13px] text-[color:var(--text-tertiary)]">
                    No users match these filters.
                  </div>
                </TD>
              </tr>
            )}
            {rows.map((u) => (
              <TR key={u.id} href={`/admin/users/${u.id}`}>
                <TD>
                  <span className="flex items-center gap-2">
                    <StatusDot
                      tone={
                        u.suspended_at
                          ? "red"
                          : u.email_verified_at
                            ? "green"
                            : "amber"
                      }
                    />
                    <span className="text-[color:var(--text-primary)]">
                      {u.email}
                    </span>
                  </span>
                </TD>
                <TD>
                  <span className="flex items-center gap-1.5">
                    {u.oauth_providers?.includes("google") && (
                      <Badge tone="blue">google</Badge>
                    )}
                    {u.oauth_providers?.includes("github") && (
                      <Badge tone="neutral">github</Badge>
                    )}
                    {u.has_wallet ? <Badge tone="purple">wallet</Badge> : null}
                    {!u.oauth_providers && !u.has_wallet && (
                      <Badge tone="neutral">email</Badge>
                    )}
                  </span>
                </TD>
                <TD>
                  {u.role === "admin" || u.is_admin ? (
                    <Badge tone="red">admin</Badge>
                  ) : (
                    <span className="text-[color:var(--text-tertiary)]">
                      user
                    </span>
                  )}
                </TD>
                <TD align="right">{u.pod_count}</TD>
                <TD align="right">
                  <span
                    className={
                      u.balance_cents > 0
                        ? "text-[color:var(--acc-green)]"
                        : u.balance_cents < 0
                          ? "text-[color:var(--acc-red)]"
                          : "text-[color:var(--text-tertiary)]"
                    }
                  >
                    ${(u.balance_cents / 100).toFixed(2)}
                  </span>
                </TD>
                <TD>
                  <DateCell value={u.created_at} />
                </TD>
                <TD>
                  {u.last_login_at ? (
                    <DateCell value={u.last_login_at} />
                  ) : (
                    <span className="text-[color:var(--text-tertiary)]">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination
          total={total}
          page={filter.page ?? 1}
          pageSize={PAGE_SIZE}
        />
      </div>
    </div>
  );
}
function DateCell({ value }: { value: string }) {
  // SQLite returns "YYYY-MM-DD HH:MM:SS" UTC. Render local date for the
  // admin who's reading this.
  const t = Date.parse(value.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return <span>{value}</span>;
  const d = new Date(t);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return (
    <span className="text-[color:var(--text-tertiary)]">
      {isToday
        ? d.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })
        : d.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
          })}
    </span>
  );
}
