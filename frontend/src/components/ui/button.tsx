"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link" | "signal";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-[color:var(--neutral-50)] text-[color:var(--neutral-950)] hover:bg-white active:bg-[color:var(--neutral-100)] disabled:bg-[color:var(--neutral-700)] disabled:text-[color:var(--neutral-400)]",
  signal:
    "bg-[color:var(--signal)] text-white hover:bg-[color:var(--signal)]/90 active:bg-[color:var(--signal)]/80 disabled:bg-[color:var(--neutral-700)] disabled:text-[color:var(--neutral-400)]",
  secondary:
    "border border-[color:var(--border)] bg-[color:var(--bg-3)] text-[color:var(--text-primary)] hover:bg-[color:var(--bg-4)] hover:border-[color:var(--border-strong)]",
  ghost:
    "text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--text-primary)]",
  danger:
    "border border-[color:var(--acc-red)]/40 bg-[color:var(--acc-red-soft)] text-[color:var(--acc-red)] hover:bg-[color:var(--acc-red)]/20",
  link: "text-[color:var(--acc-blue)] underline-offset-2 hover:underline px-0",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 ",
  md: "h-9 px-3.5 text-sm gap-2 ",
  lg: "h-11 px-5 text-sm gap-2 ",
  icon: "h-8 w-8 ",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "secondary", size = "md", loading, className, children, disabled, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-medium tracking-tight transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-pure)] disabled:cursor-not-allowed disabled:opacity-60",
          variants[variant],
          sizes[size],
          className,
        )}
        {...rest}
      >
        {loading ? (
          <Spinner />
        ) : null}
        {children}
      </button>
    );
  },
);

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="12" cy="12" r="9" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 1-9 9"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
