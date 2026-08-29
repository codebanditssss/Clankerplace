"use client";

// Pod file browser — list /home/container, open + edit text files, save back.
// Hidden files included (we expect users to want .env / .start.sh etc).
// Binary files render a placeholder with size + "use SFTP" hint, the
// frontend never proxies binary bytes through.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUp,
  ChevronRight,
  File as FileIcon,
  Folder,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Entry = {
  name: string;
  type: "dir" | "file" | "link";
  size: number;
  mtime: number;
  mode: string;
};

type ListResponse = {
  path: string;
  parent: string | null;
  entries: Entry[];
};

type FileResponse = {
  path: string;
  binary: boolean;
  size: number;
  truncated?: boolean;
  content: string | null;
  mime?: string;
};

export default function FilesTab({
  identifier,
  installed,
}: {
  identifier: string;
  installed: boolean;
}) {
  const [path, setPath] = useState("/home/container");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<FileResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/pods/${identifier}/fs/list?path=${encodeURIComponent(path)}`,
        { cache: "no-store" },
      );
      const d = (await r.json()) as ListResponse & { error?: string };
      if (!r.ok || d.error) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [identifier, path]);

  useEffect(() => {
    if (!installed) return;
    refresh();
  }, [installed, refresh]);

  async function openEntry(e: Entry) {
    if (e.type === "dir") {
      const next = path === "/" ? `/${e.name}` : `${path}/${e.name}`;
      setPath(next);
      setOpenFile(null);
      return;
    }
    const target = path === "/" ? `/${e.name}` : `${path}/${e.name}`;
    try {
      const r = await fetch(
        `/api/pods/${identifier}/fs/file?path=${encodeURIComponent(target)}`,
        { cache: "no-store" },
      );
      const d = (await r.json()) as FileResponse & { error?: string };
      if (!r.ok || d.error) {
        toast.error(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setOpenFile(d);
      setDraft(d.content ?? "");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveFile() {
    if (!openFile) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/pods/${identifier}/fs/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: openFile.path, content: draft }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!d.ok) {
        toast.error(d.error ?? "save failed");
        return;
      }
      toast.success(`Saved ${openFile.path}`);
      setOpenFile({ ...openFile, content: draft, size: draft.length });
      setEditing(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(e: Entry) {
    const full = path === "/" ? `/${e.name}` : `${path}/${e.name}`;
    if (!confirm(`Delete ${full}? This cannot be undone.`)) return;
    try {
      const r = await fetch(
        `/api/pods/${identifier}/fs/file?path=${encodeURIComponent(full)}`,
        { method: "DELETE" },
      );
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!d.ok) {
        toast.error(d.error ?? "delete failed");
        return;
      }
      toast.success(`Deleted ${e.name}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const crumbs = useMemo(() => {
    if (!path.startsWith("/home/container")) return [];
    const rel = path.slice("/home/container".length).split("/").filter(Boolean);
    const acc: { label: string; path: string }[] = [
      { label: "container", path: "/home/container" },
    ];
    let cur = "/home/container";
    for (const seg of rel) {
      cur = `${cur}/${seg}`;
      acc.push({ label: seg, path: cur });
    }
    return acc;
  }, [path]);

  if (!installed) {
    return (
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        Files unlock once the pod finishes installing.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      {/* Left: directory listing */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-1 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-3 py-2">
          {data?.parent && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPath(data.parent!)}
            >
              <ArrowUp className="h-3 w-3" />
            </Button>
          )}
          <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px]">
            {crumbs.map((c, i) => (
              <span key={c.path} className="inline-flex items-center">
                {i > 0 && (
                  <ChevronRight className="mx-0.5 h-3 w-3 flex-none text-[color:var(--text-quaternary)]" />
                )}
                <button
                  type="button"
                  onClick={() => setPath(c.path)}
                  className="font-mono text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={refresh}>
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </div>

        <ul className="max-h-[60vh] overflow-y-auto">
          {error && (
            <li className="px-3 py-2 text-[11px] text-[color:var(--acc-red)]">
              {error}
            </li>
          )}
          {!error && data?.entries.length === 0 && (
            <li className="px-3 py-3 text-[11px] text-[color:var(--text-quaternary)]">
              empty
            </li>
          )}
          {data?.entries.map((e) => {
            const isOpen =
              openFile &&
              openFile.path ===
                (path === "/" ? `/${e.name}` : `${path}/${e.name}`);
            return (
              <li
                key={e.name}
                className={`group flex items-center justify-between gap-2 border-b border-[color:var(--border-subtle)] px-3 py-1.5 text-[12px] last:border-b-0 hover:bg-[color:var(--bg-2)] ${
                  isOpen ? "bg-[color:var(--bg-2)]" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => openEntry(e)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {e.type === "dir" ? (
                    <Folder className="h-3.5 w-3.5 flex-none text-[color:var(--acc-blue)]" />
                  ) : (
                    <FileIcon className="h-3.5 w-3.5 flex-none text-[color:var(--text-tertiary)]" />
                  )}
                  <span className="truncate font-mono">
                    {e.name}
                    {e.type === "link" ? " →" : ""}
                  </span>
                </button>
                <span className="hidden text-[10px] text-[color:var(--text-quaternary)] tabular sm:inline">
                  {e.type === "dir" ? "" : prettyBytes(e.size)}
                </span>
                <button
                  type="button"
                  onClick={() => deleteEntry(e)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3 text-[color:var(--text-quaternary)] hover:text-[color:var(--acc-red)]" />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Right: file viewer / editor */}
      <Card className="overflow-hidden">
        {!openFile ? (
          <div className="flex h-full min-h-[300px] items-center justify-center px-6 py-12 text-center text-[12px] text-[color:var(--text-quaternary)]">
            Pick a file on the left to view or edit. Click a directory to
            descend.
          </div>
        ) : openFile.binary ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <FileIcon className="h-5 w-5 text-[color:var(--text-quaternary)]" />
            <p className="font-mono text-[11px] text-[color:var(--text-secondary)]">
              {openFile.path}
            </p>
            <p className="text-[11px] text-[color:var(--text-tertiary)]">
              Binary file ({prettyBytes(openFile.size)},{" "}
              {openFile.mime ?? "unknown"}). Open over SFTP for binary edits.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-3 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <FileIcon className="h-3.5 w-3.5 flex-none text-[color:var(--text-tertiary)]" />
                <span className="truncate font-mono text-[11px] text-[color:var(--text-secondary)]">
                  {openFile.path}
                </span>
                <span className="flex-none text-[10px] text-[color:var(--text-quaternary)]">
                  {prettyBytes(openFile.size)}
                  {openFile.truncated && " · truncated"}
                </span>
              </div>
              <div className="flex flex-none items-center gap-1.5">
                {editing ? (
                  <>
                    <Button size="sm" variant="primary" onClick={saveFile} loading={saving}>
                      <Save className="h-3 w-3" /> Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(false);
                        setDraft(openFile.content ?? "");
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                )}
              </div>
            </div>
            <textarea
              value={editing ? draft : (openFile.content ?? "")}
              onChange={(e) => setDraft(e.target.value)}
              readOnly={!editing}
              spellCheck={false}
              className="block max-h-[60vh] min-h-[400px] w-full resize-y border-0 bg-[color:var(--bg-1)] p-3 font-mono text-[11.5px] leading-relaxed text-[color:var(--text-primary)] focus:outline-none"
            />
          </>
        )}
      </Card>
    </div>
  );
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
