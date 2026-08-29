"use client";

import * as React from "react";

/**
 * GlyphField — Inception-style monospace ASCII/glyph noise wall.
 *
 * Renders a tightly-packed grid of small monospace characters filling
 * 100% of its parent. The character at each cell is sampled from a pool
 * of code-noise glyphs (digits, punctuation, brackets, letters, math
 * symbols). On every tick a small random subset of cells shimmer —
 * swap to a new glyph — producing the same data-field feel as
 * inceptionlabs.ai's hero right column.
 *
 * Implementation notes:
 *   - One <div> per row keeps DOM cost manageable.
 *   - We resize-observe the container and compute (cols, rows) from a
 *     measured cell size so the grid stays edge-to-edge at any width.
 *   - Respects prefers-reduced-motion: stops mutating, keeps a frozen
 *     static field.
 */

// Code-noise alphabet: brackets, math, punctuation, mixed-case letters, digits.
const POOL = (
  "0123456789" +
  "abcdefghijklmnopqrstuvwxyz" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "<>[](){}/\\|+-*=^~#$%&!?:;,._\"'`@"
).split("");

const SPACE_BIAS = 0.18; // ~18% blank cells for breathing

function rand() {
  return POOL[Math.floor(Math.random() * POOL.length)];
}

function pick() {
  return Math.random() < SPACE_BIAS ? " " : rand();
}

export function GlyphField({
  className = "",
  cellWidth = 10, // px
  cellHeight = 14, // px
  tickMs = 90,
  shimmerRate = 0.012, // fraction of cells to mutate per tick
}: {
  className?: string;
  cellWidth?: number;
  cellHeight?: number;
  tickMs?: number;
  shimmerRate?: number;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [dims, setDims] = React.useState({ cols: 0, rows: 0 });
  const cellsRef = React.useRef<string[]>([]);
  const [tick, setTick] = React.useState(0);
  const reduced = usePrefersReducedMotion();

  // Resize observer → recompute grid dimensions using *measured* glyph width.
  React.useEffect(() => {
    if (!hostRef.current) return;
    const el = hostRef.current;

    // Measure one glyph in the actual font/size used by this element.
    const probe = document.createElement("span");
    probe.textContent = "M".repeat(100);
    probe.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre;font:inherit;";
    el.appendChild(probe);
    const cw = probe.getBoundingClientRect().width / 100 || cellWidth;
    el.removeChild(probe);
    const ch = cellHeight;

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

  // (Re-)seed full buffer when dims change.
  React.useEffect(() => {
    const total = dims.cols * dims.rows;
    if (total === 0) return;
    const buf = new Array<string>(total);
    for (let i = 0; i < total; i++) buf[i] = pick();
    cellsRef.current = buf;
    setTick((t) => t + 1);
  }, [dims]);

  // Shimmer loop.
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

  const { cols, rows: rowCount } = dims;
  const rows = React.useMemo(() => {
    const out: React.ReactNode[] = [];
    const buf = cellsRef.current;
    if (cols > 0 && rowCount > 0 && buf.length === cols * rowCount) {
      for (let r = 0; r < rowCount; r++) {
        let line = "";
        for (let c = 0; c < cols; c++) line += buf[r * cols + c];
        out.push(
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
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, cols, rowCount, cellHeight]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={`relative overflow-hidden bg-neutral-950 font-mono text-[11px] leading-none text-neutral-300/70 ${className}`}
      data-tick={tick}
    >
      <div className="absolute inset-0 select-none" style={{ fontVariantLigatures: "none" }}>
        {rows}
      </div>
      {/* Soft inner vignette so the field feels recessed against the form */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 50%, transparent 60%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      {/* Subtle left-edge fade into the form column */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-16"
        style={{ background: "linear-gradient(to right, rgba(10,10,10,0.7), transparent)" }}
      />
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
