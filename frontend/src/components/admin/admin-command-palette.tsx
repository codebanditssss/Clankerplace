"use client";

// Cmd+K palette for the admin console.
//
// Three modes of result, in order:
//   1. Page jumps (Dashboard, Users, Pods, Billing, Audit, System)
//   2. Live search results - users by email, pods by uuid - debounced
//      fetch to /api/admin/search?q=...
//   3. Quick actions — only rendered if no query (so the palette feels
//      like a launcher first, search second)

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  Boxes,
  Receipt,
  Activity,
  Shield,
  Server,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/cn";

type SearchHit =
  | { kind: "user"; id: number; email: string; suspended_at: string | null }
  | { kind: "pod"; uuid: string; slug: string | null; owner_email: string | null };

type Section = {
  label: string;
  items: {
    key: string;
    label: React.ReactNode;
    sublabel?: React.ReactNode;
    icon: React.ReactNode;
    onSelect: () => void;
  }[];
};

const PAGE_JUMPS: { label: string; href: string; icon: React.ReactNode }[] = [
  { label: "Dashboard", href: "/admin", icon: <Activity className="h-3.5 w-3.5" /> },
  { label: "Users", href: "/admin/users", icon: <Users className="h-3.5 w-3.5" /> },
  { label: "Pods", href: "/admin/pods", icon: <Boxes className="h-3.5 w-3.5" /> },
  { label: "Billing", href: "/admin/billing", icon: <Receipt className="h-3.5 w-3.5" /> },
  { label: "Audit log", href: "/admin/audit", icon: <Shield className="h-3.5 w-3.5" /> },
  { label: "System", href: "/admin/system", icon: <Server className="h-3.5 w-3.5" /> },
];

export function AdminCommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced search
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`);
        if (r.ok) {
          const d = (await r.json()) as { hits: SearchHit[] };
          setHits(d.hits ?? []);
          setActiveIdx(0);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query, open]);

  const sections = React.useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase();
    const result: Section[] = [];

    const pageJumps = PAGE_JUMPS.filter(
      (p) => !q || p.label.toLowerCase().includes(q),
    ).map((p) => ({
      key: `page:${p.href}`,
      label: p.label,
      icon: p.icon,
      onSelect: () => {
        onOpenChange(false);
        router.push(p.href);
      },
    }));
    if (pageJumps.length) {
      result.push({ label: "Pages", items: pageJumps });
    }

    if (hits.length) {
      result.push({
        label: "Results",
        items: hits.map((hit) => {
          if (hit.kind === "user") {
            return {
              key: `user:${hit.id}`,
              label: (
                <span className="flex items-center gap-2">
                  {hit.email}
                  {hit.suspended_at ? (
                    <span className="rounded-full border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-1.5 text-[10px] text-[color:var(--acc-red)]">
                      suspended
                    </span>
                  ) : null}
                </span>
              ),
              sublabel: `user id ${hit.id}`,
              icon: <Mail className="h-3.5 w-3.5" />,
              onSelect: () => {
                onOpenChange(false);
                router.push(`/admin/users/${hit.id}`);
              },
            };
          }
          return {
            key: `pod:${hit.uuid}`,
            label: hit.slug ?? hit.uuid.slice(0, 8),
            sublabel: hit.owner_email ?? hit.uuid,
            icon: <Boxes className="h-3.5 w-3.5" />,
            onSelect: () => {
              onOpenChange(false);
              router.push(`/admin/pods/${hit.uuid}`);
            },
          };
        }),
      });
    }

    return result;
  }, [hits, query, onOpenChange, router]);

  // Flatten to a single index list for keyboard navigation.
  const flat = sections.flatMap((s) => s.items);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        flat[activeIdx]?.onSelect();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flat, activeIdx, onOpenChange]);

  if (!open) return null;

  let idx = -1;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[14vh]"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="mx-4 w-full max-w-[44rem] overflow-hidden rounded-md border border-[color:var(--border-strong)] bg-[color:var(--bg-1)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-3">
          <Search className="h-4 w-4 text-[color:var(--text-tertiary)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users by email, pods by uuid, invoices by id…"
            className="flex-1 bg-transparent text-sm tracking-tight text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-tertiary)]"
          />
          {loading && (
            <span className="text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
              searching…
            </span>
          )}
          <span className="rounded border border-[color:var(--border-subtle)] px-1.5 text-[10px] text-[color:var(--text-tertiary)]">
            esc
          </span>
        </div>
        <div className="max-h-[55vh] overflow-y-auto py-2">
          {sections.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-[color:var(--text-tertiary)]">
              {query.trim().length >= 2
                ? "No matches."
                : "Type at least 2 characters to search."}
            </div>
          )}
          {sections.map((s) => (
            <div key={s.label}>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
                {s.label}
              </div>
              {s.items.map((item) => {
                idx++;
                const active = idx === activeIdx;
                return (
                  <button
                    key={item.key}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={item.onSelect}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] tracking-tight",
                      active
                        ? "bg-[color:var(--bg-3)] text-[color:var(--text-primary)]"
                        : "text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-2)]",
                    )}
                  >
                    <span className="text-[color:var(--text-tertiary)]">
                      {item.icon}
                    </span>
                    <span className="flex flex-1 items-center gap-2">
                      {item.label}
                    </span>
                    {item.sublabel && (
                      <span className="text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
                        {item.sublabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
