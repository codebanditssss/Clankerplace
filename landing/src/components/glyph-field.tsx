"use client";

import * as React from "react";

/**
 * GlyphField — monospace ASCII/glyph noise wall.
 *
 * Background variant of the auth-shell glyph field. Drops the inner vignette
 * and left-edge fade (those are tuned for a form column overlay). The hero
 * applies its own center-out radial mask to fade the field into the canvas
 * behind the headline and CTAs.
 *
 * - Single absolutely-positioned grid of monospace rows, edge-to-edge.
 * - Per-tick a small random subset of cells shimmer (swap glyph).
 * - Random "embers" briefly glow signal-orange and fade out, giving the
 *   field a live, breathing feel without distracting motion.
 * - Respects prefers-reduced-motion: freezes after first paint.
 */

const POOL = (
  "0123456789" +
  "abcdefghijklmnopqrstuvwxyz" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "<>[](){}/\\|+-*=^~#$%&!?:;,._\"'`@"
).split("");

const SPACE_BIAS = 0.18;

function rand() {
  return POOL[Math.floor(Math.random() * POOL.length)];
}
function pick() {
  return Math.random() < SPACE_BIAS ? " " : rand();
}
function pickGlyph() {
  return rand();
}

type Ember = {
  id: number;
  col: number;
  row: number;
  ch: string;
  bornAt: number;
  ttl: number;
};

export function GlyphField({
  className = "",
  cellWidth = 10,
  cellHeight = 14,
  tickMs = 110,
  shimmerRate = 0.008,
  emberSpawnMs = 260,
  emberMaxLive = 12,
}: {
  className?: string;
  cellWidth?: number;
  cellHeight?: number;
  tickMs?: number;
  shimmerRate?: number;
  emberSpawnMs?: number;
  emberMaxLive?: number;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [dims, setDims] = React.useState({ cols: 0, rows: 0 });
  const [measured, setMeasured] = React.useState({ cw: cellWidth, ch: cellHeight });
  const cellsRef = React.useRef<string[]>([]);
  const [tick, setTick] = React.useState(0);
  const [embers, setEmbers] = React.useState<Ember[]>([]);
  const emberSeqRef = React.useRef(0);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    if (!hostRef.current) return;
    const el = hostRef.current;

    const probe = document.createElement("span");
    probe.textContent = "M".repeat(100);
    probe.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre;font:inherit;";
    el.appendChild(probe);
    const cw = probe.getBoundingClientRect().width / 100 || cellWidth;
    el.removeChild(probe);
    const ch = cellHeight;
    setMeasured({ cw, ch });

    const compute = () => {
      const r = el.getBoundingClientRect();
      const cols = Math.max(1, Math.floor((r.width - 1) / cw));
      const rows = Math.max(1, Math.floor(r.height / ch));
      setDims((prev) =>
        prev.cols === cols && prev.rows === rows ? prev : { cols, rows },
      );
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cellWidth, cellHeight]);

  React.useEffect(() => {
    const total = dims.cols * dims.rows;
    if (total === 0) return;
    const buf = new Array<string>(total);
    for (let i = 0; i < total; i++) buf[i] = pick();
    cellsRef.current = buf;
    setTick((t) => t + 1);
  }, [dims]);

  React.useEffect(() => {
    if (reduced) return;
    const total = dims.cols * dims.rows;
    if (total === 0) return;
    const mutateCount = Math.max(4, Math.floor(total * shimmerRate));
    const id = window.setInterval(() => {
      const buf = cellsRef.current;
      for (let i = 0; i < mutateCount; i++) {
        const idx = Math.floor(Math.random() * total);
        buf[idx] = pick();
      }
      setTick((t) => (t + 1) % 1_000_000);
    }, tickMs);
    return () => window.clearInterval(id);
  }, [dims, tickMs, shimmerRate, reduced]);

  React.useEffect(() => {
    if (reduced) return;
    const { cols, rows: rowCount } = dims;
    if (cols === 0 || rowCount === 0) return;

    let raf = 0;
    let lastSpawn = performance.now();
    let nextGap = emberSpawnMs * (0.6 + Math.random() * 0.8);

    const loop = () => {
      const now = performance.now();
      setEmbers((prev) => {
        let next = prev.filter((e) => now - e.bornAt < e.ttl);
        if (now - lastSpawn >= nextGap && next.length < emberMaxLive) {
          lastSpawn = now;
          nextGap = emberSpawnMs * (0.6 + Math.random() * 0.8);
          emberSeqRef.current += 1;
          next = [
            ...next,
            {
              id: emberSeqRef.current,
              col: Math.floor(Math.random() * cols),
              row: Math.floor(Math.random() * rowCount),
              ch: pickGlyph(),
              bornAt: now,
              ttl: 1400 + Math.random() * 1800,
            },
          ];
        }
        return next;
      });
      raf = window.requestAnimationFrame(loop);
    };

    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [dims, emberSpawnMs, emberMaxLive, reduced]);

  const rows: React.ReactNode[] = [];
  const { cols, rows: rowCount } = dims;
  const buf = cellsRef.current;
  if (cols > 0 && rowCount > 0 && buf.length === cols * rowCount) {
    for (let r = 0; r < rowCount; r++) {
      let line = "";
      for (let c = 0; c < cols; c++) line += buf[r * cols + c];
      rows.push(
        <div
          key={r}
          className="whitespace-pre"
          style={{ height: cellHeight, lineHeight: `${cellHeight}px` }}
        >
          {line}
        </div>,
      );
    }
  }

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={`relative overflow-hidden font-mono text-[11px] leading-none text-neutral-300/70 ${className}`}
      data-tick={tick}
    >
      <div
        className="absolute inset-0 select-none"
        style={{ fontVariantLigatures: "none" }}
      >
        {rows}
      </div>

      <div
        className="pointer-events-none absolute inset-0 select-none"
        style={{ fontVariantLigatures: "none" }}
      >
        {embers.map((e) => {
          const age = performance.now() - e.bornAt;
          const t = Math.min(1, Math.max(0, age / e.ttl));
          const env =
            t < 0.25
              ? t / 0.25
              : t < 0.7
                ? 1
                : Math.max(0, 1 - (t - 0.7) / 0.3);
          const opacity = env * env * (3 - 2 * env);
          return (
            <span
              key={e.id}
              style={{
                position: "absolute",
                left: e.col * measured.cw,
                top: e.row * cellHeight,
                width: measured.cw,
                height: cellHeight,
                lineHeight: `${cellHeight}px`,
                color: "var(--color-signal, #FF6A2C)",
                opacity,
                textShadow:
                  opacity > 0.4
                    ? `0 0 6px rgba(255,106,44,${0.55 * opacity}), 0 0 14px rgba(255,106,44,${0.35 * opacity})`
                    : undefined,
              }}
            >
              {e.ch}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const h = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return reduced;
}
