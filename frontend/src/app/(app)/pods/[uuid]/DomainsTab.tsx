"use client";

// Per-pod Domains tab. Lists this pod's domains and lets the user add
// more with a port picker (default 8080). Re-fetches every 6 s so a
// newly-created auto-domain shows up after a redeploy.
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PodsLoader } from "@/components/ui/pods-loader";
import { Field, Input, Hint } from "@/components/ui/input";

type DomainRow = {
  id: number;
  slug: string;
  pod_uuid_short: string;
  port: number;
  container_ip: string | null;
  kind: "auto" | "manual";
  created_at: string;
  url: string;
};

export default function DomainsTab({
  identifier,
  installed,
}: {
  identifier: string;
  installed: boolean;
}) {
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [domainRoot, setDomainRoot] = useState("bigcat.pw");
  const [loaded, setLoaded] = useState(false);
  const [draftPort, setDraftPort] = useState("8080");
  const [draftSlug, setDraftSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/pods/${identifier}/domains`, {
        cache: "no-store",
      });
      const d = (await r.json()) as {
        domain_root?: string;
        domains?: DomainRow[];
      };
      if (d.domain_root) setDomainRoot(d.domain_root);
      setDomains(d.domains ?? []);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [identifier]);

  useEffect(() => {
    if (!installed) return;
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [installed, refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const port = parseInt(draftPort.trim(), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error("Port must be 1-65535");
      return;
    }
    setBusy(true);
    try {
      const body: { port: number; slug?: string } = { port };
      if (draftSlug.trim()) body.slug = draftSlug.trim().toLowerCase();
      const r = await fetch(`/api/pods/${identifier}/domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `HTTP ${r.status}`);
        return;
      }
      toast.success(`Domain live: ${d.url}`);
      setDraftSlug("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug: string) {
    if (!confirm(`Remove ${slug}? It'll stop serving immediately.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/domains/${slug}`, { method: "DELETE" });
      const d = (await r.json()) as { ok?: true; error?: string };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `HTTP ${r.status}`);
        return;
      }
      toast.success("Domain removed");
      setDomains((p) => p.filter((x) => x.slug !== slug));
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Clipboard write blocked");
    }
  }

  if (!installed) {
    return (
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        Domains unlock once the pod finishes installing.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {busy && (
        <div className="border border-[color:var(--border)] bg-[color:var(--bg-1)] px-4 py-5">
          <PodsLoader
            size="sm"
            label="Updating domain mapping..."
            className="mx-auto"
          />
        </div>
      )}
      <div className="border border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] p-3 text-[12px] text-[color:var(--text-secondary)]">
        Public subdomains under{" "}
        <code className="bg-[color:var(--bg-3)] px-1 py-0.5 font-mono text-[11px]">
          *.{domainRoot}
        </code>{" "}
        — wildcard TLS, isolated origin per slug, no host-port binding. The
        container target is the docker bridge IP, so internal-only ports
        (e.g. <code className="font-mono text-[11px]">8080</code>) become
        publicly reachable without exposing them on the host.
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight">
              Active mappings
            </h3>
            <p className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">
              {loaded ? `${domains.length} live` : "loading…"}
            </p>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {domains.length === 0 ? (
            <div className="px-5 py-6 text-center text-[12px] text-[color:var(--text-tertiary)]">
              No domains yet. Add one below.
            </div>
          ) : (
            <ul>
              {domains.map((d) => (
                <li
                  key={d.id}
                  className="grid grid-cols-[1fr_120px_80px_120px] items-center gap-3 border-b border-[color:var(--border-subtle)] px-5 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 flex-none text-[color:var(--acc-blue)]" />
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-mono text-[13px] text-[color:var(--text-primary)] hover:text-[color:var(--acc-blue)] hover:underline"
                      >
                        {d.slug}.{domainRoot}
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-[12px] text-[color:var(--text-secondary)]">
                    <StatusDot tone="green" />:{d.port}
                  </div>
                  <div>
                    {d.kind === "auto" ? (
                      <Badge tone="blue">auto</Badge>
                    ) : (
                      <Badge tone="neutral">manual</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => copyUrl(d.url)}
                      title="Copy URL"
                    >
                      {copied === d.url ? (
                        <Check className="h-3.5 w-3.5 text-[color:var(--acc-green)]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => window.open(d.url, "_blank")}
                      title="Open"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => remove(d.slug)}
                      disabled={busy}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[color:var(--acc-red)]" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card className="p-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
          Add a domain
        </h3>
        <form onSubmit={add} className="mt-3 grid gap-3 md:grid-cols-2">
          <Field
            label="Port (inside the container)"
            hint="Where your app listens — 8080, 3000, 5000, etc. The container does NOT need to bind on the host."
          >
            <Input
              type="number"
              min={1}
              max={65535}
              value={draftPort}
              onChange={(e) => setDraftPort(e.target.value)}
              placeholder="8080"
            />
          </Field>
          <Field
            label="Slug"
            optional
            hint={`Empty = auto-generated (e.g. quiet-otter-7f3a). Final URL: <slug>.${domainRoot}`}
          >
            <Input
              value={draftSlug}
              onChange={(e) => setDraftSlug(e.target.value)}
              placeholder="leave empty to auto-generate"
              maxLength={63}
            />
          </Field>
          <div className="md:col-span-2 flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy}>
              <Plus className="h-3 w-3" /> Create domain
            </Button>
            <Hint>
              Wildcard cert is already issued — new slugs are reachable within
              a couple seconds (Caddy reload + TLS handshake on first hit).
            </Hint>
          </div>
        </form>
      </Card>
    </div>
  );
}
