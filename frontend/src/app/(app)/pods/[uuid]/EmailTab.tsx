"use client";

// Email addon pane for a Hermes pod.
//
// Email is an *agent capability*, not a way for the user to chat with
// the agent. Every Hermes pod gets a real mailbox the agent uses to
// accomplish user-requested tasks: sign up for things, claim coupons,
// monitor automated mail, send confirmations, etc. This tab is the
// human-facing window into that mailbox — the user can read what
// landed there, manually send from it, and audit what the agent's
// been doing.
//
// Three sections:
//   1. Address card — the pod's <slug>@inbox.bigcat.pw with copy-to-clipboard.
//   2. Inbox table — newest-first list of received + sent messages. Auto-polls every 6 s.
//   3. Compose drawer — send a message from this address manually
//      (useful for testing or one-off correspondence; the agent uses
//      the same /email/send endpoint under the hood).

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Copy,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Hint } from "@/components/ui/input";

type Message = {
  id: number;
  direction: "in" | "out";
  from: string;
  to: string;
  subject: string;
  snippet: string;
  text: string | null;
  html: string | null;
  resend_email_id: string | null;
  in_reply_to: string | null;
  message_id: string | null;
  received_at: string | null;
  sent_at: string | null;
  error: string | null;
  created_at: string;
};

type Meta = {
  address: string | null;
  domain: string;
  rate_limit_per_hour: number;
};

