"use client";

// PodActions — power + delete dropdown that lives in the pod page header.
//
// Renders a single button that opens a small menu:
//   Start • Stop • Restart • Kill (force) • — • Delete pod
//
// Power signals POST /api/pods/[uuid]/power and rely on the user's
// stored Pelican client token (same token the terminal WS uses).
//
// Delete opens a confirmation dialog requiring the user to type the
// pod name exactly — there's no undo (DELETE /api/pods/[uuid] forces
// Wings to tear down the container AND wipe the bind volume).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Play,
  Power,
  RotateCw,
  Square,
  Trash2,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PodsLoader } from "@/components/ui/pods-loader";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { POD_SETTLING_NOTICE } from "@/lib/pod-settling";

type Signal = "start" | "stop" | "restart" | "kill";

export default function PodActions({
  identifier,
  podName,
}: {
  identifier: string;
  podName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Signal | "delete" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function power(signal: Signal) {
    setBusy(signal);
    setOpen(false);
    try {
      const r = await fetch(`/api/pods/${identifier}/power`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: true;
        error?: string;
      };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `HTTP ${r.status}`);
        return;
      }
      // Pelican's power endpoint returns 204 immediately — the actual
      // state transition happens async, so we soft-refresh after a beat
      // so the header badge picks up the new container state.
      const verb = signalVerb(signal);
      toast.success(`${verb}…`, {
        description: signal === "stop" ? undefined : POD_SETTLING_NOTICE,
        duration: signal === "stop" ? 2000 : 8000,
      });
      setTimeout(() => router.refresh(), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="secondary"
        size="md"
        onClick={() => setOpen((v) => !v)}
        disabled={busy !== null}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Power className="h-3.5 w-3.5" />
        )}
        Actions
        <ChevronDown className="h-3 w-3 opacity-60" />
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 z-30 mt-1 w-56 overflow-hidden border border-[color:var(--border)] bg-[color:var(--bg-2)] shadow-[var(--shadow-pop)]"
          >
            <MenuItem
              icon={<Play className="h-3.5 w-3.5 text-[color:var(--acc-green)]" />}
              label="Start"
              onClick={() => power("start")}
              hint="Boot the container"
            />
            <MenuItem
              icon={<RotateCw className="h-3.5 w-3.5 text-[color:var(--acc-blue)]" />}
              label="Restart"
              onClick={() => power("restart")}
              hint="Graceful stop + start"
            />
            <MenuItem
              icon={<Square className="h-3.5 w-3.5 text-[color:var(--acc-amber)]" />}
              label="Stop"
              onClick={() => power("stop")}
              hint="SIGTERM, then SIGKILL after grace"
            />
            <MenuItem
              icon={<Zap className="h-3.5 w-3.5 text-[color:var(--acc-amber)]" />}
              label="Kill"
              onClick={() => power("kill")}
              hint="Force-kill — when stop hangs"
            />
            <div className="my-1 border-t border-[color:var(--border-subtle)]" />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5 text-[color:var(--acc-red)]" />}
              label="Delete pod"
              destructive
              onClick={() => {
                setOpen(false);
                setConfirmOpen(true);
              }}
              hint="Wipes container + volume — no undo"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <DeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        identifier={identifier}
        podName={podName}
        busy={busy === "delete"}
        onDeleting={() => setBusy("delete")}
        onDone={() => setBusy(null)}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  destructive,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors",
        "hover:bg-[color:var(--bg-3)]",
        destructive
          ? "text-[color:var(--acc-red)]"
          : "text-[color:var(--text-primary)]",
      )}
    >
      <span className="flex-none">{icon}</span>
      <span className="flex-1">
        <span className="block font-medium">{label}</span>
        {hint && (
          <span className="block text-[10px] text-[color:var(--text-quaternary)]">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

function signalVerb(s: Signal): string {
  switch (s) {
    case "start":
      return "Starting";
    case "stop":
      return "Stopping";
    case "restart":
      return "Restarting";
    case "kill":
      return "Killing";
  }
}

function DeleteDialog({
  open,
  onOpenChange,
  identifier,
  podName,
  busy,
  onDeleting,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  identifier: string;
  podName: string;
  busy: boolean;
  onDeleting: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const canConfirm = typed === podName && !busy;

  async function destroy() {
    if (!canConfirm) return;
    onDeleting();
    try {
      const r = await fetch(`/api/pods/${identifier}`, { method: "DELETE" });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: true;
        error?: string;
      };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `HTTP ${r.status}`);
        return;
      }
      toast.success(`Pod "${podName}" deleted`);
      onOpenChange(false);
      // Bounce out to the list — staying on a deleted pod's page would
      // hard-404 on the next data fetch anyway.
      router.push("/pods");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      onDone();
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => !busy && onOpenChange(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.15 }}
            className="absolute left-1/2 top-1/2 w-[420px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 border border-[color:var(--border)] bg-[color:var(--bg-1)] shadow-[var(--shadow-pop)]"
          >
            <div className="flex items-start gap-3 border-b border-[color:var(--border-subtle)] px-5 py-4">
              <div className="flex h-9 w-9 flex-none items-center justify-center border border-[color:var(--acc-red)]/40 bg-[color:var(--acc-red-soft)]/60">
                <AlertTriangle className="h-4 w-4 text-[color:var(--acc-red)]" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight text-[color:var(--text-primary)]">
                  Delete pod{" "}
                  <span className="font-mono text-[color:var(--acc-red)]">
                    {podName}
                  </span>
                  ?
                </h3>
                <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
                  This permanently wipes the container, the persistent volume
                  at <code className="font-mono">/home/container</code>{" "}
                  (everything you installed, every connector session, every
                  cron job), and the Pelican server record. There&apos;s no
                  recovery.
                </p>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              {busy && (
                <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)] px-4 py-5">
                  <PodsLoader
                    size="sm"
                    label="Deleting pod and persistent volume..."
                    className="mx-auto"
                  />
                </div>
              )}
              <label className="block text-[12px] text-[color:var(--text-secondary)]">
                To confirm, type the pod name{" "}
                <code className="bg-[color:var(--bg-3)] px-1 py-0.5 font-mono text-[11px]">
                  {podName}
                </code>{" "}
                below:
              </label>
              <Input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={podName}
                disabled={busy}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={destroy}
                disabled={!canConfirm}
                loading={busy}
              >
                <Trash2 className="h-3 w-3" /> Delete forever
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
