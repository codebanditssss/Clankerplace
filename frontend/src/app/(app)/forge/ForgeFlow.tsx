"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDot,
  Cpu,
  ExternalLink,
  Flame,
  Fuel,
  Orbit,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  buildRegisterAgentTransaction,
  chainIdHex,
  ignitionStage,
  quoteForgeDeposit,
  type ForgeTransactionRequest,
} from "@/lib/forge-client";
import { cn } from "@/lib/cn";

type Screen = "identity" | "fuel" | "ignition";

type ForgeAttempt = {
  id: string;
  agent_id: string;
  status: string;
  metadata_hash: string;
  owner_wallet: string;
  deposit_wei: string;
  tx_hash: string | null;
  token_id: string | null;
  pod_uuid_short: string | null;
  last_error: string | null;
};

type PreparedForge = {
  attempt: ForgeAttempt;
  transaction: ForgeTransactionRequest;
};

type PendingForge = {
  attemptId: string;
  txHash: string;
  name: string;
  mon?: string;
  model?: (typeof MODELS)[number]["id"];
};

type EvmProvider = {
  request<T = unknown>(args: {
    method: string;
    params?: unknown[];
  }): Promise<T>;
};

const PENDING_KEY = "fuelborn:pending-forge";
const MONAD_TESTNET_RPC = "https://testnet-rpc.monad.xyz";
const MONAD_TESTNET_EXPLORER = "https://testnet.monadvision.com";

const MODELS = [
  {
    id: "glm-5.2",
    name: "GLM 5.2",
    note: "Balanced reasoning and tool use",
    recommended: true,
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    note: "Best for building and debugging",
  },
  {
    id: "mimo-v2.5",
    name: "MiMo V2.5",
    note: "Fast, efficient daily operator",
  },
] as const;

const FUEL_PRESETS = ["0.1", "0.5", "1"] as const;

const IGNITION_STEPS = [
  {
    title: "Identity anchored",
    detail: "AgentRegistered verified on Monad",
    icon: Orbit,
  },
  {
    title: "Pod allocated",
    detail: "Wings received the Hermes runtime",
    icon: Cpu,
  },
  {
    title: "FUEL loaded",
    detail: "Your MON deposit became runtime credit",
    icon: Fuel,
  },
  {
    title: "Ignition ready",
    detail: "Control Room handoff is unlocked",
    icon: Zap,
  },
] as const;