export default function EmailTab({
  identifier,
  installed,
}: {
  identifier: string;
  installed: boolean;
}) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [open, setOpen] = useState<Message | null>(null);
  const [compose, setCompose] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchMeta = useCallback(async () => {
    try {
      const r = await fetch(`/api/pods/${identifier}/email/send`, {
        cache: "no-store",
      });
      if (r.ok) setMeta((await r.json()) as Meta);
    } catch {}
  }, [identifier]);

  const fetchMessages = useCallback(async () => {
    try {
      const r = await fetch(`/api/pods/${identifier}/email/messages?limit=50`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const d = (await r.json()) as { messages: Message[] };
      setMessages(d.messages);
    } catch {
      /* keep prior data on network blip */
    }
  }, [identifier]);

  useEffect(() => {
    if (!installed) return;
    fetchMeta();
    fetchMessages();
    const t = setInterval(fetchMessages, 6_000);
    return () => clearInterval(t);
  }, [installed, fetchMeta, fetchMessages]);

  async function copyAddress() {
    if (!meta?.address) return;
    try {
      await navigator.clipboard.writeText(meta.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  if (!installed) {
    return (
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        Email unlocks once the pod finishes installing.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <AddressCard meta={meta} copied={copied} onCopy={copyAddress} onSend={() => setCompose(true)} onRefresh={fetchMessages} />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-4 py-2.5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            <Inbox className="h-3.5 w-3.5" /> Mailbox
            {messages !== null && (
              <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--bg-3)] px-1.5 text-[10px] text-[color:var(--text-secondary)]">
                {messages.length}
              </span>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={fetchMessages}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        {messages === null ? (
          <p className="px-4 py-6 text-[11.5px] text-[color:var(--text-tertiary)]">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading…
          </p>
        ) : messages.length === 0 ? (
          <EmptyState address={meta?.address} />
        ) : (
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {messages.map((m) => (
              <li
                key={m.id}
                className="cursor-pointer px-4 py-2.5 hover:bg-[color:var(--bg-2)]"
                onClick={() => setOpen(m)}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <DirectionPill dir={m.direction} />
                    <span className="truncate font-mono text-[11.5px] text-[color:var(--text-secondary)]">
                      {m.direction === "in" ? m.from : m.to}
                    </span>
                  </div>
                  <span className="flex-none text-[10px] text-[color:var(--text-quaternary)]">
                    {timeAgo(m.created_at)}
                  </span>
                </div>
                <div className="mt-1 truncate text-[13px] font-medium text-[color:var(--text-primary)]">
                  {m.subject || "(no subject)"}
                </div>
                {m.snippet && (
                  <p className="mt-0.5 line-clamp-1 text-[11.5px] text-[color:var(--text-tertiary)]">
                    {m.snippet}
                  </p>
                )}
                {m.error && (
                  <p className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-[color:var(--acc-red)]">
                    <AlertTriangle className="h-3 w-3" /> send failed: {m.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && (
        <MessageDrawer
          msg={open}
          onClose={() => setOpen(null)}
          onReply={(prefill) => {
            setOpen(null);
            setCompose(true);
            // Pre-fill via window event — Compose listens for it on mount.
            window.dispatchEvent(
              new CustomEvent("pods:email-prefill", { detail: prefill }),
            );
          }}
        />
      )}
      {compose && meta?.address && (
        <ComposeDrawer
          identifier={identifier}
          from={meta.address}
          onClose={() => setCompose(false)}
          onSent={() => {
            setCompose(false);
            fetchMessages();
          }}
        />
      )}
    </div>
  );
}

function AddressCard({
  meta,
  copied,
  onCopy,
  onSend,
  onRefresh,
}: {
  meta: Meta | null;
  copied: boolean;
  onCopy: () => void;
  onSend: () => void;
  onRefresh: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            <Mail className="h-3 w-3" /> Pod address
          </div>
          {meta?.address ? (
            <div className="mt-1.5 flex items-center gap-2">
              <code className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 font-mono text-[13px] text-[color:var(--text-primary)]">
                {meta.address}
              </code>
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-3)] px-2 py-1.5 text-[11px] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]"
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
          ) : (
            <p className="mt-1.5 text-[12px] text-[color:var(--text-tertiary)]">
              Allocating address — give it a few seconds after deploy.
            </p>
          )}
          <p className="mt-2 text-[11.5px] leading-relaxed text-[color:var(--text-tertiary)]">
            A real mailbox your agent uses for user-asked tasks — signups,
            confirmations, monitoring automated mail, replying on your
            behalf. Send-limit {meta?.rate_limit_per_hour ?? 100}/hr.
            Inbound is delivered to the agent's gateway via webhook.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="primary" onClick={onSend} disabled={!meta?.address}>
            <Send className="h-3 w-3" /> Send test
          </Button>
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EmptyState({ address }: { address: string | null | undefined }) {
  return (
    <div className="px-6 py-10 text-center">
      <Mail className="mx-auto h-5 w-5 text-[color:var(--text-quaternary)]" />
      <p className="mt-2 text-[13px] font-medium text-[color:var(--text-secondary)]">
        Mailbox is empty
      </p>
      <p className="mt-1 text-[11.5px] text-[color:var(--text-tertiary)]">
        Send a message to{" "}
        <code className="rounded bg-[color:var(--bg-3)] px-1 py-0.5 font-mono text-[10.5px]">
          {address ?? "your pod address"}
        </code>{" "}
        from any inbox and it'll appear here within ~5 s.
      </p>
    </div>
  );
}

function DirectionPill({ dir }: { dir: "in" | "out" }) {
  if (dir === "in") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-[color:var(--acc-blue)]/30 bg-[color:var(--acc-blue-soft)]/40 px-1.5 text-[9px] uppercase tracking-wider text-[color:var(--acc-blue)]">
        in
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-[color:var(--acc-green)]/30 bg-[color:var(--acc-green-soft)]/40 px-1.5 text-[9px] uppercase tracking-wider text-[color:var(--acc-green)]">
      out
    </span>
  );
}

function MessageDrawer({
  msg,
  onClose,
  onReply,
}: {
  msg: Message;
  onClose: () => void;
  onReply: (prefill: {
    to: string;
    subject: string;
    in_reply_to: string | null;
  }) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose}>
      <div
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-[color:var(--border)] bg-[color:var(--bg-1)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
              {msg.direction === "in" ? "Received" : "Sent"} ·{" "}
              {new Date(msg.created_at).toLocaleString()}
            </div>
            <h3 className="mt-1 truncate text-[15px] font-semibold tracking-tight">
              {msg.subject || "(no subject)"}
            </h3>
            <div className="mt-1 truncate font-mono text-[11.5px] text-[color:var(--text-tertiary)]">
              {msg.direction === "in" ? `from ${msg.from}` : `to ${msg.to}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {msg.html ? (
            <iframe
              srcDoc={msg.html}
              sandbox=""
              className="h-[60vh] w-full rounded-md border border-[color:var(--border)] bg-white"
            />
          ) : msg.text ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[color:var(--text-primary)]">
              {msg.text}
            </pre>
          ) : (
            <p className="text-[12px] text-[color:var(--text-tertiary)]">
              No body — body fetch from Resend may have failed; retry by sending a new test.
            </p>
          )}
        </div>
        {msg.direction === "in" && (
          <footer className="flex justify-end gap-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-5 py-3">
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                onReply({
                  to: msg.from,
                  subject: msg.subject.match(/^Re:/i)
                    ? msg.subject
                    : `Re: ${msg.subject || ""}`,
                  in_reply_to: msg.message_id,
                })
              }
            >
              <Send className="h-3 w-3" /> Reply
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}

function ComposeDrawer({
  identifier,
  from,
  onClose,
  onSent,
}: {
  identifier: string;
  from: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [inReplyTo, setInReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    function onPrefill(e: Event) {
      const det = (e as CustomEvent).detail as {
        to: string;
        subject: string;
        in_reply_to: string | null;
      };
      setTo(det.to);
      setSubject(det.subject);
      setInReplyTo(det.in_reply_to);
    }
    window.addEventListener("pods:email-prefill", onPrefill);
    return () => window.removeEventListener("pods:email-prefill", onPrefill);
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const r = await fetch(`/api/pods/${identifier}/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject,
          text,
          in_reply_to: inReplyTo ?? undefined,
        }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!d.ok) {
        toast.error(d.error ?? "send failed");
        return;
      }
      toast.success(`Sent to ${to}`);
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose}>
      <form
        onSubmit={send}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-[color:var(--border)] bg-[color:var(--bg-1)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-5 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
              Compose · from {from}
            </div>
            <h3 className="mt-1 text-[15px] font-semibold tracking-tight">
              {inReplyTo ? "Reply" : "New message"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <Field label="To">
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="someone@example.com"
              required
              autoComplete="off"
            />
          </Field>
          <Field label="Subject">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Hi from your pod"
              autoComplete="off"
            />
          </Field>
          <Field label="Body">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Plain text body. The agent can also send HTML via the API."
              rows={10}
              required
              className="block w-full resize-y rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)] p-2.5 font-mono text-[12.5px] leading-relaxed text-[color:var(--text-primary)] focus:border-[color:var(--border-strong)] focus:outline-none"
            />
          </Field>
          {inReplyTo && (
            <p className="text-[11px] text-[color:var(--text-tertiary)]">
              Will thread as a reply to{" "}
              <code className="font-mono text-[10.5px]">{inReplyTo}</code>
            </p>
          )}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-2)] px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!to.trim() || !text.trim()}
            loading={sending}
          >
            {sending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}{" "}
            Send
          </Button>
        </footer>
      </form>
    </div>
  );
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
