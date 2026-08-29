"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut, KeyRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { KeyCap } from "./ui/keycap";

type Crumb = { label: string; href?: string };

export function TopNav({
  email,
  crumbs = [],
  onOpenPalette,
}: {
  email?: string;
  crumbs?: Crumb[];
  onOpenPalette?: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-pure)]/85 backdrop-blur">
      <div className="mx-auto flex h-[54px] max-w-7xl items-center justify-between gap-4 px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2">
            <Logo />
            <span className="text-sm font-semibold tracking-tight text-[color:var(--text-primary)]">
              FuelBorn
            </span>
          </Link>
          {crumbs.length > 0 && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-[color:var(--text-quaternary)]" strokeWidth={2} />
              <nav className="flex min-w-0 items-center gap-2 text-sm">
                {crumbs.map((c, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <ChevronRight
                        className="h-3.5 w-3.5 flex-none text-[color:var(--text-quaternary)]"
                        strokeWidth={2}
                      />
                    )}
                    {c.href ? (
                      <Link
                        href={c.href}
                        className="truncate text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--text-primary)]"
                      >
                        {c.label}
                      </Link>
                    ) : (
                      <span className="truncate font-medium text-[color:var(--text-primary)]">
                        {c.label}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onOpenPalette && (
            <button
              onClick={onOpenPalette}
              className="hidden items-center gap-2 border border-[color:var(--border)] bg-[color:var(--bg-2)] px-3 py-1.5 text-xs text-[color:var(--text-tertiary)] transition-colors hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--text-secondary)] sm:flex"
            >
              <span>Search</span>
              <span className="flex items-center gap-1" aria-hidden="true">
                <KeyCap className="min-w-[2.25rem]">Ctrl</KeyCap>
                <KeyCap>K</KeyCap>
              </span>
            </button>
          )}
          {email && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-2 py-1.5 text-xs text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-3)]"
              >
                <Avatar email={email} />
                <span className="hidden sm:inline-block max-w-[180px] truncate">{email}</span>
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-40 mt-1.5 w-56 overflow-hidden border border-[color:var(--border)] bg-[color:var(--bg-2)] shadow-[var(--shadow-pop)]">
                    <div className="border-b border-[color:var(--border-subtle)] px-3 py-2">
                      <div className="text-xs text-[color:var(--text-quaternary)]">
                        Signed in as
                      </div>
                      <div className="truncate text-sm text-[color:var(--text-primary)]">
                        {email}
                      </div>
                    </div>
                    <MenuItem
                      icon={<KeyRound className="h-3.5 w-3.5" />}
                      label="Account settings"
                      hint="soon"
                      disabled
                    />
                    <MenuItem
                      icon={<LogOut className="h-3.5 w-3.5" />}
                      label="Sign out"
                      onClick={async () => {
                        await fetch("/api/auth/logout", { method: "POST" });
                        window.location.assign("/login");
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-[color:var(--text-secondary)] transition-colors",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-[color:var(--bg-3)] hover:text-[color:var(--text-primary)]",
      )}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {hint && (
        <span className="text-[10px] text-[color:var(--text-quaternary)]">{hint}</span>
      )}
    </button>
  );
}

function Avatar({ email }: { email: string }) {
  const letter = email[0].toUpperCase();
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--bg-3)] text-[10px] font-semibold text-[color:var(--text-secondary)]">
      {letter}
    </div>
  );
}

function Logo() {
  return (
    <Image
      src="/logo-128.png"
      alt=""
      width={128}
      height={128}
      priority
      className="h-12 w-12"
    />
  );
}
