import { redirect } from "next/navigation";
import { Key, Lock, Mail, Monitor, Trash2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty";
import {
  avatarChar,
  isWalletEmail,
  shortHandle,
} from "@/lib/display-name";
import { LegacyWalletEmailForm } from "@/components/account/legacy-wallet-email-form";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-hairline pb-8">
        <span className="micro text-neutral-500">Settings · Account</span>
        <h1 className="display mt-3 text-[clamp(2rem,4vw,3rem)] leading-[0.95]">
          Account<span className="text-signal">.</span>
        </h1>
        <p className="mt-3 text-[13px] text-neutral-400">
          Manage your profile, sessions, and API keys.
        </p>
      </header>

      <div className="space-y-12 pt-10">
        {/* Profile */}
        <Panel
          index="01"
          title="Profile"
          description="How you appear across FuelBorn."
        >
          <div className="flex items-start gap-4 pb-5">
            <div
              className={
                "flex h-10 w-10 flex-none items-center justify-center border font-mono text-[14px] font-semibold " +
                (isWalletEmail(user.email)
                  ? "border-signal/30 bg-signal/10 text-signal"
                  : "border-hairline bg-neutral-950 text-foreground")
              }
            >
              {avatarChar(user.email)}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              {isWalletEmail(user.email) ? (
                <Field
                  label="Legacy wallet account"
                  hint="wallet sign-in has been retired"
                >
                  <Input
                    value={shortHandle(user.email)}
                    disabled
                    readOnly
                    className="font-mono"
                  />
                </Field>
              ) : (
                <Field label="Email" hint="primary identifier — non-editable for now">
                  <Input value={user.email} disabled readOnly />
                </Field>
              )}
              <Field label="Display name" hint="coming soon">
                <Input placeholder="Add a name" disabled />
              </Field>
              {isWalletEmail(user.email) ? <LegacyWalletEmailForm /> : null}
            </div>
          </div>
        </Panel>

        {/* API keys */}
        <Panel
          index="02"
          title="API keys"
          description="Programmatic access to your pods — deploy, exec, watch. Coming soon."
          aside={<MicroTag>soon</MicroTag>}
        >
          <EmptyState
            icon={<Key className="h-5 w-5" />}
            title="No API keys"
            description="The FuelBorn REST/CLI surface will let you script agent lifecycle once it's stable."
            action={
              <Button variant="secondary" size="sm" disabled>
                <Key className="h-3 w-3" /> Create API key
              </Button>
            }
          />
        </Panel>

        {/* Sessions */}
        <Panel
          index="03"
          title="Sessions"
          description="Browsers currently signed in."
        >
          <div className="border border-hairline bg-neutral-900">
            <SessionRow current device="This browser" lastSeen="just now" />
          </div>
        </Panel>

        {/* Email preferences */}
        <Panel
          index="04"
          title="Email preferences"
          description="What we email you about."
        >
          <div className="space-y-px border border-hairline bg-neutral-900">
            {[
              { label: "Pod deploy receipts", on: true },
              { label: "Connector pairing codes", on: true },
              { label: "Weekly usage digest", on: false },
              { label: "Product updates", on: false },
            ].map((p) => (
              <Toggle key={p.label} label={p.label} on={p.on} />
            ))}
          </div>
        </Panel>

        {/* Danger zone */}
        <Panel
          index="05"
          title="Danger zone"
          description="Irreversible actions. Use with care."
          tone="error"
        >
          <div className="space-y-px border border-error/30 bg-error/5">
            <DangerRow
              icon={<Lock className="h-3.5 w-3.5" />}
              label="Reset password"
              description="Sign out everywhere and email a reset link."
              action="Send reset"
            />
            <DangerRow
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Delete account"
              description="Permanently delete your pods, settings, and identity."
              action="Delete"
              destructive
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  index,
  title,
  description,
  aside,
  tone,
  children,
}: {
  index: string;
  title: string;
  description: string;
  aside?: React.ReactNode;
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] tabular text-neutral-600">{index}</span>
          <h2
            className={`text-[15px] font-semibold tracking-tight ${
              tone === "error" ? "text-error" : "text-foreground"
            }`}
          >
            {title}
          </h2>
        </div>
        {aside}
      </header>
      <p className="mt-2 text-[12px] text-neutral-400">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function MicroTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="border border-hairline bg-neutral-900 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
      {children}
    </span>
  );
}

function SessionRow({
  device,
  lastSeen,
  current,
}: {
  device: string;
  lastSeen: string;
  current?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3">
        <Monitor className="h-3.5 w-3.5 text-neutral-500" />
        <div>
          <div className="text-[13px] text-foreground">{device}</div>
          <div className="font-mono text-[11px] text-neutral-500">
            Last seen {lastSeen}
          </div>
        </div>
      </div>
      {current ? (
        <span className="inline-flex items-center gap-1.5 border border-live/30 bg-live/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-live">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-live" />
          current
        </span>
      ) : (
        <Button variant="ghost" size="sm">
          Revoke
        </Button>
      )}
    </div>
  );
}

function Toggle({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2.5 text-[13px] text-foreground">
        <Mail className="h-3 w-3 text-neutral-500" />
        {label}
      </div>
      <button
        type="button"
        aria-pressed={on}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
          on ? "bg-signal" : "bg-neutral-700"
        }`}
        disabled
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-neutral-950 transition-transform ${
            on ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function DangerRow({
  icon,
  label,
  description,
  action,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  action: string;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-neutral-400">{icon}</span>
        <div>
          <div className="text-[13px] font-medium text-foreground">{label}</div>
          <div className="text-[11px] text-neutral-400">{description}</div>
        </div>
      </div>
      <Button variant={destructive ? "danger" : "secondary"} size="sm" disabled>
        {action}
      </Button>
    </div>
  );
}