export function ForgeFlow() {
  const router = useRouter();
  const cancelled = React.useRef(false);
  const resumeStarted = React.useRef(false);
  const [screen, setScreen] = React.useState<Screen>("identity");
  const [name, setName] = React.useState("");
  const [mission, setMission] = React.useState("");
  const [personality, setPersonality] = React.useState("");
  const [model, setModel] = React.useState<(typeof MODELS)[number]["id"]>(
    "glm-5.2",
  );
  const [mon, setMon] = React.useState("0.1");
  const [wallet, setWallet] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState<ForgeAttempt | null>(null);
  const [pendingAttemptId, setPendingAttemptId] = React.useState<string | null>(
    null,
  );
  const [txHash, setTxHash] = React.useState<string | null>(null);
  const [confirmations, setConfirmations] = React.useState<string | null>(null);
  const [ignitionIndex, setIgnitionIndex] = React.useState(-1);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const quote = React.useMemo(() => {
    try {
      return quoteForgeDeposit(mon);
    } catch {
      return null;
    }
  }, [mon]);

  React.useEffect(() => {
    cancelled.current = false;
    if (!resumeStarted.current) {
      resumeStarted.current = true;
      const raw = window.sessionStorage.getItem(PENDING_KEY);
      if (raw) {
        try {
          const pending = JSON.parse(raw) as PendingForge;
          if (pending.attemptId && pending.txHash) {
            setName(pending.name || "Your agent");
            if (pending.mon) setMon(pending.mon);
            if (pending.model && MODELS.some((choice) => choice.id === pending.model)) {
              setModel(pending.model);
            }
            setPendingAttemptId(pending.attemptId);
            setTxHash(pending.txHash);
            setScreen("ignition");
            void pollForge(pending.attemptId, pending.txHash, true);
          }
        } catch {
          window.sessionStorage.removeItem(PENDING_KEY);
        }
      }
    }
    return () => {
      cancelled.current = true;
    };
  }, []);

  function continueToFuel() {
    setError(null);
    if (!name.trim() || !mission.trim() || !personality.trim()) {
      setError("Give your agent a name, mission, and personality first.");
      return;
    }
    if (name.trim().length > 40) {
      setError("Agent name must be 40 characters or fewer.");
      return;
    }
    setScreen("fuel");
  }

  async function forgeAgent() {
    setError(null);
    if (!quote) {
      setError("Enter a valid MON amount.");
      return;
    }
    const provider = getProvider();
    if (!provider) {
      setError("Install or open an EVM wallet, then try again.");
      return;
    }

    setWorking(true);
    try {
      const accounts = await provider.request<string[]>({
        method: "eth_requestAccounts",
      });
      const owner = accounts[0];
      if (!owner) throw new Error("No wallet account was selected.");
      setWallet(owner);

      const prepared = await postJson<PreparedForge>("/api/forge", {
        idempotency_key: crypto.randomUUID(),
        name: name.trim(),
        mission: mission.trim(),
        personality: personality.trim(),
        model,
        owner_wallet: owner,
        deposit_wei: quote.wei.toString(10),
      });

      await switchToForgeChain(provider, prepared.transaction.chainId);
      const transaction = buildRegisterAgentTransaction({
        from: owner,
        request: prepared.transaction,
      });
      const hash = await provider.request<string>({
        method: "eth_sendTransaction",
        params: [transaction],
      });

      setAttempt(prepared.attempt);
      setPendingAttemptId(prepared.attempt.id);
      setTxHash(hash);
      setScreen("ignition");
      window.sessionStorage.setItem(
        PENDING_KEY,
        JSON.stringify({
          attemptId: prepared.attempt.id,
          txHash: hash,
          name: name.trim(),
          mon,
          model,
        } satisfies PendingForge),
      );
      await pollForge(prepared.attempt.id, hash, true);
    } catch (cause) {
      setError(readableWalletError(cause));
      setWorking(false);
    }
  }

  async function pollForge(
    attemptId: string,
    submittedHash: string,
    includeHash: boolean,
  ) {
    setWorking(true);
    setError(null);
    let firstRequest = includeHash;

    while (!cancelled.current) {
      try {
        const response = await fetch("/api/forge/" + attemptId, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(firstRequest ? { tx_hash: submittedHash } : {}),
        });
        firstRequest = false;

        if (response.status === 409) {
          const body = (await response.json()) as {
            confirmations_remaining?: string | null;
          };
          setConfirmations(body.confirmations_remaining ?? null);
          await delay(2_000);
          continue;
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            message?: string;
            error?: string;
          } | null;
          throw new Error(
            body?.message || body?.error || "Forge could not advance.",
          );
        }

        const body = (await response.json()) as {
          attempt: ForgeAttempt;
          confirmations_remaining: string | null;
        };
        setAttempt(body.attempt);
        setConfirmations(body.confirmations_remaining);
        const stage = ignitionStage(body.attempt.status);

        if (body.attempt.status === "active") {
          for (let index = 0; index < IGNITION_STEPS.length; index += 1) {
            if (cancelled.current) return;
            setIgnitionIndex(index);
            await delay(420);
          }
          setWorking(false);
          return;
        }

        setIgnitionIndex(stage.index);
        await delay(1_200);
      } catch (cause) {
        setError(readableWalletError(cause));
        setWorking(false);
        return;
      }
    }
  }

  function openControlRoom() {
    if (attempt?.pod_uuid_short) {
      window.sessionStorage.removeItem(PENDING_KEY);
      router.push("/pods/" + attempt.pod_uuid_short);
    }
  }

  return (
    <div className="relative min-h-full overflow-hidden bg-[color:var(--bg-pure)]">
      <div className="pointer-events-none absolute inset-0 grid-paper opacity-35" />
      <div className="pointer-events-none absolute -right-32 -top-40 h-[420px] w-[420px] rounded-full bg-[color:var(--signal)]/10 blur-[110px]" />

      <div className="relative mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
        <ForgeHeader screen={screen} />

        {screen === "identity" && (
          <IdentityStep
            name={name}
            mission={mission}
            personality={personality}
            error={error}
            onName={setName}
            onMission={setMission}
            onPersonality={setPersonality}
            onContinue={continueToFuel}
          />
        )}

        {screen === "fuel" && (
          <FuelStep
            name={name}
            model={model}
            mon={mon}
            wallet={wallet}
            quote={quote}
            working={working}
            error={error}
            onModel={setModel}
            onMon={setMon}
            onBack={() => {
              setError(null);
              setScreen("identity");
            }}
            onForge={forgeAgent}
          />
        )}

        {screen === "ignition" && (
          <IgnitionStep
            name={name}
            model={model}
            wallet={wallet ?? attempt?.owner_wallet ?? null}
            quote={quote}
            attempt={attempt}
            txHash={txHash}
            confirmations={confirmations}
            activeIndex={ignitionIndex}
            working={working}
            error={error}
            onRetry={() => {
              if (pendingAttemptId && txHash) {
                void pollForge(pendingAttemptId, txHash, true);
              }
            }}
            onOpen={openControlRoom}
          />
        )}
      </div>
    </div>
  );
}

