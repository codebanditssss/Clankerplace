"use client";

// Embeddable WhatsApp pairing flow.
//
// Extracted out of WhatsAppConnector so the new ConnectorPickerSheet can
// drop the same xterm-based pairing UI into its setup view. Two states:
//
//   "idle"  → mode picker (bot / self-chat) + Start-pairing CTA
//   "open"  → embedded xterm proxied to /api/pods/<uuid>/whatsapp-pair WS;
//             a 3s poll against /api/pods/<uuid>/whatsapp watches for
//             paired=true, then closes the WS and fires onPairingComplete
//             so the parent can POST {enabled:true, mode} and force a
//             gateway/bridge restart.
import { useEffect, useRef, useState } from "react";
import { Plug, X } from "lucide-react";
import { toast } from "sonner";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Hint } from "@/components/ui/input";

export type WhatsAppMode = "bot" | "self-chat";

export type PairingPollResult = { paired: boolean } | null;

export function WhatsAppPairingFlow({
  identifier,
  mode,
  onModeChange,
  onBeforeStart,
  onPaired,
  onPairingComplete,
  // When `embedded` is true (rendered inside the picker sheet) we drop the
  // outer warning banner — the sheet already has its own header.
  embedded = false,
}: {
  identifier: string;
  mode: WhatsAppMode;
  onModeChange: (m: WhatsAppMode) => void;
  onBeforeStart?: (chosenMode: WhatsAppMode) => Promise<boolean>;
  onPaired: () => Promise<PairingPollResult>;
  onPairingComplete: (chosenMode: WhatsAppMode) => Promise<void>;
  embedded?: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "connecting" | "open" | "closed">(
    "idle",
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Refs so prop-identity churn doesn't tear down the terminal mid-pairing.
  // The picker sheet recreates `onPaired` + `onPairingComplete` as inline
  // arrows on every render — without refs, every keystroke / state change
  // upstream would dispose the xterm + WS and the user would see the QR
  // flicker / restart.
  const onPairingCompleteRef = useRef(onPairingComplete);
  useEffect(() => {
    onPairingCompleteRef.current = onPairingComplete;
  }, [onPairingComplete]);
  const onPairedRef = useRef(onPaired);
  useEffect(() => {
    onPairedRef.current = onPaired;
  }, [onPaired]);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  async function startPairing() {
    if (starting) return;
    setStarting(true);
    try {
      const ok = onBeforeStart ? await onBeforeStart(modeRef.current) : true;
      if (ok) setStarted(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!started || !hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.0,
      letterSpacing: 0,
      theme: {
        background: "#050505",
        foreground: "#ededed",
        cursor: "#25D366",
        cursorAccent: "#050505",
        selectionBackground: "rgba(37,211,102,0.35)",
        green: "#25D366",
        brightGreen: "#4ade80",
      },
      scrollback: 5_000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const sock = wsRef.current;
        if (sock?.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify({ r: [term.cols, term.rows] }));
        }
      } catch {}
    });
    ro.observe(hostRef.current);

    setPhase("connecting");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${proto}//${window.location.host}/api/pods/${identifier}/whatsapp-pair`,
    );
    wsRef.current = ws;
    ws.onopen = () => {
      setPhase("open");
      try {
        fit.fit();
        ws.send(JSON.stringify({ r: [term.cols, term.rows] }));
      } catch {}
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") term.write(ev.data);
      else if (ev.data instanceof ArrayBuffer)
        term.write(new TextDecoder().decode(new Uint8Array(ev.data)));
    };
    ws.onclose = () => setPhase("closed");
    ws.onerror = () => setPhase("closed");
    const onData = term.onData((s) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(s);
    });

    // Two-stage completion:
    //   1. As soon as the session blob appears on disk, start a 4s
    //      settle timer. Don't kill the WS yet — the wizard is still
    //      wrapping up (writing lid-mapping
    //      files, closing its bridge cleanly, syncing bridge.pid).
    //   2. After 4s OR when the wizard exits naturally (whichever comes
    //      first), fire onPairingComplete → server-side restartGateway.
    //
    // Without this delay, restartGateway races the wizard and kills the
    // bridge mid-cleanup, producing the "re-pairing is full of bugs"
    // symptom — half-written session files etc.
    let pairedAt = 0;
    let completionFired = false;
    const fireCompletion = async () => {
      if (completionFired) return;
      completionFired = true;
      clearInterval(poll);
      try {
        ws.close();
      } catch {}
      try {
        await onPairingCompleteRef.current(modeRef.current);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    };
    const poll = setInterval(async () => {
      let d: PairingPollResult = null;
      try {
        d = await onPairedRef.current();
      } catch {
        d = null;
      }
      if (d?.paired && !pairedAt) {
        pairedAt = Date.now();
      }
      if (pairedAt && Date.now() - pairedAt >= 4000 && !completionFired) {
        await fireCompletion();
      }
    }, 1000);
    // If the wizard exits before our 4s timer (clean handoff), trigger
    // completion right away — no point in waiting longer.
    const origOnClose = ws.onclose;
    ws.onclose = (ev) => {
      origOnClose?.call(ws, ev);
      if (pairedAt && !completionFired) {
        void fireCompletion();
      }
    };

    return () => {
      clearInterval(poll);
      ro.disconnect();
      onData.dispose();
      try {
        ws.close();
      } catch {}
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
    // Deliberately omit onPaired / onPairingComplete / mode from deps:
    // they're read through refs at poll time. Re-running this effect on
    // their identity change tears down the terminal mid-pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, identifier]);

  return (
    <div className="space-y-4">
      {!started ? (
        <>
          {!embedded && (
            <div className="border border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)]/40 p-3 text-[12px] leading-relaxed text-[color:var(--text-secondary)]">
              <strong className="text-[color:var(--acc-amber)]">
                Unofficial API · ban risk:
              </strong>{" "}
              WhatsApp doesn&apos;t officially support third-party bots. Use a
              dedicated phone number (Google Voice or prepaid SIM) for the bot,
              and avoid bulk outbound messages.
            </div>
          )}

          <Field label="Pairing mode">
            <div className="grid grid-cols-2 gap-2">
              <ModeOption
                label="Bot number"
                value="bot"
                desc="Dedicated phone number. People DM that number."
                badge="recommended"
                checked={mode === "bot"}
                onSelect={() => {
                  modeRef.current = "bot";
                  onModeChange("bot");
                }}
              />
              <ModeOption
                label="Self-chat"
                value="self-chat"
                desc="Use your own WhatsApp; message yourself to talk to the agent."
                checked={mode === "self-chat"}
                onSelect={() => {
                  modeRef.current = "self-chat";
                  onModeChange("self-chat");
                }}
              />
            </div>
          </Field>

          <ol className="space-y-1.5 border border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] p-3 text-[12px] text-[color:var(--text-secondary)]">
            <li>
              <span className="text-[color:var(--text-quaternary)]">1.</span>{" "}
              Click{" "}
              <kbd className="bg-[color:var(--bg-3)] px-1.5 py-0.5 text-[11px]">
                Start pairing
              </kbd>{" "}
              — we&apos;ll launch the Hermes wizard inside the pod.
            </li>
            <li>
              <span className="text-[color:var(--text-quaternary)]">2.</span>{" "}
              On the phone you want to pair, open WhatsApp → <em>Settings</em>{" "}
              → <em>Linked Devices</em> → <em>Link a Device</em>.
            </li>
            <li>
              <span className="text-[color:var(--text-quaternary)]">3.</span>{" "}
              Point the camera at the QR code that appears below.
            </li>
            <li>
              <span className="text-[color:var(--text-quaternary)]">4.</span>{" "}
              After pairing completes, wait about 5 minutes before testing.
            </li>
          </ol>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={startPairing}
              loading={starting}
              disabled={starting}
            >
              {!starting && <Plug className="h-3.5 w-3.5" />}
              {starting ? "Starting..." : "Start pairing"}
            </Button>
            <Hint>
              Hermes installs the Baileys bridge on first run (~30 s). The QR
              refreshes every ~20 s if you don&apos;t scan in time.
            </Hint>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between border border-[color:var(--border-subtle)] bg-[color:var(--bg-2)]/80 px-3 py-1.5 text-[12px]">
            <div className="flex items-center gap-2">
              <StatusDot
                tone={
                  phase === "open"
                    ? "green"
                    : phase === "connecting"
                      ? "amber"
                      : "neutral"
                }
                pulse={phase === "open" || phase === "connecting"}
              />
              <span className="text-[color:var(--text-secondary)]">
                {phase === "connecting"
                  ? "connecting to pod…"
                  : phase === "open"
                    ? "wizard running — scan the QR with your phone"
                    : "wizard closed"}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                try {
                  wsRef.current?.close();
                } catch {}
                setStarted(false);
              }}
            >
              <X className="h-3 w-3" /> Cancel
            </Button>
          </div>
          <div className="overflow-hidden border border-[color:var(--border)] bg-[#050505] p-3">
            <div ref={hostRef} className="h-[460px] w-full" />
          </div>
          <Hint>
            If the QR looks garbled, widen the panel or close other tabs to
            give the terminal room. The wizard re-prints a fresh QR every ~20
            seconds.
          </Hint>
        </>
      )}
    </div>
  );
}

function ModeOption({
  label,
  value,
  desc,
  badge,
  checked,
  onSelect,
}: {
  label: string;
  value: string;
  desc: string;
  badge?: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "flex flex-col items-start gap-1 border p-3 text-left transition-colors " +
        (checked
          ? "border-[color:var(--acc-green)]/50 bg-[color:var(--acc-green-soft)]/30"
          : "border-[color:var(--border)] bg-[color:var(--bg-1)] hover:bg-[color:var(--bg-3)]")
      }
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">
          {label}
        </span>
        {badge && checked && (
          <span className="rounded-full border border-[color:var(--acc-green)]/40 bg-[color:var(--acc-green-soft)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[color:var(--acc-green)]">
            {badge}
          </span>
        )}
      </div>
      <span className="text-[11px] leading-snug text-[color:var(--text-tertiary)]">
        {desc}
      </span>
      <span className="sr-only">{value}</span>
    </button>
  );
}
