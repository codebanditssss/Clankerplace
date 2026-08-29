"use client";

// Client-side mutation buttons for a user detail page. Each opens a
// red-bordered confirmation modal asking for typed confirmation (for
// destructive ops) or a free-form reason (for grant-credit, suspend).
// Calls /api/admin/users/[id]/<action> and refreshes the route on
// success.

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  DollarSign,
  Mail,
  RotateCcw,
  Trash2,
  UserCog,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  userId: number;
  email: string;
  isSuspended: boolean;
  isAdmin: boolean;
  isVerified: boolean;
};

export function UserActions(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.isSuspended ? (
        <ActionButton
          variant="secondary"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Unsuspend"
          confirmTitle="Unsuspend user?"
          confirmBody={`Re-enable login for ${props.email}.`}
          endpoint={`/api/admin/users/${props.userId}/unsuspend`}
        />
      ) : (
        <ActionButton
          variant="secondary"
          icon={<Ban className="h-3.5 w-3.5" />}
          label="Suspend"
          confirmTitle="Suspend user?"
          confirmBody={`Block all logins for ${props.email}. Their pods will keep running unless you stop them separately.`}
          endpoint={`/api/admin/users/${props.userId}/suspend`}
          danger
          reasonRequired
        />
      )}
      <ActionButton
        icon={<DollarSign className="h-3.5 w-3.5" />}
        label="Adjust credits"
        confirmTitle="Adjust AI credits"
        confirmBody={`Adjust the Dodo AI-credit wallet for ${props.email}. Positive = credit, negative = debit. Capped at $500 per single adjustment.`}
        endpoint={`/api/admin/users/${props.userId}/credit`}
        amountInput
        reasonRequired
      />
      {!props.isVerified && (
        <ActionButton
          icon={<Mail className="h-3.5 w-3.5" />}
          label="Resend verification"
          confirmTitle="Resend verification email?"
          confirmBody={`Email a fresh OTP to ${props.email}.`}
          endpoint={`/api/admin/users/${props.userId}/resend-verification`}
        />
      )}
      <ActionButton
        icon={<RotateCcw className="h-3.5 w-3.5" />}
        label="Force password reset"
        confirmTitle="Send password reset email?"
        confirmBody={`Email ${props.email} a reset link. They'll be logged out next time they refresh.`}
        endpoint={`/api/admin/users/${props.userId}/force-reset`}
      />
      {props.email.endsWith("@wallet.pods.local") && (
        <ActionButton
          icon={<Mail className="h-3.5 w-3.5" />}
          label="Migrate wallet"
          confirmTitle="Migrate legacy wallet account?"
          confirmBody="Set a deliverable email on this legacy wallet-only account and send a password reset OTP."
          endpoint={`/api/admin/users/${props.userId}/migrate-wallet`}
          emailInput
        />
      )}
      <ActionButton
        icon={<UserCog className="h-3.5 w-3.5" />}
        label={props.isAdmin ? "Demote to user" : "Promote to admin"}
        confirmTitle={
          props.isAdmin ? "Demote this user?" : "Promote to admin?"
        }
        confirmBody={
          props.isAdmin
            ? `Remove admin role from ${props.email}.`
            : `Grant full admin access to ${props.email}. They'll be able to see the admin panel and run all admin actions.`
        }
        endpoint={`/api/admin/users/${props.userId}/role`}
        body={{ role: props.isAdmin ? "user" : "admin" }}
        danger={!props.isAdmin}
      />
      <ActionButton
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        label="Revoke sessions"
        confirmTitle="Revoke all sessions?"
        confirmBody={`Log ${props.email} out of every active session. They'll need to sign in again.`}
        endpoint={`/api/admin/users/${props.userId}/revoke-sessions`}
      />
      <ActionButton
        variant="danger"
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label="Delete"
        confirmTitle="Delete this user permanently?"
        confirmBody={`This will hard-delete ${props.email} and orphan their pods. Type the email below to confirm.`}
        endpoint={`/api/admin/users/${props.userId}/delete`}
        danger
        typeToConfirm={props.email}
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
  amountInput,
  emailInput,
  reasonRequired,
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
  amountInput?: boolean;
  emailInput?: boolean;
  reasonRequired?: boolean;
  typeToConfirm?: string;
  variant?: "secondary" | "danger";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const canSubmit = (() => {
    if (typeToConfirm && confirmText !== typeToConfirm) return false;
    if (amountInput) {
      const n = Number(amount);
      if (!Number.isFinite(n) || n === 0) return false;
    }
    if (emailInput && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return false;
    }
    if (reasonRequired && !reason.trim()) return false;
    return true;
  })();

  const submit = async () => {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { ...(body ?? {}) };
      if (reason.trim()) payload.reason = reason.trim();
      if (amountInput) payload.amount_cents = Math.round(Number(amount) * 100);
      if (emailInput) payload.email = email.trim();
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        toast.error(data.error ?? `${r.status} ${r.statusText}`);
      } else {
        toast.success(`${label} done`);
        setOpen(false);
        setReason("");
        setAmount("");
        setEmail("");
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
      <Button
        variant={variant}
        size="sm"
        onClick={() => setOpen(true)}
      >
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
            <div className="space-y-3 px-5 py-4">
              {amountInput && (
                <label className="flex flex-col gap-1 text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
                  Amount (USD, negative for debit)
                  <input
                    autoFocus
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="5.00"
                    className="h-8 rounded-sm border border-[color:var(--border-subtle)] bg-[color:var(--bg-3)] px-2 text-[13px] text-[color:var(--text-primary)] outline-none focus:border-[color:var(--border-strong)]"
                  />
                </label>
              )}
              {emailInput && (
                <label className="flex flex-col gap-1 text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
                  New email
                  <input
                    autoFocus
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="h-8 rounded-sm border border-[color:var(--border-subtle)] bg-[color:var(--bg-3)] px-2 text-[13px] text-[color:var(--text-primary)] outline-none focus:border-[color:var(--border-strong)]"
                  />
                </label>
              )}
              {reasonRequired && (
                <label className="flex flex-col gap-1 text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
                  Reason (logged to audit)
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. compensation for outage"
                    className="h-8 rounded-sm border border-[color:var(--border-subtle)] bg-[color:var(--bg-3)] px-2 text-[13px] text-[color:var(--text-primary)] outline-none focus:border-[color:var(--border-strong)]"
                  />
                </label>
              )}
              {typeToConfirm && (
                <label className="flex flex-col gap-1 text-[11px] tracking-tight text-[color:var(--acc-red)]">
                  Type{" "}
                  <span className="font-mono">{typeToConfirm}</span> to confirm
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={typeToConfirm}
                    className="h-8 rounded-sm border border-[color:var(--acc-red)]/40 bg-[color:var(--bg-3)] px-2 text-[13px] text-[color:var(--text-primary)] outline-none focus:border-[color:var(--acc-red)]"
                  />
                </label>
              )}
            </div>
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