function ForgeHeader({ screen }: { screen: Screen }) {
  const current = screen === "identity" ? 1 : screen === "fuel" ? 2 : 3;

  return (
    <header className="mb-10 flex flex-col gap-6 border-b border-[color:var(--border)] pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="micro mb-3 flex items-center gap-2 text-[color:var(--signal)]">
          <Flame className="h-3.5 w-3.5" />
          FuelBorn Forge / Monad
        </div>
        <h1 className="display max-w-3xl text-4xl leading-[0.95] text-[color:var(--text-primary)] sm:text-5xl lg:text-6xl">
          Give an agent a life worth{" "}
          <span className="text-[color:var(--signal)]">earning.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:var(--text-tertiary)]">
          Define its purpose, anchor its birth on Monad, and launch a private
          Hermes pod with its own FUEL economy.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2" aria-label="Forge progress">
        {["Identity", "Fuel", "Ignition"].map((label, index) => {
          const number = index + 1;
          const selected = number === current;
          const complete = number < current;
          return (
            <React.Fragment key={label}>
              {index > 0 && (
                <div
                  className={cn(
                    "h-px w-5",
                    complete || selected
                      ? "bg-[color:var(--signal)]"
                      : "bg-[color:var(--border-strong)]",
                  )}
                />
              )}
              <div
                className={cn(
                  "flex h-8 items-center gap-2 border px-2.5 text-[11px] font-medium uppercase tracking-[0.12em]",
                  selected
                    ? "border-[color:var(--signal)] bg-[color:var(--signal)]/10 text-[color:var(--signal)]"
                    : complete
                      ? "border-[color:var(--border-strong)] text-[color:var(--text-secondary)]"
                      : "border-[color:var(--border)] text-[color:var(--text-quaternary)]",
                )}
              >
                {complete ? <Check className="h-3 w-3" /> : number}
                <span className="hidden sm:inline">{label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </header>
  );
}

function IdentityStep({
  name,
  mission,
  personality,
  error,
  onName,
  onMission,
  onPersonality,
  onContinue,
}: {
  name: string;
  mission: string;
  personality: string;
  error: string | null;
  onName: (value: string) => void;
  onMission: (value: string) => void;
  onPersonality: (value: string) => void;
  onContinue: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]"
    >
      <section className="border border-[color:var(--border)] bg-[color:var(--bg-1)]/90">
        <div className="border-b border-[color:var(--border)] px-5 py-4 sm:px-7">
          <p className="micro text-[color:var(--text-quaternary)]">
            01 / Define the operator
          </p>
          <h2 className="display mt-2 text-2xl text-[color:var(--text-primary)]">
            Who wakes up?
          </h2>
        </div>

        <div className="space-y-6 p-5 sm:p-7">
          <Field label="Agent name" hint="1–40 characters">
            <Input
              value={name}
              maxLength={40}
              placeholder="e.g. Nightshift"
              onChange={(event) => onName(event.target.value)}
              className="h-11"
            />
          </Field>

          <Field label="Mission" hint="the outcome it owns">
            <Textarea
              value={mission}
              maxLength={1000}
              placeholder="Monitor our launch channels, find unanswered questions, and prepare a daily operator brief."
              onChange={(event) => onMission(event.target.value)}
              className="min-h-28 resize-y"
            />
          </Field>

          <Field label="Personality" hint="how it thinks and speaks">
            <Textarea
              value={personality}
              maxLength={1000}
              placeholder="Calm, direct, curious. Challenges weak assumptions and never pretends certainty."
              onChange={(event) => onPersonality(event.target.value)}
              className="min-h-28 resize-y"
            />
          </Field>

          {error && <InlineError message={error} />}

          <div className="flex justify-end border-t border-[color:var(--border)] pt-5">
            <Button variant="signal" size="lg" onClick={onContinue}>
              Choose its fuel
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <PreviewCard name={name} mission={mission} />
        <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)] p-5">
          <p className="micro text-[color:var(--text-quaternary)]">
            Runtime species
          </p>
          <div className="mt-4 flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center border border-[color:var(--signal)]/40 bg-[color:var(--signal)]/10">
              <Sparkles className="h-5 w-5 text-[color:var(--signal)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[color:var(--text-primary)]">
                Hermes Clanker
              </p>
              <p className="mt-1 text-xs leading-5 text-[color:var(--text-tertiary)]">
                Autonomous, tool-capable, persistent, and isolated inside its
                own pod.
              </p>
            </div>
          </div>
        </div>
      </aside>
    </motion.div>
  );
}

function PreviewCard({ name, mission }: { name: string; mission: string }) {
  return (
    <div className="relative overflow-hidden border border-[color:var(--border)] bg-[color:var(--bg-2)] p-5">
      <div className="absolute right-0 top-0 h-20 w-20 bg-[color:var(--signal)]/10 blur-3xl" />
      <div className="relative flex items-center justify-between">
        <p className="micro text-[color:var(--text-quaternary)]">Identity preview</p>
        <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--signal)]" />
      </div>
      <div className="relative mt-9">
        <div className="mb-4 flex h-14 w-14 items-center justify-center border border-[color:var(--signal)] bg-[color:var(--signal)]/10">
          <Flame className="h-6 w-6 text-[color:var(--signal)]" />
        </div>
        <p className="display text-2xl text-[color:var(--text-primary)]">
          {name.trim() || "Unnamed agent"}
        </p>
        <p className="mt-3 line-clamp-4 min-h-20 text-xs leading-5 text-[color:var(--text-tertiary)]">
          {mission.trim() || "Its mission will appear here once defined."}
        </p>
      </div>
      <div className="relative mt-6 flex items-center justify-between border-t border-[color:var(--border)] pt-4">
        <span className="micro text-[color:var(--text-quaternary)]">State</span>
        <span className="font-mono text-[11px] text-[color:var(--signal)]">
          UNBORN
        </span>
      </div>
    </div>
  );
}

