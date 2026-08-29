"use client";

// Client island for the /domains page — the table needs onClick handlers
// for copy + delete + the optimistic remove after a successful DELETE.
import { useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, Trash2, Check, Globe } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";

type Row = {
  id: number;
  slug: string;
  pod_uuid_short: string;
  pod_name: string;
  port: number;
  container_ip: string | null;
  kind: "auto" | "manual";
  created_at: string;
  url: string;
};

export default function DomainsList({ rows: initialRows }: { rows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy — selection blocked by browser");
    }
  }

  async function remove(slug: string) {
    if (!confirm(`Remove ${slug}? It'll stop serving immediately.`)) return;
    setBusySlug(slug);
    try {
      const r = await fetch(`/api/domains/${slug}`, { method: "DELETE" });
      const d = (await r.json()) as { ok?: true; error?: string };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setRows((p) => p.filter((x) => x.slug !== slug));
      toast.success("Domain removed");
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[1fr_140px_120px_80px_140px] gap-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-2)]/60 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
        <div>Domain</div>
        <div>Pod</div>
        <div>Port</div>
        <div>Kind</div>
        <div className="text-right">Actions</div>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-[1fr_140px_120px_80px_140px] items-center gap-3 border-b border-[color:var(--border-subtle)] px-5 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 flex-none text-[color:var(--acc-blue)]" />
                <Link
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-[13px] text-[color:var(--text-primary)] hover:text-[color:var(--acc-blue)] hover:underline"
                >
                  {r.slug}
                </Link>
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--text-quaternary)]">
                {r.url}
              </div>
            </div>
            <Link
              href={`/pods/${r.pod_uuid_short}`}
              className="truncate text-[12px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:underline"
            >
              {r.pod_name}
            </Link>
            <div className="flex items-center gap-1.5 font-mono text-[12px] text-[color:var(--text-secondary)]">
              <StatusDot tone="green" />
              :{r.port}
            </div>
            <div>
              {r.kind === "auto" ? (
                <Badge tone="blue">auto</Badge>
              ) : (
                <Badge tone="neutral">manual</Badge>
              )}
            </div>
            <div className="flex items-center justify-end gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => copyUrl(r.url)}
                title="Copy URL"
              >
                {copied === r.url ? (
                  <Check className="h-3.5 w-3.5 text-[color:var(--acc-green)]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => window.open(r.url, "_blank")}
                title="Open"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => remove(r.slug)}
                disabled={busySlug === r.slug}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5 text-[color:var(--acc-red)]" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
