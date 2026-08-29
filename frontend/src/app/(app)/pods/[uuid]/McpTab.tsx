"use client";

// One-click MCP server install. Browse the catalog → fill in any
// required API keys → click Install → Hermes restarts and the agent
// gets the new tools on next prompt. Installed servers show a tick;
// click Remove to uninstall.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  Plug,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  MCP_CATALOG,
  MCP_BY_ID,
  MCP_CATEGORIES,
  type McpServer,
} from "@/lib/mcp-catalog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PodsLoader } from "@/components/ui/pods-loader";
import { Field, Input, Hint } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { POD_SETTLING_NOTICE } from "@/lib/pod-settling";

type Installed = { id: string; kind: "stdio" | "remote" };

export default function McpTab({
  identifier,
  installed,
}: {
  identifier: string;
  installed: boolean;
}) {
  const [list, setList] = useState<Installed[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<McpServer | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  async function refresh() {
    try {
      const r = await fetch(`/api/pods/${identifier}/mcp`, {
        cache: "no-store",
      });
      const d = (await r.json()) as { installed?: Installed[] };
      setList(d.installed ?? []);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }
  useEffect(() => {
    if (!installed) return;
    refresh();
    const t = setInterval(refresh, 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier, installed]);

  const installedIds = useMemo(() => new Set(list.map((x) => x.id)), [list]);
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = MCP_CATALOG.filter(
      (m) =>
        !q ||
        m.id.includes(q) ||
        m.label.toLowerCase().includes(q) ||
        m.blurb.toLowerCase().includes(q),
    );
    const groups = new Map<McpServer["category"], McpServer[]>();
    for (const m of all) {
      if (!groups.has(m.category)) groups.set(m.category, []);
      groups.get(m.category)!.push(m);
    }
    return groups;
  }, [search]);

  async function uninstall(id: string) {
    if (!confirm(`Uninstall ${MCP_BY_ID[id]?.label ?? id} and restart Hermes?`))
      return;
    try {
      const r = await fetch(`/api/pods/${identifier}/mcp?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!d.ok) toast.error(d.error ?? "failed");
      else {
        toast.success(`${id} removed — gateway restarting`, {
          description: POD_SETTLING_NOTICE,
          duration: 8000,
        });
        refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (!installed) {
    return (
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        MCP install unlocks once the pod finishes installing.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] text-[color:var(--text-tertiary)]">
            Browse the Model Context Protocol catalog and add tools the agent
            can call. Click <em>Install</em> → fill in the credentials → Hermes
            restarts with the new tools on tap.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-quaternary)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search MCP servers…"
            className="h-8 w-64 border border-[color:var(--border)] bg-[color:var(--bg-1)] pl-7 pr-3 text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCustomOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add custom MCP
        </Button>
      </div>

      {loaded && list.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
            Installed ({list.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {list.map((x) => {
              const spec = MCP_BY_ID[x.id];
              return (
                <span
                  key={x.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--acc-green)]/30 bg-[color:var(--acc-green-soft)]/20 px-2.5 py-1 text-[11px]"
                >
                  <Check className="h-3 w-3 text-[color:var(--acc-green)]" />
                  <span className={spec?.accent ?? ""}>
                    {spec?.label ?? x.id}
                  </span>
                  <button
                    type="button"
                    onClick={() => uninstall(x.id)}
                    className="text-[color:var(--text-quaternary)] hover:text-[color:var(--acc-red)]"
                    title="Uninstall"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([cat, items]) => (
          <section key={cat}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
              {MCP_CATEGORIES[cat]}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((m) => (
                <McpCard
                  key={m.id}
                  server={m}
                  installed={installedIds.has(m.id)}
                  onInstall={() => setPicked(m)}
                  onUninstall={() => uninstall(m.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <Sheet
        open={!!picked}
        onOpenChange={(v) => !v && setPicked(null)}
        width={520}
        title={picked ? `Install ${picked.label}` : null}
      >
        {picked && (
          <InstallForm
            identifier={identifier}
            server={picked}
            onClose={() => setPicked(null)}
            onSuccess={() => {
              setPicked(null);
              refresh();
            }}
          />
        )}
      </Sheet>

      <Sheet
        open={customOpen}
        onOpenChange={setCustomOpen}
        width={560}
        title="Add a custom MCP server"
      >
        <CustomMcpForm
          identifier={identifier}
          installedIds={installedIds}
          onClose={() => setCustomOpen(false)}
          onSuccess={() => {
            setCustomOpen(false);
            refresh();
          }}
        />
      </Sheet>
    </div>
  );
}

function McpCard({
  server,
  installed,
  onInstall,
  onUninstall,
}: {
  server: McpServer;
  installed: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  return (
    <Card
      className={cn(
        "p-4 transition-colors",
        installed && "border-[color:var(--acc-green)]/30 bg-[color:var(--acc-green-soft)]/10",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Plug className={cn("h-3.5 w-3.5", server.accent)} />
            <span className="truncate text-[14px] font-semibold tracking-tight text-[color:var(--text-primary)]">
              {server.label}
            </span>
            {installed && (
              <Check className="h-3.5 w-3.5 flex-none text-[color:var(--acc-green)]" />
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
            {server.blurb}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {installed ? (
          <Button size="sm" variant="danger" onClick={onUninstall}>
            <Trash2 className="h-3 w-3" /> Uninstall
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onInstall}>
            <Sparkles className="h-3 w-3" /> Install
          </Button>
        )}
      </div>
    </Card>
  );
}

function InstallForm({
  identifier,
  server,
  onClose,
  onSuccess,
}: {
  identifier: string;
  server: McpServer;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const required = (server.fields ?? []).filter((f) => !f.optional);
  const missing = required.filter((f) => !(fields[f.env]?.trim()));
  const canSubmit = missing.length === 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/pods/${identifier}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: server.id, fields }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      toast.success(`${server.label} installed — gateway restarting`, {
        description: POD_SETTLING_NOTICE,
        duration: 8000,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className="flex-1 space-y-4 px-6 py-5">
        {busy && (
          <div className="border border-[color:var(--border)] bg-[color:var(--bg-1)] px-4 py-5">
            <PodsLoader
              size="sm"
              label={`Installing ${server.label}...`}
              className="mx-auto"
            />
          </div>
        )}
        <Card className="p-4">
          <h3 className="text-[13px] font-semibold tracking-tight text-[color:var(--text-primary)]">
            {server.label}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
            {server.blurb}
          </p>
          {server.docs && (
            <a
              href={server.docs}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
            >
              docs ↗
            </a>
          )}
        </Card>
        {(server.fields ?? []).length === 0 && (
          <p className="text-[12px] text-[color:var(--text-quaternary)]">
            No credentials needed. Click Install and Hermes will pick it up on
            restart.
          </p>
        )}
        {(server.fields ?? []).map((f) => (
          <Field key={f.env} label={f.label} optional={f.optional} hint={f.hint}>
            <Input
              type={f.secret ? "password" : "text"}
              value={fields[f.env] ?? ""}
              onChange={(e) =>
                setFields((p) => ({ ...p, [f.env]: e.target.value }))
              }
              placeholder={f.placeholder}
              required={!f.optional}
              autoComplete="off"
              spellCheck={false}
            />
            {f.hint && <Hint>{f.hint}</Hint>}
          </Field>
        ))}
        {error && (
          <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-3 py-2 text-[12px] text-[color:var(--acc-red)]">
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-6 py-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit} loading={busy}>
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Installing…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" /> Install
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

// Parse a textarea of `KEY=value` lines into a map (skips blanks/comments).
function parseKeyVals(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function CustomMcpForm({
  identifier,
  installedIds,
  onClose,
  onSuccess,
}: {
  identifier: string;
  installedIds: Set<string>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [id, setId] = useState("");
  const [kind, setKind] = useState<"stdio" | "remote">("stdio");
  // stdio
  const [command, setCommand] = useState("npx");
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  // remote
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"streamable_http" | "sse">(
    "streamable_http",
  );
  const [authMode, setAuthMode] = useState<"headers" | "oauth">("headers");
  const [headersText, setHeadersText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idOk = /^[a-z0-9][a-z0-9_-]{0,40}$/.test(id);
  const idDup = installedIds.has(id);
  const canSubmit =
    idOk &&
    !idDup &&
    !busy &&
    (kind === "remote" ? /^https?:\/\//i.test(url.trim()) : command.trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const custom =
      kind === "remote"
        ? {
            id,
            kind,
            url: url.trim(),
            transport,
            ...(authMode === "oauth"
              ? { auth: "oauth" }
              : { headers: parseKeyVals(headersText) }),
          }
        : {
            id,
            kind,
            command: command.trim(),
            args: argsText
              .split("\n")
              .map((a) => a.trim())
              .filter((a) => a.length > 0),
            env: parseKeyVals(envText),
          };
    try {
      const r = await fetch(`/api/pods/${identifier}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custom }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      toast.success(`${id} added — gateway restarting`, {
        description: POD_SETTLING_NOTICE,
        duration: 8000,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {busy && (
          <div className="border border-[color:var(--border)] bg-[color:var(--bg-1)] px-4 py-5">
            <PodsLoader
              size="sm"
              label="Adding MCP server..."
              className="mx-auto"
            />
          </div>
        )}
        <p className="text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
          Wire any MCP server into Hermes — a local command (stdio) or a remote
          HTTP/SSE endpoint. Written to <code className="font-mono">mcp_servers</code>{" "}
          in the pod&apos;s config; the gateway restarts to pick it up.
        </p>

        <Field label="Server ID" hint="lowercase letters, digits, - or _">
          <Input
            value={id}
            onChange={(e) => setId(e.target.value.toLowerCase())}
            placeholder="my-mcp"
            autoComplete="off"
            spellCheck={false}
          />
          {id && !idOk && <Hint>Only a-z, 0-9, - and _ (must start alphanumeric).</Hint>}
          {idDup && <Hint>A server with this id is already installed.</Hint>}
        </Field>

        {/* transport toggle */}
        <div className="flex gap-2">
          {(["stdio", "remote"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "flex-1 border px-3 py-2 text-left text-[12px] transition-colors",
                kind === k
                  ? "border-[color:var(--border-strong)] bg-[color:var(--bg-3)] text-[color:var(--text-primary)]"
                  : "border-[color:var(--border)] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]",
              )}
            >
              <div className="font-semibold">
                {k === "stdio" ? "Local command" : "Remote URL"}
              </div>
              <div className="mt-0.5 text-[11px] text-[color:var(--text-quaternary)]">
                {k === "stdio" ? "npx / uvx / node …" : "HTTP or SSE endpoint"}
              </div>
            </button>
          ))}
        </div>

        {kind === "stdio" ? (
          <>
            <Field label="Command">
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Arguments" hint="one per line">
              <textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                placeholder={"-y\n@modelcontextprotocol/server-everything"}
                rows={4}
                spellCheck={false}
                className="w-full border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2 font-mono text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
              />
            </Field>
            <Field label="Environment" hint="KEY=value per line (optional)">
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder={"API_KEY=sk-…\nREGION=us-east-1"}
                rows={3}
                spellCheck={false}
                className="w-full border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2 font-mono text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/sse"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Transport">
              <div className="flex gap-2">
                {(["streamable_http", "sse"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTransport(t)}
                    className={cn(
                      "border px-3 py-1.5 font-mono text-[11px] transition-colors",
                      transport === t
                        ? "border-[color:var(--border-strong)] bg-[color:var(--bg-3)] text-[color:var(--text-primary)]"
                        : "border-[color:var(--border)] text-[color:var(--text-tertiary)]",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Authentication">
              <div className="flex gap-2">
                {([
                  ["headers", "API key / headers"],
                  ["oauth", "OAuth 2.1"],
                ] as const).map(([m, lbl]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAuthMode(m)}
                    className={cn(
                      "border px-3 py-1.5 text-[11px] transition-colors",
                      authMode === m
                        ? "border-[color:var(--border-strong)] bg-[color:var(--bg-3)] text-[color:var(--text-primary)]"
                        : "border-[color:var(--border)] text-[color:var(--text-tertiary)]",
                    )}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </Field>
            {authMode === "oauth" ? (
              <div className="border border-[color:var(--acc-blue)]/30 bg-[color:var(--bg-1)] px-3 py-2.5 text-[11px] leading-relaxed text-[color:var(--text-tertiary)]">
                Hermes runs the OAuth 2.1 PKCE flow (discovery, dynamic client
                registration, token refresh). On first connect it prints an
                authorization URL — open it from the pod{" "}
                <strong className="text-[color:var(--text-secondary)]">Console</strong>{" "}
                to approve. Tokens are stored in the pod and reused across
                sessions.
              </div>
            ) : (
              <Field label="Headers" hint="KEY=value per line (e.g. Authorization=Bearer …)">
                <textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder={"Authorization=Bearer sk-…"}
                  rows={3}
                  spellCheck={false}
                  className="w-full border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2 font-mono text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
                />
              </Field>
            )}
          </>
        )}

        {error && (
          <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-3 py-2 text-[12px] text-[color:var(--acc-red)]">
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-6 py-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit} loading={busy}>
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" /> Add MCP
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
