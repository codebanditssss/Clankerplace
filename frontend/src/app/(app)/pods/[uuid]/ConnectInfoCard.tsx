"use client";

// Surface how to reach a pod from the top of the Dashboard.
//   - TCP pods (Minecraft): show the public host:port to paste into a client.
//   - HTTP pods (n8n, code-sandbox): show the auto-domain URL with a
//     prominent "Open" button. n8n's first visit is the owner-account
//     setup (its built-in login/user management), so we hint that.

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import { Card } from "@/components/ui/card";
import { POD_TYPE_BY_SLUG } from "@/lib/pod-types";

type Allocation = {
  host: string | null;
  port: number | null;
  ip: string | null;
  connect: string | null;
};

type DomainRow = { slug: string; kind: string; url: string; port: number };

export default function ConnectInfoCard({
  identifier,
  podTypeSlug,
}: {
  identifier: string;
  podTypeSlug: string;
}) {
  const podType = POD_TYPE_BY_SLUG[podTypeSlug];
  const isHttp = podType?.surface.kind === "http";
  const isTcp = podType?.surface.kind === "tcp";

  const [alloc, setAlloc] = useState<Allocation | null>(null);
  const [autoUrl, setAutoUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // TCP: poll the allocation. HTTP: poll for the auto-domain (created
  // shortly after install, so it may not exist on first render).
  useEffect(() => {
    if (!isTcp) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/pods/${identifier}/allocation`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const d = (await r.json()) as Allocation;
        if (!cancelled) setAlloc(d);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [identifier, isTcp]);

  useEffect(() => {
    if (!isHttp) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function poll() {
      try {
        const r = await fetch(`/api/pods/${identifier}/domains`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const d = (await r.json()) as { domains: DomainRow[] };
        const auto = d.domains?.find((x) => x.kind === "auto") ?? d.domains?.[0];
        if (auto && !cancelled) {
          setAutoUrl(auto.url);
          if (timer) clearInterval(timer);
        }
      } catch {}
    }
    poll();
    timer = setInterval(poll, 6000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [identifier, isHttp]);

  if (!podType) return null;

  // ---- HTTP web-app pods ----
  if (isHttp) {
    if (!autoUrl) return null; // no card until the auto-domain exists
    const isN8n = podTypeSlug === "n8n";
    return (
      <Card className="p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            <Globe className="h-3 w-3" /> Web UI
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <a
              href={autoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 border border-[color:var(--border-strong)] bg-[color:var(--bg-3)] px-3 py-1.5 text-[13px] text-[color:var(--text-primary)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open {podType.label}
            </a>
            <code className="border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 font-mono text-[12px] text-[color:var(--text-secondary)]">
              {autoUrl.replace(/^https:\/\//, "")}
            </code>
            <button
              type="button"
              onClick={() => copyText(autoUrl, setCopied)}
              className="inline-flex flex-none items-center gap-1 border border-[color:var(--border)] bg-[color:var(--bg-3)] px-2 py-1.5 text-[11px] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)]"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" /> copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> copy
                </>
              )}
            </button>
          </div>
          {isN8n && (
            <p className="mt-2 text-[11.5px] text-[color:var(--text-tertiary)]">
              First visit creates your <strong>owner account</strong> (email +
              password) — that login then gates the editor. Public webhooks stay
              reachable at <code>/webhook/&lt;path&gt;</code>. If the page 404s
              right after deploy, give it ~30s to finish booting and refresh.
            </p>
          )}
        </div>
      </Card>
    );
  }

  // ---- TCP pods (Minecraft) ----
  if (!isTcp || !alloc?.connect) return null;
  const protocolLabel =
    podType.surface.kind === "tcp" && podType.surface.protocol === "minecraft"
      ? "Minecraft server address"
      : "TCP address";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            <Globe className="h-3 w-3" /> {protocolLabel}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 font-mono text-[13px] text-[color:var(--text-primary)]">
              {alloc.connect}
            </code>
            <button
              type="button"
              onClick={() => copyText(alloc.connect!, setCopied)}
              className="inline-flex flex-none items-center gap-1 border border-[color:var(--border)] bg-[color:var(--bg-3)] px-2 py-1.5 text-[11px] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)]"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" /> copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> copy
                </>
              )}
            </button>
          </div>
          {podType.surface.kind === "tcp" &&
            podType.surface.protocol === "minecraft" && (
              <p className="mt-2 text-[11.5px] text-[color:var(--text-tertiary)]">
                Open Minecraft → Multiplayer → Add Server → paste the address
                above. Use the web console here to <code>op &lt;you&gt;</code>{" "}
                yourself, then run any Bukkit/Paper command.
              </p>
            )}
        </div>
      </div>
    </Card>
  );
}

async function copyText(
  text: string,
  setCopied: (v: boolean) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  } catch {}
}
