"use client";

// Skills manager — browse Hermes' resolved registry index, install /
// uninstall with one click, inspect installed SKILL.md bodies in a
// side sheet. Two view modes: "Browse" (everything Hermes has cached
// from skills.sh, ClawHub, browse.sh, etc.) and "Installed" (what's
// actually on disk under ~/.hermes/skills/).
//
// Registry data comes from /api/pods/<id>/skills/browse which reads
// the pod's pre-resolved .hub/index-cache JSON. Mutations call the
// hermes CLI through the API; on success we refetch the installed list.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Boxes,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PodsLoader } from "@/components/ui/pods-loader";
import { Sheet } from "@/components/ui/sheet";
import { Field, Hint, Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";

type InstalledSkill = {
  name: string;
  category: string;
  description: string;
  tags: string[];
  path: string;
};

type RegistrySkill = {
  identifier: string;
  name: string;
  description: string;
  source: string;
  trust: "official" | "trusted" | "community" | "unknown";
  installs?: number;
  detailUrl?: string;
  repoUrl?: string;
  tags?: string[];
};

type BrowseResponse = {
  items: RegistrySkill[];
  total: number;
  page: number;
  pageSize: number;
  sources: string[];
};

type Mode = "browse" | "installed";

export default function SkillsTab({
  identifier,
  installed,
  active = true,
}: {
  identifier: string;
  installed: boolean;
  active?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("installed");
  const [installedList, setInstalledList] = useState<InstalledSkill[]>([]);
  const [installedLoaded, setInstalledLoaded] = useState(false);

  // Browse state
  const [browse, setBrowse] = useState<BrowseResponse | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseErr, setBrowseErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 24;

  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<RegistrySkill | InstalledSkill | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [hasActivated, setHasActivated] = useState(active);

  const installedIds = useMemo(
    () => new Set(installedList.map((s) => s.name.toLowerCase())),
    [installedList],
  );

  useEffect(() => {
    if (active) setHasActivated(true);
  }, [active]);

  useEffect(() => {
    if (!active) setOpen(null);
  }, [active]);

  const refreshInstalled = useCallback(async () => {
    try {
      const r = await fetch(`/api/pods/${identifier}/skills`, {
        cache: "no-store",
      });
      const d = (await r.json()) as { skills?: InstalledSkill[]; error?: string };
      if (!r.ok) {
        toast.error(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setInstalledList(d.skills ?? []);
      setInstalledLoaded(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [identifier]);

  const loadBrowse = useCallback(async () => {
    setBrowseLoading(true);
    setBrowseErr(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        source,
      });
      if (q.trim()) params.set("q", q.trim());
      const r = await fetch(
        `/api/pods/${identifier}/skills/browse?${params.toString()}`,
        { cache: "no-store" },
      );
      const d = (await r.json()) as BrowseResponse & { error?: string };
      if (!r.ok) {
        setBrowseErr(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setBrowse(d);
    } catch (e) {
      setBrowseErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowseLoading(false);
    }
  }, [identifier, page, source, q]);

  useEffect(() => {
    if (!installed || !hasActivated) return;
    refreshInstalled();
  }, [installed, hasActivated, refreshInstalled]);

  useEffect(() => {
    if (!installed || !hasActivated) return;
    if (mode !== "browse") return;
    loadBrowse();
  }, [installed, hasActivated, mode, loadBrowse]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1);
  }, [q, source]);

  async function install(skill: RegistrySkill) {
    setBusy(skill.identifier);
    try {
      const r = await fetch(`/api/pods/${identifier}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: skill.identifier }),
      });
      const d = (await r.json()) as { ok?: true; error?: string };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `Install failed: HTTP ${r.status}`);
        return;
      }
      toast.success(`Installed ${skill.name}`);
      await refreshInstalled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function uninstall(s: InstalledSkill) {
    if (!confirm(`Uninstall "${s.name}"? This removes the skill from disk.`))
      return;
    setBusy(s.name);
    try {
      const r = await fetch(
        `/api/pods/${identifier}/skills?name=${encodeURIComponent(s.name)}`,
        { method: "DELETE" },
      );
      const d = (await r.json()) as { ok?: true; error?: string };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `Uninstall failed: HTTP ${r.status}`);
        return;
      }
      toast.success(`Removed ${s.name}`);
      await refreshInstalled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function refreshRegistry() {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/pods/${identifier}/skills/refresh`, {
        method: "POST",
      });
      const d = (await r.json()) as { ok?: true; error?: string };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `Refresh failed: HTTP ${r.status}`);
        return;
      }
      toast.success("Registry index refreshed");
      await loadBrowse();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCustomCreated() {
    setCustomOpen(false);
    setMode("installed");
    await refreshInstalled();
  }

  if (!installed) {
    return (
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        Pod is still installing — skills manager unlocks when the agent is live.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 flex-none items-center justify-center border border-[color:var(--border)] bg-[color:var(--bg-3)]">
              <Sparkles className="h-4 w-4 text-[color:var(--acc-purple)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-tight">
                Skills
              </div>
              <p className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">
                Installable agent skills — small prompt+script bundles that
                teach Hermes new behaviors. Browsing reads Hermes&apos; own
                resolved index across skills.sh, ClawHub, GitHub, browse.sh,
                Lobehub, and official sources.
              </p>
              <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
                Skills are saved immediately. The agent may pick them up on the
                next message; if not, restart the pod.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 border border-[color:var(--border)] bg-[color:var(--bg-1)] p-1">
            {(["installed", "browse"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition-colors",
                  mode === m
                    ? "bg-[color:var(--bg-3)] text-[color:var(--text-primary)]"
                    : "text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]",
                )}
              >
                {m === "installed"
                  ? `Installed (${installedList.length})`
                  : "Browse"}
              </button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCustomOpen(true)}
            >
              <Plus className="h-3 w-3" /> Custom
            </Button>
          </div>
        </CardHeader>
      </Card>

      {mode === "installed" ? (
        <InstalledList
          loaded={installedLoaded}
          skills={installedList}
          busy={busy}
          onUninstall={uninstall}
          onOpen={setOpen}
        />
      ) : (
        <BrowseList
          response={browse}
          loading={browseLoading}
          err={browseErr}
          q={q}
          setQ={setQ}
          source={source}
          setSource={setSource}
          page={page}
          setPage={setPage}
          refreshing={refreshing}
          onRefresh={refreshRegistry}
          busy={busy}
          installedIds={installedIds}
          onInstall={install}
          onOpen={setOpen}
        />
      )}

      <DetailSheet
        identifier={identifier}
        item={open}
        onClose={() => setOpen(null)}
        installedIds={installedIds}
        onInstall={install}
        busy={busy}
      />
      <CustomSkillSheet
        identifier={identifier}
        open={customOpen}
        onOpenChange={setCustomOpen}
        existingNames={installedIds}
        onCreated={handleCustomCreated}
      />
    </div>
  );
}

function CustomSkillSheet({
  identifier,
  open,
  onOpenChange,
  existingNames,
  onCreated,
}: {
  identifier: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingNames: Set<string>;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedName = name.trim().toLowerCase();
  const nameOk = /^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalizedName);
  const duplicate = existingNames.has(normalizedName);
  const instructionsOk = instructions.trim().length >= 20;
  const canSubmit =
    nameOk && !duplicate && instructionsOk && description.length <= 240 && !busy;

  function handleOpenChange(nextOpen: boolean) {
    if (busy && !nextOpen) return;
    onOpenChange(nextOpen);
  }

  useEffect(() => {
    if (open) return;
    setName("");
    setDescription("");
    setInstructions("");
    setTags("");
    setError(null);
    setBusy(false);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/pods/${identifier}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          custom: {
            name: normalizedName,
            description: description.trim(),
            instructions: instructions.trim(),
            tags: tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          },
        }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: true;
        error?: string;
      };
      if (!r.ok || !d.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      toast.success(`Created ${normalizedName}`);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
      title="Custom skill"
      description="Create a local SKILL.md under custom/ on this Hermes pod. It is saved immediately and may be picked up on the next agent message."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="custom-skill-form"
            variant="primary"
            size="md"
            loading={busy}
            disabled={!canSubmit}
          >
            Create skill
          </Button>
        </div>
      }
    >
      <form
        id="custom-skill-form"
        onSubmit={submit}
        className="space-y-4 px-6 py-5"
      >
        {busy && (
          <div className="border border-[color:var(--border)] bg-[color:var(--bg-1)] px-4 py-5">
            <PodsLoader
              size="sm"
              label="Creating custom skill..."
              className="mx-auto"
            />
          </div>
        )}
        <Field label="Skill name" hint="lowercase id, used as the folder name">
          <Input
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
                  .toLowerCase()
                  .replace(/\s+/g, "-")
                  .replace(/[^a-z0-9._-]/g, ""),
              )
            }
            placeholder="summarize-research"
            spellCheck={false}
          />
          {name && !nameOk && (
            <Hint>
              Use 2-64 chars: lowercase letters, numbers, dot, dash, or
              underscore. Start with a letter or number.
            </Hint>
          )}
          {duplicate && <Hint>A skill with this name is already installed.</Hint>}
        </Field>

        <Field label="Description" optional hint="shown in the installed list">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 240))}
            placeholder="Teaches the agent how to..."
          />
          <Hint>{description.length}/240</Hint>
        </Field>

        <Field label="Instructions">
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={12}
            placeholder={`When this skill is relevant, do the following:\n\n1. ...\n2. ...`}
            className="font-mono text-[12px]"
          />
          {!instructionsOk && instructions.length > 0 && (
            <Hint>Write at least 20 characters of instructions.</Hint>
          )}
        </Field>

        <Field label="Tags" optional hint="comma-separated">
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="research, docs, automation"
          />
        </Field>

        {error && (
          <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-3 py-2 text-[12px] text-[color:var(--acc-red)]">
            {error}
          </div>
        )}
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Installed

function InstalledList({
  loaded,
  skills,
  busy,
  onUninstall,
  onOpen,
}: {
  loaded: boolean;
  skills: InstalledSkill[];
  busy: string | null;
  onUninstall: (s: InstalledSkill) => void;
  onOpen: (s: InstalledSkill) => void;
}) {
  if (!loaded) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-[12px] text-[color:var(--text-tertiary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading installed skills…
          </div>
        </CardBody>
      </Card>
    );
  }
  if (skills.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-[12px] text-[color:var(--text-tertiary)]">
            No skills installed yet. Switch to <strong>Browse</strong> to find
            one — the agent picks them up on the next message.
          </p>
        </CardBody>
      </Card>
    );
  }
  // Group by category.
  const groups = new Map<string, InstalledSkill[]>();
  for (const s of skills) {
    const k = s.category || "uncategorized";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([cat, list]) => (
        <Card key={cat}>
          <CardHeader>
            <div className="text-[11px] font-mono uppercase tracking-wider text-[color:var(--text-secondary)]">
              {cat}
            </div>
            <span className="text-[11px] text-[color:var(--text-tertiary)]">
              {list.length} {list.length === 1 ? "skill" : "skills"}
            </span>
          </CardHeader>
          <CardBody className="grid gap-px border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] sm:grid-cols-2">
            {list.map((s) => (
              <button
                key={s.path}
                type="button"
                onClick={() => onOpen(s)}
                className="group flex flex-col items-start gap-1.5 bg-[color:var(--bg-1)] p-3 text-left transition-colors hover:bg-[color:var(--bg-3)]"
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--acc-green)]" />
                    <div className="text-[13px] font-medium text-[color:var(--text-primary)]">
                      {s.name}
                    </div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUninstall(s);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        onUninstall(s);
                      }
                    }}
                    className={cn(
                      "rounded-sm border border-transparent p-1 text-[color:var(--text-quaternary)] hover:border-[color:var(--acc-red)]/30 hover:text-[color:var(--acc-red)]",
                      busy === s.name && "pointer-events-none opacity-60",
                    )}
                    aria-label={`Uninstall ${s.name}`}
                  >
                    {busy === s.name ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </span>
                </div>
                <p className="line-clamp-2 text-[11px] leading-snug text-[color:var(--text-tertiary)]">
                  {s.description || "(no description)"}
                </p>
                {s.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.tags.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="border border-[color:var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[color:var(--text-quaternary)]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Browse

function BrowseList({
  response,
  loading,
  err,
  q,
  setQ,
  source,
  setSource,
  page,
  setPage,
  refreshing,
  onRefresh,
  busy,
  installedIds,
  onInstall,
  onOpen,
}: {
  response: BrowseResponse | null;
  loading: boolean;
  err: string | null;
  q: string;
  setQ: (v: string) => void;
  source: string;
  setSource: (v: string) => void;
  page: number;
  setPage: (v: number) => void;
  refreshing: boolean;
  onRefresh: () => void;
  busy: string | null;
  installedIds: Set<string>;
  onInstall: (s: RegistrySkill) => void;
  onOpen: (s: RegistrySkill) => void;
}) {
  const sources = response?.sources ?? [];
  const totalPages = response
    ? Math.max(1, Math.ceil(response.total / response.pageSize))
    : 1;
  return (
    <Card>
      <CardHeader>
        <div className="flex w-full flex-wrap items-center gap-2">
          <div className="flex flex-1 items-center gap-2 border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-[color:var(--text-quaternary)]" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search skills (name, description, tags)…"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-tertiary)] focus:outline-none"
              data-1p-ignore="true"
              autoComplete="off"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="text-[color:var(--text-quaternary)] hover:text-[color:var(--text-secondary)]"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            loading={refreshing}
          >
            <RefreshCw className="h-3 w-3" /> Refresh index
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {["all", ...sources].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={cn(
                  "border px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider transition-colors",
                  source === s
                    ? "border-[color:var(--acc-purple)]/50 bg-[color:var(--acc-purple-soft)] text-[color:var(--acc-purple)]"
                    : "border-[color:var(--border)] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {err ? (
          <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-2.5 py-2 text-[12px] text-[color:var(--acc-red)]">
            {err}
          </div>
        ) : loading && !response ? (
          <div className="border border-[color:var(--border)] bg-[color:var(--bg-1)] px-4 py-5">
            <PodsLoader
              size="sm"
              label="Searching the skills index..."
              className="mx-auto"
            />
          </div>
        ) : !response || response.items.length === 0 ? (
          <p className="text-[12px] text-[color:var(--text-tertiary)]">
            No skills match. Try clearing filters or hitting{" "}
            <strong>Refresh index</strong> to pull the latest registries.
          </p>
        ) : (
          <>
            <div className="grid gap-px border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] sm:grid-cols-2">
              {response.items.map((s) => {
                const isInstalled = installedIds.has(s.name.toLowerCase());
                return (
                  <button
                    key={s.identifier}
                    type="button"
                    onClick={() => onOpen(s)}
                    className="group flex flex-col items-start gap-1.5 bg-[color:var(--bg-1)] p-3 text-left transition-colors hover:bg-[color:var(--bg-3)]"
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <Boxes className="h-3.5 w-3.5 flex-none text-[color:var(--acc-purple)]" />
                        <div className="truncate text-[13px] font-medium text-[color:var(--text-primary)]">
                          {s.name}
                        </div>
                        <TrustBadge trust={s.trust} />
                      </div>
                      {isInstalled ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[color:var(--acc-green)]">
                          <CheckCircle2 className="h-3 w-3" /> Installed
                        </span>
                      ) : (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onInstall(s);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              onInstall(s);
                            }
                          }}
                          className={cn(
                            "rounded-sm border border-[color:var(--border)] px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--acc-purple)]/50 hover:text-[color:var(--acc-purple)]",
                            busy === s.identifier &&
                              "pointer-events-none opacity-60",
                          )}
                        >
                          {busy === s.identifier ? (
                            <Loader2 className="inline h-3 w-3 animate-spin" />
                          ) : (
                            "Install"
                          )}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-[11px] leading-snug text-[color:var(--text-tertiary)]">
                      {s.description || "(no description)"}
                    </p>
                    <div className="flex w-full items-center justify-between gap-2 text-[10px] text-[color:var(--text-quaternary)]">
                      <span className="truncate font-mono">{s.source}</span>
                      {typeof s.installs === "number" && (
                        <span>{s.installs.toLocaleString()} installs</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-[color:var(--border-subtle)] pt-3 text-[11px] text-[color:var(--text-tertiary)]">
              <span>
                {response.total.toLocaleString()} skills · page {response.page}{" "}
                of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(page - 1)}
                >
                  Prev
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function TrustBadge({ trust }: { trust: RegistrySkill["trust"] }) {
  if (trust === "official") {
    return (
      <span className="border border-[color:var(--acc-blue)]/40 bg-[color:var(--acc-blue-soft)] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[color:var(--acc-blue)]">
        official
      </span>
    );
  }
  if (trust === "trusted") {
    return (
      <span className="border border-[color:var(--acc-green)]/40 bg-[color:var(--acc-green-soft)] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[color:var(--acc-green)]">
        trusted
      </span>
    );
  }
  if (trust === "community") {
    return (
      <span className="border border-[color:var(--border)] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[color:var(--text-quaternary)]">
        community
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------- Detail Sheet

function isInstalledSkill(
  s: RegistrySkill | InstalledSkill,
): s is InstalledSkill {
  return (s as InstalledSkill).path !== undefined;
}

function DetailSheet({
  identifier,
  item,
  onClose,
  installedIds,
  onInstall,
  busy,
}: {
  identifier: string;
  item: RegistrySkill | InstalledSkill | null;
  onClose: () => void;
  installedIds: Set<string>;
  onInstall: (s: RegistrySkill) => void;
  busy: string | null;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item || !isInstalledSkill(item)) {
      setBody(null);
      return;
    }
    setLoading(true);
    setBody(null);
    const u = new URL(
      `/api/pods/${identifier}/skills/inspect`,
      window.location.origin,
    );
    u.searchParams.set("category", item.category);
    u.searchParams.set("name", item.name);
    fetch(u.toString(), { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json()) as { body?: string; error?: string };
        if (r.ok && d.body) setBody(d.body);
        else setBody(`(${d.error ?? `HTTP ${r.status}`})`);
      })
      .catch((e) => setBody(`(${e instanceof Error ? e.message : String(e)})`))
      .finally(() => setLoading(false));
  }, [identifier, item]);

  const open = item !== null;
  const isInstalled = item ? installedIds.has(item.name.toLowerCase()) : false;

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={item?.name ?? ""}
      description={
        item
          ? isInstalledSkill(item)
            ? `category: ${item.category}`
            : `${item.source}${typeof item.installs === "number" ? ` · ${item.installs.toLocaleString()} installs` : ""}`
          : ""
      }
      footer={
        item && !isInstalledSkill(item) && !isInstalled ? (
          <Button
            variant="primary"
            size="md"
            loading={busy === item.identifier}
            onClick={() => onInstall(item)}
          >
            Install {item.name}
          </Button>
        ) : null
      }
    >
      {!item ? null : (
        <div className="space-y-3 text-[12px] text-[color:var(--text-secondary)]">
          <p>{item.description || "(no description)"}</p>
          {isInstalledSkill(item) ? (
            <>
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((t) => (
                    <span
                      key={t}
                      className="border border-[color:var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[color:var(--text-quaternary)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div>
                <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-[color:var(--text-tertiary)]">
                  SKILL.md
                </div>
                {loading ? (
                  <div className="flex items-center gap-2 text-[color:var(--text-tertiary)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading…
                  </div>
                ) : (
                  <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap border border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] p-3 font-mono text-[11px] leading-relaxed text-[color:var(--text-secondary)]">
                    {body}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-[color:var(--text-quaternary)]">id</dt>
                <dd className="break-all font-mono text-[color:var(--text-secondary)]">
                  {item.identifier}
                </dd>
                <dt className="text-[color:var(--text-quaternary)]">trust</dt>
                <dd className="text-[color:var(--text-secondary)]">
                  {item.trust}
                </dd>
                {item.detailUrl && (
                  <>
                    <dt className="text-[color:var(--text-quaternary)]">page</dt>
                    <dd>
                      <a
                        href={item.detailUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[color:var(--acc-blue)] hover:underline"
                      >
                        open <ExternalLink className="h-3 w-3" />
                      </a>
                    </dd>
                  </>
                )}
                {item.repoUrl && (
                  <>
                    <dt className="text-[color:var(--text-quaternary)]">repo</dt>
                    <dd>
                      <a
                        href={item.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[color:var(--acc-blue)] hover:underline"
                      >
                        github <ExternalLink className="h-3 w-3" />
                      </a>
                    </dd>
                  </>
                )}
              </dl>
              {item.tags && item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((t) => (
                    <span
                      key={t}
                      className="border border-[color:var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[color:var(--text-quaternary)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {isInstalled && (
                <div className="border border-[color:var(--acc-green)]/30 bg-[color:var(--acc-green-soft)] px-2.5 py-2 text-[11px] text-[color:var(--acc-green)]">
                  Already installed on this pod.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
