"use client";

// Rich WhatsApp connector card.
//
// Replaces the generic OAuthHandoffCard for the WhatsApp slug. Handles the
// whole lifecycle end-to-end from the dashboard, with no terminal needed:
//
//   not paired → mode picker → "Start pairing" → embedded xterm running
//                `hermes whatsapp` → user scans QR on their phone → polling
//                detects ~/.hermes/platforms/whatsapp/session was written →
//                we flip into settings view.
//
//   paired    → enabled toggle, mode switch, allowed users editor (chips),
//                unauthorized-DM behavior radio, reply prefix textarea,
//                debug toggle, Reset & re-pair (destructive).
//
// Every save calls POST /api/pods/<uuid>/whatsapp which restarts the gateway
// via the supervisor (non-blocking).
import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  ExternalLink,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Connector } from "@/lib/connectors";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea, Hint } from "@/components/ui/input";
import { BrandIcon, connectorBrand } from "@/components/brand-icon";
import { POD_SETTLING_NOTICE } from "@/lib/pod-settling";
import { WhatsAppPairingFlow } from "./WhatsAppPairing";

type Settings = {
  paired: boolean;
  enabled: boolean;
  mode: "bot" | "self-chat";
  allowAll: boolean;
  allowedUsers: string[];
  debug: boolean;
  unauthorizedDmBehavior: "pair" | "ignore";
  replyPrefix: string | null;
};

type ConnectorStatus = { configured: boolean; running: boolean };

const DEFAULT_PREFIX = "⚕ *Hermes Agent*\n──────\n";

export default function WhatsAppConnector({
  identifier,
  connector,
  status,
  disabled,
  onChange,
}: {
  identifier: string;
  connector: Connector;
  status?: ConnectorStatus;
  disabled?: boolean;
  onChange: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/pods/${identifier}/whatsapp`, {
        cache: "no-store",
      });
      const d = (await r.json()) as Settings & { error?: string };
      if (!r.ok) {
        setLoadErr(d.error ?? `HTTP ${r.status}`);
        return null;
      }
      setLoadErr(null);
      setSettings(d);
      return d;
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [identifier]);

  useEffect(() => {
    if (disabled) return;
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [disabled, refresh]);

  async function patch(
    field: string,
    body: Partial<Settings>,
    options?: { quietSuccess?: boolean },
  ) {
    setSavingField(field);
    try {
      const r = await fetch(`/api/pods/${identifier}/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: true;
        error?: string;
      };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `Save failed: HTTP ${r.status}`);
        return false;
      }
      if (!options?.quietSuccess) {
        toast.success("Saved — gateway restarting", {
          description: POD_SETTLING_NOTICE,
          duration: 8000,
        });
      }
      await refresh();
      onChange();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSavingField(null);
    }
  }

  const headerBadge = (() => {
    if (!settings) return <Badge tone="neutral">loading…</Badge>;
    if (settings.paired && settings.enabled && status?.running) {
      return (
        <Badge tone="green">
          <StatusDot tone="green" pulse /> live
        </Badge>
      );
    }
    if (settings.paired && settings.enabled) {
      return (
        <Badge tone="amber">
          <StatusDot tone="amber" /> paired · gateway idle
        </Badge>
      );
    }
    if (settings.paired) {
      return (
        <Badge tone="amber">
          <StatusDot tone="amber" /> paired · disabled
        </Badge>
      );
    }
    return (
      <Badge tone="purple">
        <StatusDot tone="purple" /> needs pairing
      </Badge>
    );
  })();

  return (
    <Card className="col-span-full overflow-hidden">
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center border border-[color:var(--border)] bg-[color:var(--bg-3)]">
            <BrandIcon slug={connectorBrand(connector.slug)} size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-[14px] font-semibold tracking-tight">
                {connector.label}
              </div>
              <a
                href="https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/whatsapp.md"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
              >
                docs <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">
              Baileys-based bridge — emulates a WhatsApp Web session. Pair from
              your phone&apos;s Linked Devices screen.
            </p>
          </div>
        </div>
        {headerBadge}
      </CardHeader>

      <CardBody className="space-y-5">
        {disabled ? (
          <p className="text-[12px] text-[color:var(--text-tertiary)]">
            Pod is still installing — pairing unlocks when the console is live.
          </p>
        ) : loadErr ? (
          <ErrorBox text={loadErr} />
        ) : !settings ? (
          <p className="text-[12px] text-[color:var(--text-tertiary)]">
            Loading WhatsApp settings…
          </p>
        ) : !settings.paired ? (
          <UnpairedWhatsAppSetup
            identifier={identifier}
            initialMode={settings.mode}
            onPatch={patch}
            onPaired={refresh}
          />
        ) : (
          <PairedSettingsForm
            identifier={identifier}
            settings={settings}
            savingField={savingField}
            onPatch={patch}
            onRefresh={refresh}
          />
        )}
      </CardBody>
    </Card>
  );
}

