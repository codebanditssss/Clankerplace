"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import {
  Maximize2,
  Minimize2,
  Search,
  X,
  Copy,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/badge";
import { KeyCap } from "@/components/ui/keycap";
import { cn } from "@/lib/cn";

type Phase = "installing" | "connecting" | "open" | "closed" | "error";

function isPlainAscii(s: string): boolean {
  if (s.length !== 1) return false;
  const c = s.charCodeAt(0);
  return c >= 0x20 && c <= 0x7e;
}

export default function PodConsole({
  identifier,
  initiallyInstalled,
}: {
  identifier: string;
  initiallyInstalled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Rolling buffer of recent terminal output — persisted to localStorage
  // every ~1 s so a hard reload of the dashboard restores the visible
  // scrollback. The bash session itself is a fresh `docker exec`, so this
  // is purely cosmetic: it replays the old bytes into xterm before the
  // new WS connects. Capped at SCROLLBACK_LINES so localStorage usage
  // stays bounded and the restore is fast (also user-requested — "last
  // 100 lines only, not everything").
  const SCROLLBACK_LINES = 100;
  // Hard byte ceiling on top of the line cap — pathological cases (one
  // line with 200K of ANSI cursor moves) would still bloat storage.
  const SCROLLBACK_CHARS_HARD = 256_000;
  const STORAGE_KEY = `pods-ml:console:${identifier}`;
  const bufferRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<Phase>(
    initiallyInstalled ? "connecting" : "installing",
  );
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const appendToBuffer = (chunk: string) => {
    bufferRef.current += chunk;
    // Keep only the last SCROLLBACK_LINES newline-separated lines.
    // Counting "\n" boundaries is approximate (ANSI cursor moves can
    // scroll the screen without emitting \n) but it's the common case
    // and matches what the user means by "lines".
    const newlines = bufferRef.current.split("\n");
    if (newlines.length > SCROLLBACK_LINES + 1) {
      bufferRef.current = newlines.slice(-(SCROLLBACK_LINES + 1)).join("\n");
    }
    if (bufferRef.current.length > SCROLLBACK_CHARS_HARD) {
      bufferRef.current = bufferRef.current.slice(-SCROLLBACK_CHARS_HARD);
    }
    // Throttle saves so we don't pound localStorage on every keystroke.
    if (saveTimerRef.current) return;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      try {
        localStorage.setItem(STORAGE_KEY, bufferRef.current);
      } catch {
        /* quota exceeded — silently drop */
      }
    }, 1000);
  };

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      // Terminal box-drawing chars (│ ─ ┌ └ etc.) need a 1.0 line-height to
      // sit flush against each other — anything higher inserts visible
      // gaps that fracture MOTD/tui art.
      lineHeight: 1.0,
      letterSpacing: 0,
      theme: {
        background: "#050505",
        foreground: "#ededed",
        cursor: "#ededed",
        cursorAccent: "#050505",
        selectionBackground: "rgba(0,114,245,0.35)",
        black: "#1a1a1a",
        red: "#ff5a5f",
        green: "#5bd17e",
        yellow: "#f0b65b",
        blue: "#5aa3f5",
        magenta: "#b388ff",
        cyan: "#5dd9d4",
        white: "#ededed",
        brightBlack: "#5e5e5e",
        brightRed: "#ff7d80",
        brightGreen: "#7be09a",
        brightYellow: "#f7c97a",
        brightBlue: "#7eb4f7",
        brightMagenta: "#c4a3ff",
        brightCyan: "#7ee0db",
        brightWhite: "#ffffff",
      },
      scrollback: 10_000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const cols = term.cols,
          rows = term.rows;
        const sock = wsRef.current;
        if (sock?.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify({ r: [cols, rows] }));
        }
      } catch {}
    });
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      // Flush any pending scrollback save before we tear down.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        try {
          localStorage.setItem(STORAGE_KEY, bufferRef.current);
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "installing") return;
    const startedAt = Date.now();
    const tick = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/pods/${identifier}/status`, {
          cache: "no-store",
        });
        const d = (await r.json()) as { installed?: boolean };
        if (d.installed) {
          clearInterval(poll);
          clearInterval(tick);
          setPhase("connecting");
        }
      } catch {}
    }, 4000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [phase, identifier]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || phase !== "installing") return;
    term.clear();
    term.writeln("");
    term.writeln(
      "  \x1b[90m┌────────────────────────────────────────────────────────────┐\x1b[0m",
    );
    term.writeln(
      "  \x1b[90m│\x1b[0m  \x1b[36mProvisioning your sandbox…\x1b[0m                                \x1b[90m│\x1b[0m",
    );
    term.writeln(
      "  \x1b[90m│\x1b[0m                                                            \x1b[90m│\x1b[0m",
    );
    term.writeln(
      "  \x1b[90m│\x1b[0m  • Spinning up Ubuntu 22.04 container                      \x1b[90m│\x1b[0m",
    );
    term.writeln(
      "  \x1b[90m│\x1b[0m  • Installing Python, Node, build tools, Hermes Agent      \x1b[90m│\x1b[0m",
    );
    term.writeln(
      "  \x1b[90m│\x1b[0m  • ~3 minutes — terminal activates when ready              \x1b[90m│\x1b[0m",
    );
    term.writeln(
      "  \x1b[90m└────────────────────────────────────────────────────────────┘\x1b[0m",
    );
    term.writeln("");
  }, [phase]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || phase !== "installing") return;
    const dots = ".".repeat((elapsedSec % 4) + 1).padEnd(4);
    term.write(`\r  \x1b[33m▸ installing${dots}\x1b[0m  ${elapsedSec}s elapsed   `);
  }, [elapsedSec, phase]);

  const startedRef = useRef(false);
  useEffect(() => {
    if (phase === "installing") return;
    if (startedRef.current) return;
    startedRef.current = true;
    const term = termRef.current;
    if (!term) return;
    term.clear();
    // Replay the saved scrollback so the user sees their previous
    // session's output. We defer this with a microtask + chunked writes
    // because pasting 200 KB of ANSI bytes into xterm in one shot blocks
    // the main thread for a beat on page load — small chunks let the
    // browser paint between batches so the dashboard feels responsive.
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {}
    term.writeln("\x1b[90m[FuelBorn] connecting to your pod…\x1b[0m");
    if (saved && saved.length > 0) {
      bufferRef.current = saved;
      const CHUNK = 16_384;
      let offset = 0;
      const writeNext = () => {
        if (!termRef.current || offset >= saved!.length) {
          try {
            termRef.current?.write(
              "\r\n\x1b[90m[FuelBorn] —— above: restored from previous session ——\x1b[0m\r\n",
            );
          } catch {}
          return;
        }
        const end = Math.min(offset + CHUNK, saved!.length);
        try {
          termRef.current.write(saved!.slice(offset, end));
        } catch {}
        offset = end;
        // Use rIC when available, fall back to setTimeout — both yield
        // to the browser's render loop so first paint isn't blocked.
        const schedule = (cb: () => void) =>
          typeof window !== "undefined" &&
          typeof window.requestIdleCallback === "function"
            ? window.requestIdleCallback(cb, { timeout: 50 })
            : setTimeout(cb, 0);
        schedule(writeNext);
      };
      writeNext();
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/pods/${identifier}/terminal`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setPhase("open");
      try {
        fitRef.current?.fit();
        ws.send(JSON.stringify({ r: [term.cols, term.rows] }));
      } catch {}
    };
    // ---- Predictive local echo ----
    // Network RTT from browser → Azure → bash echo can be 100-300 ms, which
    // feels laggy when typing. So we optimistically render printable chars
    // the instant they're typed and strip the matching server echo when it
    // arrives.
    //
    // CRITICAL: TUI apps (hermes, vim, htop, fzf, less, fzf) own the
    // screen — they handle their own input rendering via redraws. Local
    // predictions show up for a frame, then the TUI redraw overlays
    // them, producing the "double text / glitched" look the user saw in
    // Hermes Agent's input box. We detect a TUI is active via any of:
    //   - alt-screen toggle (multiple variants: 1049, 47, 1047)
    //   - bracketed paste enable (2004) — Textual / Hermes uses this
    //   - application keypad (1h)
    // and freeze prediction while any of them is on.
    //
    // Chunk boundaries can split a single escape sequence (e.g. one chunk
    // ends with "\x1b" and the next starts with "[?1049h"). We keep a
    // 16-byte tail from the previous chunk and prepend it to the
    // boundary check so we don't miss split escapes.
    const ENTER_TUI = [
      "\x1b[?1049h",
      "\x1b[?1047h",
      "\x1b[?47h",
      "\x1b[?2004h",
    ];
    const EXIT_TUI = [
      "\x1b[?1049l",
      "\x1b[?1047l",
      "\x1b[?47l",
      "\x1b[?2004l",
    ];
    const predictions: string[] = [];
    let pausePredictionsUntil = 0;
    let inTui = false;
    let tailBuf = "";
    const decoder = new TextDecoder();
    const PAUSE_AFTER_UNCONFIRMED = 6;
    const PAUSE_MS = 1500;

    const writeChunk = (chunk: string) => {
      if (chunk.length === 0) return;

      const probe = tailBuf + chunk;
      for (const seq of ENTER_TUI) {
        if (probe.includes(seq)) {
          if (!inTui) inTui = true;
          predictions.length = 0;
        }
      }
      for (const seq of EXIT_TUI) {
        if (probe.includes(seq)) inTui = false;
      }
      tailBuf = probe.slice(-16);

      // In TUI mode: no prediction stripping, no append-with-fancy-logic.
      // The TUI emits raw cursor-move + write sequences that don't
      // start with our predicted bytes — trying to match them only
      // mangles its redraws.
      if (inTui) {
        term.write(chunk);
        appendToBuffer(chunk);
        return;
      }

      // Normal shell path: strip predicted bytes off the head of the
      // chunk. We only strip when both predictions[0] and the head byte
      // are plain printable ASCII — ANSI escapes or control bytes never
      // count as echo matches.
      let i = 0;
      while (
        i < chunk.length &&
        predictions.length > 0 &&
        chunk.charCodeAt(i) === predictions[0].charCodeAt(0) &&
        isPlainAscii(predictions[0])
      ) {
        predictions.shift();
        i++;
      }
      if (predictions.length > 0 && i < chunk.length) {
        const head = chunk.charCodeAt(i);
        const looksLikeEscape = head === 0x1b || head === 0x0d || head === 0x07;
        if (looksLikeEscape) predictions.length = 0;
      }
      const rest = chunk.slice(i);
      if (rest.length > 0) {
        term.write(rest);
        appendToBuffer(rest);
      }
    };

    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data === "string") {
        writeChunk(data);
      } else if (data instanceof ArrayBuffer) {
        writeChunk(decoder.decode(new Uint8Array(data), { stream: true }));
      }
    };
    ws.onclose = (ev) => {
      setPhase("closed");
      if (ev.code === 4003) setErrorText("pod still installing — refresh in a moment");
      else if (ev.code === 4006) setErrorText("pod is not running - start it from Actions");
      else if (ev.code === 4001) setErrorText("session expired — please reload");
    };
    ws.onerror = () => {
      setPhase("error");
      setErrorText("websocket error");
    };

    const onData = term.onData((s) => {
      // Drop xterm's own OSC replies (eg. bg-color query) — forwarding them to a cooked-mode bash echoes them back as visible junk.
      if (s.startsWith("\x1b]")) return;
      if (ws.readyState === WebSocket.OPEN) ws.send(s);
      // Skip prediction while any TUI mode is on — hermes/vim/htop/less
      // own the screen, our local echoes appear for one frame and then
      // get repainted by the TUI's draw, producing visible double text.
      if (inTui) return;
      const now = Date.now();
      if (now < pausePredictionsUntil) return;
      if (s.length === 1) {
        const code = s.charCodeAt(0);
        if (code >= 0x20 && code <= 0x7e) {
          predictions.push(s);
          term.write(s);
          if (predictions.length >= PAUSE_AFTER_UNCONFIRMED) {
            // Likely a password prompt / paste-burst — back off so we don't
            // leak text and let bash echo authoritatively for a bit.
            pausePredictionsUntil = now + PAUSE_MS;
            predictions.length = 0;
          }
        }
        // Backspace, arrow keys, ctrl-*, escape sequences all flow straight
        // to the server with no local prediction (avoids double-erase
        // artifacts when bash echoes the erase back).
      }
    });
    return () => {
      onData.dispose();
      try {
        ws.close();
      } catch {}
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "installing", identifier]);

  // Keyboard shortcuts: Ctrl+Shift+F search, Esc closes search, etc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  // Re-fit when fullscreen toggles
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit();
      } catch {}
    }, 60);
    return () => clearTimeout(t);
  }, [fullscreen]);

  const handleSearch = useCallback(
    (next: boolean) => {
      const s = searchRef.current;
      if (!s || !searchTerm) return;
      const opts = { incremental: false, caseSensitive: false };
      if (next) s.findNext(searchTerm, opts);
      else s.findPrevious(searchTerm, opts);
    },
    [searchTerm],
  );

  const badgeTone =
    phase === "open"
      ? "green"
      : phase === "installing" || phase === "connecting"
        ? "amber"
        : phase === "error"
          ? "red"
          : "neutral";
  const badgeText = {
    installing: `installing · ${elapsedSec}s`,
    connecting: "connecting…",
    open: "live",
    closed: "disconnected",
    error: "error",
  }[phase];

  return (
    <div
      className={cn(
        "overflow-hidden border border-[color:var(--border)] bg-[color:var(--bg-1)] shadow-[var(--shadow-card)]",
        fullscreen && "fixed inset-3 z-50 m-0",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-2)]/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2 text-[12px]">
          <StatusDot tone={badgeTone} pulse={phase === "open" || phase === "connecting"} />
          <span className="font-medium text-[color:var(--text-secondary)]">
            {badgeText}
          </span>
          {errorText && (
            <span className="text-[11px] text-[color:var(--acc-amber)]">
              · {errorText}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearchOpen(true)}
            title="Search (Ctrl/⌘+Shift+F)"
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const term = termRef.current;
              if (!term) return;
              const sel = term.getSelection();
              if (sel) navigator.clipboard.writeText(sel).catch(() => {});
            }}
            title="Copy selection"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-1)]/70 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-[color:var(--text-quaternary)]" />
          <input
            autoFocus
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch(!e.shiftKey);
              else if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="Search terminal buffer…"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            data-bwignore="true"
            className="h-7 flex-1 bg-transparent text-[12px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-quaternary)] focus:outline-none"
          />
          <Button variant="ghost" size="icon" onClick={() => handleSearch(false)}>
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleSearch(true)}>
            <ChevronDown className="h-3 w-3" />
          </Button>
          <span className="text-[10px] text-[color:var(--text-quaternary)]">
            <KeyCap>↵</KeyCap> next · <KeyCap>⇧↵</KeyCap> prev · <KeyCap>esc</KeyCap> close
          </span>
          <Button variant="ghost" size="icon" onClick={() => setSearchOpen(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/*
        IMPORTANT: padding goes on a *wrapper*, NOT on the xterm host.
        FitAddon.fit() measures host.clientHeight, divides by line-height to
        get row count, then renders rows from the top — any padding on the
        host gets counted as usable rows and the last row clips into it.
      */}
      <div
        className={cn(
          "w-full px-3 py-3",
          fullscreen ? "h-[calc(100dvh-110px)]" : "h-[540px]",
        )}
      >
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </div>
  );
}
