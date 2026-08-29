"use client";

// Minecraft management surface — server settings + plugins + version control.
//
// Layout (top to bottom):
//   1. Version card: current Paper version + dropdown to switch
//      (triggers Pelican reinstall, world data survives).
//   2. Settings (server.properties): grouped form with the highest-value
//      knobs (gamemode, difficulty, pvp, online-mode, white-list,
//      view-distance, max-players, motd, …).
//   3. Installed plugins: JARs in /home/container/plugins. Uninstall
//      with a click.
//   4. Browse: Modrinth search across Paper/Spigot/Bukkit plugins,
//      filtered to the pod's current MC version. Install with a click.
//
// The plugin install path downloads the JAR inside the pod (curl from
// the container) so the frontend never proxies binary data.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Hint } from "@/components/ui/input";
import {
  SERVER_PROPS,
  SERVER_PROPS_GROUPS,
  type PropField,
} from "@/lib/minecraft-properties";

type SearchHit = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  versions: string[];
  downloads: number;
  follows: number;
  icon_url: string | null;
  latest_version: string | null;
  author: string;
};

type VersionInfo = { current: string; versions: string[] };

export default function MinecraftTab({
  identifier,
  installed,
}: {
  identifier: string;
  installed: boolean;
}) {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [installedJars, setInstalledJars] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [vRes, jarsRes] = await Promise.all([
        fetch(`/api/pods/${identifier}/minecraft/version`, { cache: "no-store" }),
        fetch(`/api/pods/${identifier}/minecraft/plugins?installed=1`, {
          cache: "no-store",
        }),
      ]);
      if (vRes.ok) setVersionInfo((await vRes.json()) as VersionInfo);
      if (jarsRes.ok) {
        const d = (await jarsRes.json()) as { installed: string[] };
        setInstalledJars(d.installed ?? []);
      }
    } catch {}
  }, [identifier]);

  useEffect(() => {
    if (!installed) return;
    refreshAll();
  }, [installed, refreshAll]);

  // Auto-search on mount + when query / mc-version changes (debounced).
  useEffect(() => {
    if (!installed) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const mcv = versionInfo?.current && versionInfo.current !== "latest"
          ? `&mcv=${encodeURIComponent(versionInfo.current)}`
          : "";
        const r = await fetch(
          `/api/pods/${identifier}/minecraft/plugins?q=${encodeURIComponent(search)}${mcv}`,
          { cache: "no-store" },
        );
        if (r.ok) {
          const d = (await r.json()) as { hits: SearchHit[] };
          setHits(d.hits ?? []);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [installed, search, versionInfo?.current, identifier]);

  async function switchVersion(v: string) {
    if (!confirm(`Switch Paper to ${v}? Pod will reinstall — worlds + plugins survive, but the server briefly stops.`))
      return;
    try {
      const r = await fetch(`/api/pods/${identifier}/minecraft/version`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: v }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!d.ok) toast.error(d.error ?? "failed");
      else {
        toast.success(`Switching to Paper ${v}…`);
        setTimeout(refreshAll, 5000);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function installPlugin(projectId: string, title: string) {
    setInstallingId(projectId);
    try {
      const r = await fetch(`/api/pods/${identifier}/minecraft/plugins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          mcv: versionInfo?.current,
        }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; file?: string };
      if (!d.ok) {
        toast.error(d.error ?? "install failed");
        return;
      }
      toast.success(`${title} installed (${d.file}). Restart the server to load it.`);
      refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingId(null);
    }
  }

  async function uninstall(file: string) {
    if (!confirm(`Remove ${file}? You'll need to restart for the unload to take effect.`)) return;
    try {
      const r = await fetch(
        `/api/pods/${identifier}/minecraft/plugins?file=${encodeURIComponent(file)}`,
        { method: "DELETE" },
      );
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!d.ok) toast.error(d.error ?? "remove failed");
      else {
        toast.success(`${file} removed`);
        refreshAll();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const installedSet = useMemo(() => new Set(installedJars), [installedJars]);

  if (!installed) {
    return (
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        Plugin + version management unlocks once the pod finishes installing.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <VersionCard
        info={versionInfo}
        onSwitch={switchVersion}
        onRefresh={refreshAll}
      />

      <SettingsCard identifier={identifier} />

      <InstalledCard
        jars={installedJars}
        onUninstall={uninstall}
        onRefresh={refreshAll}
      />

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold tracking-tight text-[color:var(--text-primary)]">
              Browse plugins
            </h3>
            <p className="mt-0.5 text-[11.5px] text-[color:var(--text-tertiary)]">
              Modrinth catalog · Paper/Spigot/Bukkit · filtered to your current
              MC version ({versionInfo?.current ?? "any"})
            </p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-quaternary)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search 1000s of plugins…"
              className="h-9 w-72 border border-[color:var(--border)] bg-[color:var(--bg-1)] pl-8 pr-3 text-[13px] focus:border-[color:var(--border-strong)] focus:outline-none"
            />
            {searching && (
              <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-[color:var(--text-quaternary)]" />
            )}
          </div>
        </div>

        {hits.length === 0 && !searching ? (
          <Card className="p-6 text-center">
            <p className="text-[12px] text-[color:var(--text-tertiary)]">
              No plugins matched. Try a broader query, or clear it to see the
              most-downloaded plugins.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {hits.map((h) => (
              <PluginCard
                key={h.project_id}
                hit={h}
                installed={installedSet.has(`${h.slug}.jar`)}
                installing={installingId === h.project_id}
                onInstall={() => installPlugin(h.project_id, h.title)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function VersionCard({
  info,
  onSwitch,
  onRefresh,
}: {
  info: VersionInfo | null;
  onSwitch: (v: string) => void;
  onRefresh: () => void;
}) {
  // Show the 10 newest Paper versions in the dropdown — that's normally
  // 1.21.x patches + the previous minor. Power users can edit via the
  // Pelican panel if they need something older.
  const top = (info?.versions ?? []).slice(0, 20);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            Server version
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 font-mono text-[13px] text-[color:var(--text-primary)]">
              Paper {info?.current ?? "…"}
            </code>
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) onSwitch(v);
              }}
              className="h-9 border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2.5 text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
            >
              <option value="">Switch to…</option>
              <option value="latest">latest (auto-pin)</option>
              {top.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
          <p className="mt-2 text-[11.5px] text-[color:var(--text-tertiary)]">
            Switching triggers a Pelican reinstall — the Paper jar is
            re-downloaded for the chosen version. <strong>Worlds, plugins,
            server.properties survive</strong>; only the JAR is replaced.
          </p>
        </div>
      </div>
    </Card>
  );
}

function InstalledCard({
  jars,
  onUninstall,
  onRefresh,
}: {
  jars: string[];
  onUninstall: (f: string) => void;
  onRefresh: () => void;
}) {
  if (jars.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
              Installed plugins
            </div>
            <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
              None yet — browse below.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
          Installed plugins ({jars.length})
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {jars.map((f) => (
          <span
            key={f}
            className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--acc-green)]/30 bg-[color:var(--acc-green-soft)]/20 px-2.5 py-1 font-mono text-[11px]"
          >
            <Check className="h-3 w-3 text-[color:var(--acc-green)]" />
            <span className="max-w-[200px] truncate">{f}</span>
            <button
              type="button"
              onClick={() => onUninstall(f)}
              className="text-[color:var(--text-quaternary)] hover:text-[color:var(--acc-red)]"
              title="Uninstall"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </Card>
  );
}

function PluginCard({
  hit,
  installed,
  installing,
  onInstall,
}: {
  hit: SearchHit;
  installed: boolean;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <Card className="flex h-full flex-col p-3.5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 flex-none overflow-hidden border border-[color:var(--border)] bg-[color:var(--bg-2)]">
          {hit.icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hit.icon_url}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Package className="h-4 w-4 text-[color:var(--text-quaternary)]" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <a
              href={`https://modrinth.com/plugin/${hit.slug}`}
              target="_blank"
              rel="noreferrer"
              className="truncate text-[13px] font-semibold tracking-tight text-[color:var(--text-primary)] hover:text-[color:var(--acc-blue)]"
              title={hit.title}
            >
              {hit.title}
            </a>
            <ExternalLink className="h-3 w-3 flex-none text-[color:var(--text-quaternary)]" />
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-[color:var(--text-quaternary)]">
            by {hit.author} · {fmtNum(hit.downloads)} dl
          </div>
        </div>
      </div>
      <p className="mt-2 line-clamp-3 flex-1 text-[11.5px] leading-relaxed text-[color:var(--text-tertiary)]">
        {hit.description}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {hit.categories.slice(0, 3).map((c) => (
            <span
              key={c}
              className="border border-[color:var(--border)] bg-[color:var(--bg-2)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[color:var(--text-tertiary)]"
            >
              {c}
            </span>
          ))}
        </div>
        {installed ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-[color:var(--acc-green)]">
            <Check className="h-3 w-3" /> installed
          </span>
        ) : (
          <Button size="sm" variant="primary" onClick={onInstall} disabled={installing}>
            {installing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> installing…
              </>
            ) : (
              <>
                <Download className="h-3 w-3" /> install
              </>
            )}
          </Button>
        )}
      </div>
    </Card>
  );
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function SettingsCard({ identifier }: { identifier: string }) {
  const [props, setProps] = useState<Record<string, string> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [openGroups, setOpenGroups] = useState<
    Record<PropField["group"], boolean>
  >({
    core: true,
    gameplay: true,
    world: false,
    network: false,
    security: false,
    perf: false,
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/pods/${identifier}/minecraft/properties`,
        { cache: "no-store" },
      );
      const d = (await r.json()) as { props?: Record<string, string> };
      if (d.props) {
        setProps(d.props);
        setDraft({});
      }
    } catch (err) {
      // Quietly tolerate — server.properties may not exist before first start.
    } finally {
      setLoading(false);
    }
  }, [identifier]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const g: Record<PropField["group"], PropField[]> = {
      core: [],
      gameplay: [],
      world: [],
      network: [],
      security: [],
      perf: [],
    };
    for (const p of SERVER_PROPS) g[p.group].push(p);
    return g;
  }, []);

  function valueOf(p: PropField): string {
    return draft[p.key] ?? props?.[p.key] ?? p.default ?? "";
  }

  function setValue(p: PropField, v: string) {
    setDraft((prev) => ({ ...prev, [p.key]: v }));
  }

  const dirtyCount = Object.keys(draft).filter(
    (k) => draft[k] !== (props?.[k] ?? ""),
  ).length;

  async function save() {
    if (dirtyCount === 0) return;
    setSaving(true);
    try {
      const r = await fetch(
        `/api/pods/${identifier}/minecraft/properties`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes: draft }),
        },
      );
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!d.ok) {
        toast.error(d.error ?? "save failed");
        return;
      }
      toast.success(
        `Saved ${dirtyCount} setting${dirtyCount === 1 ? "" : "s"} — restart the server to apply.`,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-3.5 w-3.5 text-[color:var(--text-tertiary)]" />
          <span className="text-[12px] font-semibold tracking-tight">
            server.properties
          </span>
          {loading && (
            <Loader2 className="h-3 w-3 animate-spin text-[color:var(--text-quaternary)]" />
          )}
          {dirtyCount > 0 && (
            <span className="rounded-full border border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)]/30 px-1.5 text-[10px] text-[color:var(--acc-amber)]">
              {dirtyCount} unsaved
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={save}
          disabled={dirtyCount === 0}
          loading={saving}
        >
          <Save className="h-3 w-3" /> Save
        </Button>
      </div>

      {props === null && !loading && (
        <p className="px-4 py-4 text-[11.5px] text-[color:var(--text-tertiary)]">
          server.properties hasn't been generated yet — start the server once
          from the Actions menu, then come back.
        </p>
      )}

      {props !== null && (
        <div className="divide-y divide-[color:var(--border-subtle)]">
          {(Object.keys(grouped) as PropField["group"][]).map((gk) => {
            const items = grouped[gk];
            const isOpen = openGroups[gk];
            return (
              <section key={gk}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((p) => ({ ...p, [gk]: !p[gk] }))
                  }
                  className="flex w-full items-center justify-between gap-2 px-4 py-2 hover:bg-[color:var(--bg-2)]"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
                    {SERVER_PROPS_GROUPS[gk]}
                  </span>
                  <span className="text-[10px] text-[color:var(--text-quaternary)]">
                    {items.length}
                  </span>
                  {isOpen ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
                {isOpen && (
                  <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">
                    {items.map((p) => (
                      <PropRow
                        key={p.key}
                        spec={p}
                        value={valueOf(p)}
                        dirty={
                          draft[p.key] !== undefined &&
                          draft[p.key] !== (props?.[p.key] ?? "")
                        }
                        onChange={(v) => setValue(p, v)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function PropRow({
  spec,
  value,
  dirty,
  onChange,
}: {
  spec: PropField;
  value: string;
  dirty: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="block text-[11.5px] font-medium text-[color:var(--text-secondary)]">
          {spec.label}
          {dirty && (
            <span className="ml-1.5 text-[10px] text-[color:var(--acc-amber)]">
              •
            </span>
          )}
        </label>
        <code className="text-[9.5px] text-[color:var(--text-quaternary)]">
          {spec.key}
        </code>
      </div>
      <div className="mt-1">
        {spec.kind === "bool" ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2 text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : spec.kind === "enum" ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2 text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
          >
            {spec.enum!.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : spec.kind === "number" ? (
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2 font-mono text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2 font-mono text-[12px] focus:border-[color:var(--border-strong)] focus:outline-none"
          />
        )}
      </div>
      {spec.help && (
        <p className="mt-1 text-[10.5px] leading-relaxed text-[color:var(--text-tertiary)]">
          {spec.help}
        </p>
      )}
    </div>
  );
}
