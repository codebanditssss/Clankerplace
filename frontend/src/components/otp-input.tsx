"use client";

// 6-digit OTP input. Renders six boxed inputs, advances focus on type,
// retreats on backspace, accepts paste of the full code. Reports the
// joined string to the parent via onChange. Stays controlled.

import * as React from "react";

const LEN = 6;

export function OtpInput({
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = React.useMemo(() => {
    const padded = value.padEnd(LEN, " ");
    return Array.from({ length: LEN }, (_, i) => padded[i].trim());
  }, [value]);

  React.useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function setAt(i: number, char: string) {
    const next = digits.slice();
    next[i] = char;
    onChange(next.join("").slice(0, LEN));
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (digits[i]) {
        // First backspace clears the current cell.
        e.preventDefault();
        setAt(i, "");
      } else if (i > 0) {
        // Empty cell: jump back and clear the previous one.
        e.preventDefault();
        const prev = i - 1;
        const next = digits.slice();
        next[prev] = "";
        onChange(next.join("").slice(0, LEN));
        refs.current[prev]?.focus();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < LEN - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  }

  function onInput(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "");
    if (!raw) {
      setAt(i, "");
      return;
    }
    // Handle paste of full code into a single cell.
    if (raw.length >= 2) {
      const candidate = (digits.slice(0, i).join("") + raw).slice(0, LEN);
      onChange(candidate);
      const focusIdx = Math.min(i + raw.length, LEN - 1);
      refs.current[focusIdx]?.focus();
      return;
    }
    setAt(i, raw[0]);
    if (i < LEN - 1) refs.current[i + 1]?.focus();
  }

  return (
    <div className="flex items-stretch justify-between gap-2" role="group" aria-label="One-time code">
      {Array.from({ length: LEN }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          disabled={disabled}
          value={digits[i] ?? ""}
          onChange={(e) => onInput(i, e)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          className="h-14 w-full flex-1 border border-hairline bg-neutral-950 text-center font-mono text-[22px] tabular tracking-wider text-foreground focus:border-signal/60 focus:outline-none disabled:opacity-50"
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
}