function FuelStep({
  name,
  model,
  mon,
  wallet,
  quote,
  working,
  error,
  onModel,
  onMon,
  onBack,
  onForge,
}: {
  name: string;
  model: (typeof MODELS)[number]["id"];
  mon: string;
  wallet: string | null;
  quote: ReturnType<typeof quoteForgeDeposit> | null;
  working: boolean;
  error: string | null;
  onModel: (value: (typeof MODELS)[number]["id"]) => void;
  onMon: (value: string) => void;
  onBack: () => void;
  onForge: () => void;
}) {
  const lifetime = quote ? formatLifetime(quote.idleLifetimeSeconds) : "—";
  const tankPercent = quote
    ? Math.min(100, Number(quote.fuelMicro / BigInt(1_000_000)))
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      <section className="border border-[color:var(--border)] bg-[color:var(--bg-1)]/90">
        <div className="border-b border-[color:var(--border)] px-5 py-4 sm:px-7">
          <p className="micro text-[color:var(--text-quaternary)]">
            02 / Choose the mind and runway
          </p>
          <h2 className="display mt-2 text-2xl text-[color:var(--text-primary)]">
            What powers {name}?
          </h2>
        </div>

        <div className="space-y-8 p-5 sm:p-7">
          <div>
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-xs font-medium text-[color:var(--text-primary)]">
                  Managed intelligence
                </p>
                <p className="mt-1 text-[11px] text-[color:var(--text-quaternary)]">
                  No API key required from you
                </p>
              </div>
              <span className="micro text-[color:var(--acc-green)]">Hosted</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODELS.map((choice) => {
                const selected = model === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => onModel(choice.id)}
                    className={cn(
                      "relative min-h-28 border p-4 text-left transition-colors",
                      selected
                        ? "border-[color:var(--signal)] bg-[color:var(--signal)]/8"
                        : "border-[color:var(--border)] bg-[color:var(--bg-2)] hover:border-[color:var(--border-strong)]",
                    )}
                  >
                    {"recommended" in choice && choice.recommended && (
                      <span className="micro absolute right-2 top-2 text-[color:var(--signal)]">
                        Pick
                      </span>
                    )}
                    <CircleDot
                      className={cn(
                        "mb-5 h-4 w-4",
                        selected
                          ? "text-[color:var(--signal)]"
                          : "text-[color:var(--text-quaternary)]",
                      )}
                    />
                    <p className="text-xs font-medium text-[color:var(--text-primary)]">
                      {choice.name}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-4 text-[color:var(--text-tertiary)]">
                      {choice.note}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-3">
              <p className="text-xs font-medium text-[color:var(--text-primary)]">
                Starting fuel
              </p>
              <p className="mt-1 text-[11px] text-[color:var(--text-quaternary)]">
                MON stays attached to the onchain birth; FUEL runs the pod.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {FUEL_PRESETS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => onMon(amount)}
                  className={cn(
                    "border px-3 py-3 text-left transition-colors",
                    mon === amount
                      ? "border-[color:var(--signal)] bg-[color:var(--signal)]/8"
                      : "border-[color:var(--border)] bg-[color:var(--bg-2)] hover:border-[color:var(--border-strong)]",
                  )}
                >
                  <span className="font-mono text-sm text-[color:var(--text-primary)]">
                    {amount} MON
                  </span>
                  <span className="mt-1 block text-[10px] text-[color:var(--text-quaternary)]">
                    {Number(amount) * 100} FUEL
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center border border-[color:var(--border)] bg-[color:var(--bg-2)] pr-3 focus-within:border-[color:var(--border-focus)]">
              <Input
                value={mon}
                inputMode="decimal"
                aria-label="Custom MON amount"
                onChange={(event) => onMon(event.target.value)}
                className="h-11 border-0 bg-transparent focus:ring-0"
              />
              <span className="font-mono text-xs text-[color:var(--text-tertiary)]">
                MON
              </span>
            </div>
          </div>

          {error && <InlineError message={error} />}

          <div className="flex flex-col-reverse gap-3 border-t border-[color:var(--border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" size="lg" onClick={onBack} disabled={working}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              variant="signal"
              size="lg"
              loading={working}
              disabled={!quote}
              onClick={onForge}
              className="min-w-52"
            >
              <Wallet className="h-4 w-4" />
              {working ? "Waiting for wallet" : "Connect & forge"}
            </Button>
          </div>
        </div>
      </section>

      <aside className="border border-[color:var(--border)] bg-[color:var(--bg-2)]">
        <div className="border-b border-[color:var(--border)] p-5">
          <p className="micro text-[color:var(--text-quaternary)]">Fuel forecast</p>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="display text-5xl text-[color:var(--text-primary)]">
              {quote?.fuelLabel ?? "—"}
            </span>
            <span className="micro text-[color:var(--signal)]">FUEL</span>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden bg-[color:var(--bg-4)]">
            <motion.div
              animate={{ width: tankPercent + "%" }}
              className="h-full bg-[color:var(--signal)]"
            />
          </div>
          <p className="mt-2 text-[10px] text-[color:var(--text-quaternary)]">
            Tank scale: 100 FUEL
          </p>
        </div>
        <dl className="divide-y divide-[color:var(--border)]">
          <MetricRow label="Idle runway" value={"≈ " + lifetime} />
          <MetricRow label="Conversion" value="1 MON = 100 FUEL" />
          <MetricRow
            label="Wallet"
            value={wallet ? shortAddress(wallet) : "Connect on forge"}
          />
          <MetricRow label="Network" value="Monad Testnet" />
        </dl>
        <div className="m-5 border border-[color:var(--signal)]/20 bg-[color:var(--signal)]/5 p-4">
          <p className="text-[11px] leading-5 text-[color:var(--text-tertiary)]">
            You sign one transaction. FuelBorn verifies it before provisioning,
            so a fake transaction hash cannot create a pod or credit FUEL.
          </p>
        </div>
      </aside>
    </motion.div>
  );
}

