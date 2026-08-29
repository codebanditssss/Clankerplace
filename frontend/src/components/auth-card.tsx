"use client";

// Minimal centered card used by the secondary auth pages
// (/verify-email, /forgot-password, /reset-password). Mirrors the look of
// the non-glyph branch of <AuthShell> but is laid out for short forms
// and doesn't repeat the marketing copy.

import * as React from "react";
import Image from "next/image";
import Link from "next/link";

export function AuthCard({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-neutral-950 text-foreground">
      <div className="halo-hero pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-dvh max-w-[1200px] flex-col px-6 py-10 lg:px-12">
        <header className="flex items-center justify-between border-b border-hairline pb-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
            aria-label="FuelBorn home"
          >
            <Image
              src="/logo-128.png"
              alt=""
              width={128}
              height={128}
              priority
              className="h-12 w-12 shrink-0"
            />
            Fuel<span className="text-signal">Born</span>
          </Link>
          <span className="micro hidden text-neutral-500 sm:inline">
            Console / {eyebrow.toLowerCase()}
          </span>
        </header>

        <section className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[440px]">
            <div className="border border-hairline bg-neutral-900">
              <div className="space-y-5 px-7 pb-7 pt-8">
                <header>
                  <span className="micro text-neutral-500">{eyebrow}</span>
                  <h1 className="display mt-3 text-[26px] leading-tight">
                    {title}
                  </h1>
                  {subtitle && (
                    <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">
                      {subtitle}
                    </p>
                  )}
                </header>
                {children}
              </div>
              {footer && (
                <div className="border-t border-hairline bg-neutral-950/40 px-7 py-3.5 text-[12px] text-neutral-400">
                  {footer}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
