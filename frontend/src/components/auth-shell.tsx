"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { Input, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GlyphField } from "@/components/glyph-field";

export function AuthShell({
  mode,
  title,
  subtitle,
  switchHref,
  switchHrefLabel,
  switchPrefix,
  onSubmit,
  submitting,
  error,
  minPassword,
  forgotHref,
  showGlyph,
}: {
  mode: "signin" | "signup";
  title: string;
  subtitle: string;
  switchHref: string;
  switchHrefLabel: string;
  switchPrefix: string;
  onSubmit: (email: string, password: string) => Promise<void>;
  submitting: boolean;
  error: string | null;
  minPassword?: number;
  /** When provided (login mode), render a "Forgot password?" link below the password field. */
  forgotHref?: string;
  /** Render the Inception-style full-bleed split layout with the ASCII glyph field. */
  showGlyph?: boolean;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // Inception-styled split layout (login)
  if (showGlyph) {
    return (
      <main className="relative min-h-dvh overflow-hidden bg-neutral-950 text-foreground">
        {/* Top nav: logo left, account switcher right. */}
        <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-8 py-6 lg:px-12">
          <Link
            href="/"
            className="flex items-baseline gap-2 text-[20px] font-semibold tracking-tight"
            aria-label="FuelBorn home"
          >
            <Wordmark />
            <span>
              Fuel<span className="text-signal">Born</span>
            </span>
          </Link>
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em]">
            <span className="hidden text-neutral-300 sm:inline">
              {switchPrefix}
            </span>
            <Link
              href={switchHref}
              className="text-signal underline-offset-4 hover:underline"
            >
              {switchHrefLabel} →
            </Link>
          </div>
        </header>

        {/* 50/50 split */}
        <div className="relative grid min-h-dvh grid-cols-1 lg:grid-cols-2">
          {/* LEFT: headline + form stack */}
          <div className="flex flex-col justify-center px-8 pb-12 pt-28 lg:px-16 lg:pt-32">
            <div className="max-w-[560px]">
              <span className="micro mb-6 inline-block text-neutral-400">
                01 · {mode === "signin" ? "Return" : "Begin"}
              </span>
              <h1 className="text-[clamp(2.75rem,5.5vw,4.5rem)] font-semibold leading-[0.95] tracking-tight">
                One-click{" "}
                <span className="editorial-italic text-signal">pods</span>
                <br />
                for AI agents<span className="text-signal">.</span>
              </h1>
              <p className="mt-7 max-w-md text-[15px] leading-relaxed text-neutral-400">
                Self-hosted launchpad for containerized AI agents and dev
                environments. Pick a template, hit deploy, get a URL — your VM,
                your data, your runtime.
              </p>

              {/* Form — styled as the Inception input row + hairline-separated rows */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await onSubmit(email, password);
                }}
                className="mt-10"
              >
                <OAuthRow mode={mode} />

                {/* Email row — primary input with floating submit on the right */}
                <div className="group flex items-stretch border border-hairline bg-neutral-900 transition-colors focus-within:border-signal/60">
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    aria-label="Email"
                    className="min-w-0 flex-1 bg-transparent px-5 py-4 text-[15px] text-foreground placeholder:text-neutral-400 focus:outline-none"
                  />
                </div>

                {/* Password row */}
                <div className="mt-3 flex items-stretch border border-hairline bg-neutral-900 transition-colors focus-within:border-signal/60">
                  <input
                    type="password"
                    required
                    minLength={minPassword}
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    aria-label="Password"
                    className="min-w-0 flex-1 bg-transparent px-5 py-4 text-[15px] text-foreground placeholder:text-neutral-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    aria-label={mode === "signin" ? "Sign in" : "Create account"}
                    className="grid w-14 place-items-center bg-signal text-neutral-950 transition-colors hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? <SpinnerDark /> : <ArrowUp />}
                  </button>
                </div>

                {error && (
                  <div className="mt-3 border border-error/30 bg-error-soft px-4 py-2.5 text-[12px] text-error">
                    {error}
                  </div>
                )}

                {forgotHref && (
                  <div className="mt-3 text-right">
                    <Link
                      href={forgotHref}
                      className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-400 underline-offset-4 hover:text-signal hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                )}

                {/* Auth switcher — pulled up next to the form so the
                    register/sign-in path is obvious without scrolling. */}
                <div className="mt-4 flex items-center justify-between border-y border-hairline py-3">
                  <span className="text-[13px] text-neutral-300">
                    {switchPrefix}
                  </span>
                  <Link
                    href={switchHref}
                    className="font-mono text-[12px] uppercase tracking-[0.12em] text-signal underline-offset-4 hover:underline"
                  >
                    {switchHrefLabel} →
                  </Link>
                </div>

                {/* Inception-style suggestion rows — reframed as "what you get" */}
                <ul className="mt-8 border-t border-hairline">
                  <Row ordinal="01" label="Hermes Agent · Ubuntu sandbox" />
                  <Row ordinal="02" label="30-second deploys · live metrics" />
                  <Row ordinal="03" label="BYO provider key · self-hosted" />
                </ul>
              </form>
            </div>
          </div>

          {/* RIGHT: ASCII glyph field */}
          <div className="relative hidden border-l border-hairline lg:block">
            <div className="absolute right-6 top-6 z-10 flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
              <span className="inline-block h-1.5 w-1.5 bg-signal" aria-hidden />
              Agent noise / live
            </div>
            <div className="absolute bottom-6 left-6 z-10 font-mono text-[10px] uppercase tracking-wider text-neutral-600">
              02 · Environments
            </div>
            <GlyphField className="h-full w-full" />
          </div>
        </div>
      </main>
    );
  }

  // Original layout (signup)
  return (
    <main className="relative min-h-dvh overflow-hidden bg-neutral-950 text-foreground">
      <div className="halo-hero pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex min-h-dvh max-w-[1200px] flex-col px-6 py-10 lg:flex-row lg:items-stretch lg:px-12">
        <header className="flex items-center justify-between border-b border-hairline pb-6 lg:absolute lg:inset-x-12 lg:top-10 lg:border-0 lg:pb-0">
          <Link
            href="/"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
            aria-label="FuelBorn home"
          >
            <Wordmark />
            Fuel<span className="text-signal">Born</span>
          </Link>
          <span className="micro hidden text-neutral-500 sm:inline">
            {mode === "signin" ? "Console / sign in" : "Console / create account"}
          </span>
        </header>

        <aside className="hidden flex-1 flex-col justify-end pb-2 pr-12 lg:flex">
          <div className="max-w-md">
            <span className="micro text-neutral-400">
              {mode === "signin" ? "01 · Return" : "01 · Begin"}
            </span>
            <h2 className="display mt-4 text-[clamp(2.25rem,4vw,3.5rem)] text-foreground">
              One-click
              <br />
              pods for{" "}
              <span className="editorial-italic text-signal">AI agents</span>.
            </h2>
            <p className="mt-6 max-w-sm text-[14px] leading-relaxed text-neutral-300">
              Pick a template, hit deploy, get a URL. Self-hosted launchpad for
              containerized AI agents and dev environments — your VM, your data,
              your runtime.
            </p>
            <hr className="hairline mt-10 max-w-xs" />
            <dl className="mt-6 grid max-w-sm grid-cols-3 gap-6 font-mono text-[11px] tabular">
              <div>
                <dt className="text-neutral-500">TEMPLATES</dt>
                <dd className="mt-1 text-[18px] text-foreground">04</dd>
              </div>
              <div>
                <dt className="text-neutral-500">DEPLOY</dt>
                <dd className="mt-1 text-[18px] text-foreground">~30s</dd>
              </div>
              <div>
                <dt className="text-neutral-500">RUNTIME</dt>
                <dd className="mt-1 text-[18px] text-foreground">linux</dd>
              </div>
            </dl>
          </div>
        </aside>

        <section className="flex flex-1 items-center justify-center pt-12 lg:pt-0">
          <div className="w-full max-w-[400px]">
            <div className="border border-hairline bg-neutral-900">
              <div className="space-y-5 px-7 pb-7 pt-8">
                <header>
                  <span className="micro text-neutral-500">
                    {mode === "signin" ? "Sign in" : "Create account"}
                  </span>
                  <h1 className="display mt-3 text-[28px] leading-tight">
                    {title}
                  </h1>
                  <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">
                    {subtitle}
                  </p>
                </header>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await onSubmit(email, password);
                  }}
                  className="space-y-3.5 pt-2"
                >
                  <OAuthRow mode={mode} />
                  <Field label="Email">
                    <Input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </Field>
                  <Field
                    label="Password"
                    hint={minPassword ? `min ${minPassword} characters` : undefined}
                  >
                    <Input
                      type="password"
                      required
                      minLength={minPassword}
                      autoComplete={
                        mode === "signin" ? "current-password" : "new-password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </Field>
                  {error && (
                    <div className="border border-error/30 bg-error-soft px-3 py-2 text-[12px] text-error">
                      {error}
                    </div>
                  )}
                  <Button
                    type="submit"
                    variant="signal"
                    size="lg"
                    loading={submitting}
                    className="mt-2 w-full"
                  >
                    {submitting
                      ? ""
                      : mode === "signin"
                        ? "Sign in →"
                        : "Create account →"}
                  </Button>
                </form>
              </div>

              <div className="border-t border-hairline bg-neutral-950/40 px-7 py-3.5 text-[12px] text-neutral-400">
                {switchPrefix}{" "}
                <Link
                  href={switchHref}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  {switchHrefLabel} →
                </Link>
              </div>
            </div>

            <p className="micro mt-6 text-center text-neutral-500">
              Hermes Agent · Ubuntu sandbox · BYO provider key
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Row({ ordinal, label }: { ordinal: string; label: string }) {
  return (
    <li className="flex items-center gap-4 border-b border-hairline px-1 py-4 text-[14px] text-neutral-300">
      <span className="font-mono text-[11px] tracking-wider text-signal">{ordinal}</span>
      <span>{label}</span>
    </li>
  );
}

function OAuthRow({ mode }: { mode: "signin" | "signup" }) {
  const label = mode === "signin" ? "Sign in with" : "Continue with";
  return (
    <div>
      <div className="grid grid-cols-2 gap-px border border-neutral-700 bg-neutral-700">
        <a
          href="/api/auth/oauth/google/start"
          aria-label={`${label} Google`}
          className="group flex items-center justify-center gap-2 bg-neutral-900 px-3 py-3.5 text-[13px] text-neutral-200 transition-colors hover:bg-neutral-800"
        >
          <GoogleGlyph />
          <span>Google</span>
        </a>
        <a
          href="/api/auth/oauth/github/start"
          aria-label={`${label} GitHub`}
          className="group flex items-center justify-center gap-2 bg-neutral-900 px-3 py-3.5 text-[13px] text-neutral-200 transition-colors hover:bg-neutral-800"
        >
          <GithubGlyph />
          <span>GitHub</span>
        </a>
      </div>
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-neutral-700" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
          or with email
        </span>
        <span className="h-px flex-1 bg-neutral-700" />
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20.4H24v7.2h11.3c-1.5 4.2-5.5 7.2-11.3 7.2-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.1-5.1C33.6 5.5 29.1 3.6 24 3.6 12.7 3.6 3.6 12.7 3.6 24S12.7 44.4 24 44.4c11.5 0 20.4-8.3 20.4-20.4 0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l5.9 4.3C13.8 15.2 18.6 12.4 24 12.4c3.1 0 5.8 1.2 7.9 3l5.1-5.1C33.6 6.7 29.1 4.8 24 4.8 16.6 4.8 10.2 9 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44.4c5 0 9.5-1.9 12.9-5l-6-4.9c-2 1.4-4.4 2.2-6.9 2.2-5.7 0-10.6-3.6-12.4-8.7l-6 4.6C8.9 39.5 15.9 44.4 24 44.4z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20.4H24v7.2h11.3c-.7 2-2 3.7-3.6 5l6 4.9c-.4.4 6.5-4.7 6.5-13.5 0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

function GithubGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.16c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 015.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
    </svg>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <Image
      src="/logo-128.png"
      alt=""
      width={128}
      height={128}
      priority
      className={className ?? "h-12 w-12"}
    />
  );
}

function ArrowUp() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function SpinnerDark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      className="animate-spin"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="40 16"
        strokeLinecap="round"
      />
    </svg>
  );
}