function IgnitionStep({
  name,
  model,
  wallet,
  quote,
  attempt,
  txHash,
  confirmations,
  activeIndex,
  working,
  error,
  onRetry,
  onOpen,
}: {
  name: string;
  model: string;
  wallet: string | null;
  quote: ReturnType<typeof quoteForgeDeposit> | null;
  attempt: ForgeAttempt | null;
  txHash: string | null;
  confirmations: string | null;
  activeIndex: number;
  working: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: () => void;
}) {
  const ready = attempt?.status === "active" && activeIndex === 3;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      <section className="relative overflow-hidden border border-[color:var(--border)] bg-[color:var(--bg-1)]/95">
        <div className="pointer-events-none absolute left-1/2 top-36 h-64 w-64 -translate-x-1/2 rounded-full bg-[color:var(--signal)]/10 blur-[90px]" />
        <div className="relative border-b border-[color:var(--border)] px-5 py-4 sm:px-7">
          <p className="micro text-[color:var(--text-quaternary)]">
            03 / Onchain birth sequence
          </p>
          <h2 className="display mt-2 text-2xl text-[color:var(--text-primary)]">
            {ready ? name + " is alive." : "Ignition in progress."}
          </h2>
        </div>

        <div className="relative p-5 sm:p-8">
          <div className="mx-auto mb-10 flex h-24 w-24 items-center justify-center border border-[color:var(--signal)]/50 bg-[color:var(--signal)]/8 shadow-[0_0_80px_-18px_var(--signal)]">
            <Flame
              className={cn(
                "h-10 w-10 text-[color:var(--signal)]",
                !ready && "animate-pulse",
              )}
            />
          </div>

          <div className="mx-auto max-w-xl">
            {IGNITION_STEPS.map((step, index) => {
              const complete = index <= activeIndex;
              const current = index === activeIndex && !ready;
              const Icon = step.icon;
              return (
                <div key={step.title} className="relative flex gap-4 pb-7 last:pb-0">
                  {index < IGNITION_STEPS.length - 1 && (
                    <div
                      className={cn(
                        "absolute left-[17px] top-9 h-[calc(100%-28px)] w-px",
                        index < activeIndex
                          ? "bg-[color:var(--signal)]"
                          : "bg-[color:var(--border-strong)]",
                      )}
                    />
                  )}
                  <div
                    className={cn(
                      "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center border",
                      complete
                        ? "border-[color:var(--signal)] bg-[color:var(--signal)] text-white"
                        : "border-[color:var(--border-strong)] bg-[color:var(--bg-3)] text-[color:var(--text-quaternary)]",
                    )}
                  >
                    {complete && !current ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Icon className={cn("h-4 w-4", current && "animate-pulse")} />
                    )}
                  </div>
                  <div className="pt-0.5">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        complete
                          ? "text-[color:var(--text-primary)]"
                          : "text-[color:var(--text-quaternary)]",
                      )}
                    >
                      {step.title}
                    </p>
                    <p className="mt-1 text-[11px] text-[color:var(--text-quaternary)]">
                      {step.detail}
                    </p>
                    {index === 0 && confirmations && current && (
                      <p className="mt-2 font-mono text-[10px] text-[color:var(--signal)]">
                        {confirmations} confirmation(s) remaining
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mx-auto mt-8 max-w-xl">
              <InlineError message={error} />
              <Button
                variant="secondary"
                size="sm"
                onClick={onRetry}
                disabled={working}
                className="mt-3"
              >
                Retry verification
              </Button>
            </div>
          )}

          <div className="mx-auto mt-10 flex max-w-xl justify-end border-t border-[color:var(--border)] pt-6">
            <Button
              variant="signal"
              size="lg"
              disabled={!ready}
              onClick={onOpen}
              className="min-w-56"
            >
              Enter Control Room
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <aside className="h-fit border border-[color:var(--border)] bg-[color:var(--bg-2)]">
        <div className="border-b border-[color:var(--border)] p-5">
          <div className="flex items-center justify-between">
            <p className="micro text-[color:var(--text-quaternary)]">Birth record</p>
            <span
              className={cn(
                "font-mono text-[10px]",
                ready
                  ? "text-[color:var(--acc-green)]"
                  : "text-[color:var(--signal)]",
              )}
            >
              {ready ? "ACTIVE" : "PENDING"}
            </span>
          </div>
          <p className="display mt-6 text-3xl text-[color:var(--text-primary)]">
            {name}
          </p>
        </div>
        <dl className="divide-y divide-[color:var(--border)]">
          <MetricRow
            label="Model"
            value={MODELS.find((choice) => choice.id === model)?.name ?? model}
          />
          <MetricRow label="Fuel" value={quote ? quote.fuelLabel + " FUEL" : "—"} />
          <MetricRow label="Owner" value={wallet ? shortAddress(wallet) : "—"} />
          <MetricRow
            label="Token ID"
            value={attempt?.token_id ? "#" + attempt.token_id : "Awaiting proof"}
          />
          <MetricRow
            label="Pod"
            value={attempt?.pod_uuid_short ?? "Allocating"}
          />
        </dl>
        {txHash && (
          <a
            href={MONAD_TESTNET_EXPLORER + "/tx/" + txHash}
            target="_blank"
            rel="noreferrer"
            className="m-5 flex items-center justify-between border border-[color:var(--border)] px-3 py-3 text-[11px] text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)]"
          >
            <span>View birth transaction</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </aside>
    </motion.div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <dt className="micro text-[color:var(--text-quaternary)]">{label}</dt>
      <dd className="max-w-[65%] truncate text-right font-mono text-[11px] text-[color:var(--text-secondary)]">
        {value}
      </dd>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-4 py-3 text-xs leading-5 text-[color:var(--acc-red)]"
    >
      {message}
    </div>
  );
}

function getProvider(): EvmProvider | null {
  return (
    (window as Window & { ethereum?: EvmProvider }).ethereum ?? null
  );
}

async function switchToForgeChain(provider: EvmProvider, chainId: number) {
  const hex = chainIdHex(chainId);
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex }],
    });
  } catch (cause) {
    const code = getErrorCode(cause);
    if (code !== 4902) throw cause;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hex,
          chainName: "Monad Testnet",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: [MONAD_TESTNET_RPC],
          blockExplorerUrls: [MONAD_TESTNET_EXPLORER],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex }],
    });
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    throw new Error(detail?.message || detail?.error || "Request failed.");
  }
  return (await response.json()) as T;
}

function readableWalletError(cause: unknown): string {
  const code = getErrorCode(cause);
  if (code === 4001) return "The wallet request was cancelled.";
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/insufficient funds/i.test(message)) {
    return "This wallet does not have enough MON for the deposit and gas.";
  }
  if (/forge_not_configured|forge configuration/i.test(message)) {
    return "Forge is waiting for its deployed Monad contract configuration.";
  }
  return message || "Something interrupted the forge sequence.";
}

function getErrorCode(cause: unknown): number | null {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as { code?: unknown }).code === "number"
  ) {
    return (cause as { code: number }).code;
  }
  return null;
}

function formatLifetime(seconds: bigint): string {
  const hours = seconds / BigInt(3_600);
  const days = hours / BigInt(24);
  if (days >= BigInt(2)) return days.toString(10) + " days idle";
  return hours.toString(10) + " hours idle";
}

function shortAddress(address: string): string {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
