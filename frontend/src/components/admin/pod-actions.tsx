"use client";

// Pod mutating actions — restart, stop, kill, reassign.

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, RotateCw, Square, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  uuid: string;
  slug: string;
  installed: boolean;
  suspended: boolean;
};

export function PodActions(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        icon={<Play className="h-3.5 w-3.5" />}
        label="Start"
        confirmTitle="Start pod?"
        confirmBody={`Start ${props.slug}.`}
        endpoint={`/api/admin/pods/${props.uuid}/power`}
        body={{ signal: "start" }}
      />
      <ActionButton
        icon={<RotateCw className="h-3.5 w-3.5" />}
        label="Restart"
        confirmTitle="Restart pod?"
        confirmBody={`Gracefully restart ${props.slug}. Active connections will drop.`}
        endpoint={`/api/admin/pods/${props.uuid}/power`}
        body={{ signal: "restart" }}
      />
      <ActionButton
        icon={<Square className="h-3.5 w-3.5" />}
        label="Stop"
        confirmTitle="Stop pod?"
        confirmBody={`Stop ${props.slug}. Container stays on disk; the user can restart it.`}
        endpoint={`/api/admin/pods/${props.uuid}/power`}
        body={{ signal: "stop" }}
      />
      <ActionButton
        variant="danger"
        icon={<X className="h-3.5 w-3.5" />}
        label="Kill"
        confirmTitle="Kill pod?"
        confirmBody={`Hard-kill ${props.slug} — SIGKILL the container. Use only if stop hangs.`}
        endpoint={`/api/admin/pods/${props.uuid}/power`}
        body={{ signal: "kill" }}
        danger
      />
      <ActionButton
        variant="danger"
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label="Delete pod"
        confirmTitle="Delete pod permanently?"
        confirmBody={`Remove ${props.slug} from Pelican AND wipe its domain. Type the slug below to confirm.`}
        endpoint={`/api/admin/pods/${props.uuid}/delete`}
        danger
        typeToConfirm={props.slug}
      />
    </div>
  );
}

function ActionButton({
  icon,
  label,
  confirmTitle,
  confirmBody,
  endpoint,
  body,
  danger,
  typeToConfirm,
  variant = "secondary",
}: {
  icon: React.ReactNode;
  label: string;
  confirmTitle: string;
  confirmBody: string;
  endpoint: string;
  body?: Record<string, unknown>;
  danger?: boolean;
  typeToConfirm?: string;
  variant?: "secondary" | "danger";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const canSubmit = !typeToConfirm || confirmText === typeToConfirm;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        toast.error(data.error ?? `${r.status} ${r.statusText}`);
      } else {
        toast.success(`${label} done`);
        setOpen(false);
        setConfirmText("");
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        {icon} {label}
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md border bg-[color:var(--bg-1)] shadow-2xl ${
              danger
                ? "border-[color:var(--acc-red)]/40"
                : "border-[color:var(--border-strong)]"
            }`}
          >
            <div className="border-b border-[color:var(--border-subtle)] px-5 py-4">
              <h3
                className={`text-[14px] font-semibold tracking-tight ${
                  danger ? "text-[color:var(--acc-red)]" : ""
                }`}
              >
                {confirmTitle}
              </h3>
              <p className="mt-1 text-[12px] tracking-tight text-[color:var(--text-tertiary)]">
                {confirmBody}
              </p>
            </div>
            {typeToConfirm && (
              <div className="px-5 py-4">
                <label className="flex flex-col gap-1 text-[11px] tracking-tight text-[color:var(--acc-red)]">
                  Type <span className="font-mono">{typeToConfirm}</span> to
                  confirm
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={typeToConfirm}
                    className="h-8 rounded-sm border border-[color:var(--acc-red)]/40 bg-[color:var(--bg-3)] px-2 text-[13px] text-[color:var(--text-primary)] outline-none focus:border-[color:var(--acc-red)]"
                  />
                </label>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-[color:var(--border-subtle)] px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant={danger ? "danger" : "primary"}
                size="sm"
                disabled={!canSubmit || busy}
                loading={busy}
                onClick={submit}
              >
                {label}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
