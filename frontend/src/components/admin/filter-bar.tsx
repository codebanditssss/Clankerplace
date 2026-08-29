"use client";

// URL-stateful filter bar. Each control mirrors a query string param so
// the page is deep-linkable / shareable in Slack.

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

export type FilterDef = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

export function FilterBar({
  searchPlaceholder = "Search…",
  filters = [],
}: {
  searchPlaceholder?: string;
  filters?: FilterDef[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const [q, setQ] = React.useState(initialQ);

  // Sync local input with URL when params change externally.
  React.useEffect(() => {
    setQ(params.get("q") ?? "");
  }, [params]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    next.delete("page"); // reset page on filter change
    router.push(`${pathname}?${next.toString()}`);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParam("q", q.trim() || null);
  };

  const clearAll = () => {
    setQ("");
    router.push(pathname);
  };

  const anyActive =
    q.trim().length > 0 ||
    filters.some((f) => params.get(f.key) && params.get(f.key) !== "all");

  return (
    <div className="flex flex-wrap items-center gap-2 border border-[color:var(--border)] bg-[color:var(--bg-2)] px-3 py-2">
      <form onSubmit={submitSearch} className="flex flex-1 items-center gap-2 min-w-[14rem]">
        <Search className="h-3.5 w-3.5 text-[color:var(--text-tertiary)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 bg-transparent text-[13px] tracking-tight text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-tertiary)]"
        />
      </form>
      {filters.map((f) => {
        const current = params.get(f.key) ?? f.options[0].value;
        return (
          <select
            key={f.key}
            value={current}
            onChange={(e) =>
              setParam(f.key, e.target.value === f.options[0].value ? null : e.target.value)
            }
            className="h-7 rounded-sm border border-[color:var(--border-subtle)] bg-[color:var(--bg-3)] px-2 text-[12px] tracking-tight text-[color:var(--text-secondary)] outline-none focus:border-[color:var(--border-strong)]"
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {f.label}: {o.label}
              </option>
            ))}
          </select>
        );
      })}
      {anyActive && (
        <button
          onClick={clearAll}
          className="inline-flex items-center gap-1 rounded-sm border border-[color:var(--border-subtle)] bg-[color:var(--bg-3)] px-2 py-1 text-[11px] tracking-tight text-[color:var(--text-tertiary)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-secondary)]"
        >
          <X className="h-3 w-3" /> Clear
        </button>
      )}
    </div>
  );
}

export function Pagination({
  total,
  page,
  pageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const go = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    router.push(`${pathname}?${next.toString()}`);
  };
  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-between border border-t-0 border-[color:var(--border)] bg-[color:var(--bg-2)] px-3 py-2 text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
        <span>{total} total</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between border border-t-0 border-[color:var(--border)] bg-[color:var(--bg-2)] px-3 py-2 text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
      <span>
        {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          className="rounded-sm border border-[color:var(--border-subtle)] bg-[color:var(--bg-3)] px-2 py-0.5 disabled:opacity-40"
        >
          ←
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => go(page + 1)}
          className="rounded-sm border border-[color:var(--border-subtle)] bg-[color:var(--bg-3)] px-2 py-0.5 disabled:opacity-40"
        >
          →
        </button>
      </div>
    </div>
  );
}