function UnpairedWhatsAppSetup({
  identifier,
  initialMode,
  onPatch,
  onPaired,
}: {
  identifier: string;
  initialMode: Settings["mode"];
  onPatch: (
    field: string,
    body: Partial<Settings>,
    options?: { quietSuccess?: boolean },
  ) => Promise<boolean>;
  onPaired: () => Promise<Settings | null>;
}) {
  const [mode, setMode] = useState<Settings["mode"]>(initialMode);

  return (
    <WhatsAppPairingFlow
      identifier={identifier}
      mode={mode}
      onModeChange={setMode}
      onBeforeStart={(chosenMode) =>
        onPatch("mode", { mode: chosenMode }, { quietSuccess: true })
      }
      onPaired={onPaired}
      onPairingComplete={async (chosenMode) => {
        const ok = await onPatch(
          "postPair",
          {
            enabled: true,
            mode: chosenMode,
          },
          { quietSuccess: true },
        );
        if (ok) toast.message(POD_SETTLING_NOTICE, { duration: 8000 });
      }}
    />
  );
}

// ---------------------------- paired settings ----------------------------

function PairedSettingsForm({
  identifier,
  settings,
  savingField,
  onPatch,
  onRefresh,
}: {
  identifier: string;
  settings: Settings;
  savingField: string | null;
  onPatch: (field: string, body: Partial<Settings>) => Promise<boolean>;
  onRefresh: () => Promise<Settings | null>;
}) {
  // Local drafts for inputs that don't make sense to autosave on each
  // keystroke (allowed-user chip input, reply prefix).
  const [chipDraft, setChipDraft] = useState("");
  const [prefixDraft, setPrefixDraft] = useState(
    settings.replyPrefix ?? DEFAULT_PREFIX,
  );
  const [prefixDirty, setPrefixDirty] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!prefixDirty) setPrefixDraft(settings.replyPrefix ?? DEFAULT_PREFIX);
  }, [settings.replyPrefix, prefixDirty]);

  async function addChip(raw: string) {
    const cleaned = raw.replace(/[^\d]/g, "");
    if (cleaned.length < 6) {
      toast.error("Enter the number in international format, e.g. 15551234567");
      return;
    }
    if (settings.allowedUsers.includes(cleaned)) return;
    await onPatch("allowedUsers", {
      allowAll: false,
      allowedUsers: [...settings.allowedUsers, cleaned],
    });
    setChipDraft("");
  }

  async function removeChip(n: string) {
    await onPatch("allowedUsers", {
      allowAll: false,
      allowedUsers: settings.allowedUsers.filter((x) => x !== n),
    });
  }

  async function unpair() {
    if (
      !confirm(
        "Unpair WhatsApp? The current session is wiped — you'll need to scan a new QR to reconnect.",
      )
    )
      return;
    setResetting(true);
    try {
      const r = await fetch(`/api/pods/${identifier}/whatsapp/session`, {
        method: "DELETE",
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: true;
        error?: string;
      };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `Reset failed: HTTP ${r.status}`);
        return;
      }
      toast.success("WhatsApp session wiped — ready to re-pair");
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2.5 border border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)]/40 px-3 py-2.5 text-[12px] text-[color:var(--text-primary)]">
        <Clock className="mt-0.5 h-3.5 w-3.5 flex-none text-[color:var(--acc-amber)]" />
        <div>
          <div className="font-medium">Wait about 5 minutes before testing.</div>
          <p className="mt-0.5 text-[11px] text-[color:var(--text-tertiary)]">
            {POD_SETTLING_NOTICE}
          </p>
        </div>
      </div>

      {/* --- top row: enabled + mode + debug -- */}
      <div className="grid gap-4 md:grid-cols-3">
        <Toggle
          label="Enabled"
          desc="Master switch. Gateway will ignore WhatsApp entirely when off."
          checked={settings.enabled}
          loading={savingField === "enabled"}
          onChange={(v) => onPatch("enabled", { enabled: v })}
        />
        <div className="space-y-1.5">
          <div className="text-[12px] font-medium text-[color:var(--text-primary)]">
            Mode
          </div>
          <div className="flex gap-1.5 border border-[color:var(--border)] bg-[color:var(--bg-1)] p-1">
            {(["bot", "self-chat"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => settings.mode !== m && onPatch("mode", { mode: m })}
                className={
                  "flex-1 px-2 py-1 text-[12px] transition-colors " +
                  (settings.mode === m
                    ? "bg-[color:var(--bg-3)] text-[color:var(--text-primary)]"
                    : "text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]")
                }
              >
                {m === "bot" ? "Bot number" : "Self-chat"}
              </button>
            ))}
          </div>
          <Hint>
            {settings.mode === "bot"
              ? "People message a dedicated bot number directly."
              : "You DM yourself to talk to the agent (single-user)."}
          </Hint>
        </div>
        <Toggle
          label="Debug logging"
          desc="Logs every raw bridge event to ~/.hermes/logs/bridge.log."
          checked={settings.debug}
          loading={savingField === "debug"}
          onChange={(v) => onPatch("debug", { debug: v })}
        />
      </div>

      {/* --- access control -- */}
      <section className="space-y-3 border border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-[color:var(--acc-green)]" />
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
            Who can talk to the bot
          </h4>
        </div>

        <Toggle
          label="Allow everyone"
          desc='Equivalent to WHATSAPP_ALLOWED_USERS="*". Useful for a public bot, dangerous for a personal number.'
          checked={settings.allowAll}
          loading={savingField === "allowedUsers"}
          onChange={(v) =>
            onPatch("allowedUsers", { allowAll: v, allowedUsers: [] })
          }
        />

        {!settings.allowAll && (
          <div className="space-y-2">
            <Field
              label="Allowed phone numbers"
              hint="International format, no + or spaces. e.g. 15551234567"
            >
              <div className="flex flex-wrap items-center gap-1.5 border border-[color:var(--border)] bg-[color:var(--bg-1)] p-2">
                {settings.allowedUsers.length === 0 && (
                  <span className="px-1 text-[11px] text-[color:var(--text-quaternary)]">
                    No senders allowed — bot will silently deny every incoming
                    message until you add one.
                  </span>
                )}
                {settings.allowedUsers.map((n) => (
                  <span
                    key={n}
                    className="inline-flex items-center gap-1 rounded-full border border-[color:var(--acc-green)]/30 bg-[color:var(--acc-green-soft)]/40 px-2 py-0.5 text-[11px] font-medium text-[color:var(--acc-green)]"
                  >
                    +{n}
                    <button
                      type="button"
                      onClick={() => removeChip(n)}
                      className="text-[color:var(--acc-green)]/70 hover:text-[color:var(--acc-red)]"
                      aria-label={`remove ${n}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={chipDraft}
                  onChange={(e) => setChipDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      if (chipDraft.trim()) addChip(chipDraft.trim());
                    } else if (
                      e.key === "Backspace" &&
                      chipDraft === "" &&
                      settings.allowedUsers.length > 0
                    ) {
                      const last = settings.allowedUsers.at(-1);
                      if (last) removeChip(last);
                    }
                  }}
                  placeholder={
                    settings.allowedUsers.length === 0
                      ? "15551234567"
                      : "+ add another"
                  }
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                  data-bwignore="true"
                  className="min-w-[160px] flex-1 bg-transparent text-[12px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-quaternary)] focus:outline-none"
                />
              </div>
            </Field>
          </div>
        )}

        <Field
          label="Behavior for unauthorized DMs"
          hint='With "pair" the bot replies with a pairing code; "ignore" stays silent (better for private bots).'
        >
          <div className="grid grid-cols-2 gap-2">
            {(["pair", "ignore"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() =>
                  settings.unauthorizedDmBehavior !== b &&
                  onPatch("unauthorizedDmBehavior", {
                    unauthorizedDmBehavior: b,
                  })
                }
                className={
                  "border p-2.5 text-left transition-colors " +
                  (settings.unauthorizedDmBehavior === b
                    ? "border-[color:var(--acc-blue)]/50 bg-[color:var(--acc-blue-soft)]/40"
                    : "border-[color:var(--border)] bg-[color:var(--bg-1)] hover:bg-[color:var(--bg-3)]")
                }
              >
                <div className="text-[12px] font-medium capitalize text-[color:var(--text-primary)]">
                  {b === "pair" ? "Reply with pairing code" : "Stay silent"}
                </div>
                <div className="mt-0.5 text-[11px] text-[color:var(--text-tertiary)]">
                  {b === "pair"
                    ? "Hermes default — good for public bots."
                    : "Recommended for a private number."}
                </div>
              </button>
            ))}
          </div>
        </Field>
      </section>

      {/* --- reply prefix -- */}
      <section className="space-y-2">
        <Field
          label="Reply prefix"
          hint='Prepended to every agent reply. Use "\n" for newlines. Leave empty to disable the header entirely.'
        >
          <Textarea
            value={prefixDraft}
            onChange={(e) => {
              setPrefixDraft(e.target.value);
              setPrefixDirty(true);
            }}
            rows={3}
            placeholder={DEFAULT_PREFIX}
            className="font-mono text-[12px]"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={!prefixDirty}
            loading={savingField === "replyPrefix"}
            onClick={async () => {
              const ok = await onPatch("replyPrefix", { replyPrefix: prefixDraft });
              if (ok) setPrefixDirty(false);
            }}
          >
            Save prefix
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!prefixDirty}
            onClick={() => {
              setPrefixDraft(settings.replyPrefix ?? DEFAULT_PREFIX);
              setPrefixDirty(false);
            }}
          >
            Reset
          </Button>
          {/* NOTE: there is deliberately no "Disable header" option. The
              prefix doubles as the bridge's self-chat echo-filter marker —
              an empty prefix makes the agent's own messages loop back as
              user input (this bricked a real pod). The API coerces "" to
              the hermes default for the same reason. */}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await onPatch("replyPrefix", { replyPrefix: null });
              setPrefixDraft(DEFAULT_PREFIX);
              setPrefixDirty(false);
            }}
          >
            <RotateCcw className="h-3 w-3" /> Use Hermes default
          </Button>
        </div>
      </section>

      {/* --- danger zone -- */}
      <section className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)]/30 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold text-[color:var(--acc-red)]">
              Unpair & re-pair
            </div>
            <p className="mt-0.5 text-[11px] text-[color:var(--text-tertiary)]">
              Wipes <code>~/.hermes/platforms/whatsapp/session</code>. The bot
              goes offline until a new QR is scanned. Useful if the phone was
              reset or WhatsApp unlinked the device.
            </p>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={unpair}
            loading={resetting}
          >
            <Trash2 className="h-3 w-3" /> Reset session
          </Button>
        </div>
      </section>
    </div>
  );
}

// --------------------------------- bits ---------------------------------

function Toggle({
  label,
  desc,
  checked,
  loading,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  loading?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-medium text-[color:var(--text-primary)]">
          {label}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          disabled={loading}
          className={
            "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors " +
            (checked
              ? "border-[color:var(--acc-green)]/50 bg-[color:var(--acc-green)]/30"
              : "border-[color:var(--border)] bg-[color:var(--bg-3)]") +
            (loading ? " opacity-60" : "")
          }
        >
          <span
            className={
              "inline-block h-3.5 w-3.5 transform rounded-full transition-transform " +
              (checked
                ? "translate-x-4 bg-[color:var(--acc-green)]"
                : "translate-x-0.5 bg-[color:var(--text-tertiary)]")
            }
          />
        </button>
      </div>
      {desc && <Hint>{desc}</Hint>}
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-2.5 py-2 text-[12px] text-[color:var(--acc-red)]">
      {text}
    </div>
  );
}
