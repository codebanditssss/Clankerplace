"use client";

import * as React from "react";

export function FuelGauge({ value, compact = false, className = "" }: { value: number; compact?: boolean; className?: string }) {
  const safe = Math.max(0, Math.min(100, value));
  const tone = safe <= 10 ? "critical" : safe <= 30 ? "low" : "good";
  if (compact) {
    return (
      <div className={`cp-fuel-inline ${className}`} data-tone={tone} aria-label={`${safe.toFixed(1)} percent fuel remaining`}>
        <span className="cp-fuel-track"><span style={{ transform: `scaleX(${safe / 100})` }} /></span>
        <span className="cp-mono">{safe.toFixed(1)}%</span>
      </div>
    );
  }
  const angle = -135 + safe * 2.7;
  return (
    <div className={`cp-gauge ${className}`} data-tone={tone} aria-label={`${safe.toFixed(1)} percent fuel remaining`}>
      <svg viewBox="0 0 220 150" role="img">
        <path className="cp-gauge-rail" d="M34 124a84 84 0 1 1 152 0" />
        <path className="cp-gauge-live" d="M34 124a84 84 0 1 1 152 0" pathLength="100" strokeDasharray={`${safe} 100`} />
        <g className="cp-gauge-needle" style={{ transform: `rotate(${angle}deg)` }}>
          <path d="M110 119V47" />
          <path className="cp-needle-flame" d="M110 47c-11-8-4-21 3-29 .4 8 11 11 8 21-1.5 4-5 7-11 8Z" />
        </g>
        <circle cx="110" cy="119" r="8" className="cp-gauge-pivot" />
        <text x="23" y="143">E</text><text x="190" y="143">F</text>
      </svg>
      <strong className="cp-mono">{safe.toFixed(1)} FUEL</strong>
    </div>
  );
}

export function useLiveFuel(initial: number, burnPerHour = 1) {
  const [fuel, setFuel] = React.useState(initial);
  React.useEffect(() => {
    const tick = window.setInterval(() => setFuel((current) => Math.max(0, current - burnPerHour / 3600)), 1000);
    return () => window.clearInterval(tick);
  }, [burnPerHour]);
  return [fuel, setFuel] as const;
}
