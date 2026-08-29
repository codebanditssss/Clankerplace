"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/otp-input";
import { validateOtp } from "@/lib/validation";

const RESEND_COOLDOWN = 30;

export default function VerifyEmailPage() {
  return (
    // Suspense is required to read useSearchParams in Next 16 client pages
    // (it puts the read in a streaming boundary).
    <React.Suspense fallback={null}>
      <VerifyEmailInner />
    </React.Suspense>
  );
}

function VerifyEmailInner() {
  const params = useSearchParams();
  const emailFromQuery = params.get("email") ?? "";
  const autoResend = params.get("resend") === "1";

  const [email, setEmail] = React.useState(emailFromQuery);
  const [code, setCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const triggerResend = React.useCallback(
    async (silent = false) => {
      if (!email) return;
      setResending(true);
      setError(null);
      if (!silent) setInfo(null);
      try {
        const res = await fetch("/api/auth/resend-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = (await res.json()) as { ok?: true; error?: string };
        if (!res.ok || !data.ok) {
          setError(data.error ?? `HTTP ${res.status}`);
        } else {
          setInfo("A new code is on its way.");
          setCooldown(RESEND_COOLDOWN);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setResending(false);
      }
    },
    [email],
  );

  const autoResendFired = React.useRef(false);
  React.useEffect(() => {
    if (autoResend && email && !autoResendFired.current) {
      autoResendFired.current = true;
      void triggerResend(true);
    }
  }, [autoResend, email, triggerResend]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const codeErr = validateOtp(code);
    if (codeErr) {
      setError(codeErr);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await res.json()) as { ok?: true; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      eyebrow="Verify email"
      title="Check your inbox"
      subtitle={
        email ? (
          <>
            We sent a 6-digit code to{" "}
            <span className="text-foreground">{email}</span>. It expires in 10
            minutes.
          </>
        ) : (
          <>Enter the email you signed up with, then the 6-digit code we sent.</>
        )
      }
      footer={
        <>
          Wrong address?{" "}
          <Link
            href="/signup"
            className="text-foreground underline-offset-4 hover:underline"
          >
            Start over →
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {!emailFromQuery && (
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-10 w-full border border-hairline bg-neutral-950 px-3 text-[14px] focus:border-signal/60 focus:outline-none"
            aria-label="Email"
          />
        )}

        <OtpInput value={code} onChange={setCode} autoFocus />

        {error && (
          <div className="border border-error/30 bg-error-soft px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}
        {info && !error && (
          <div className="border border-hairline bg-neutral-950 px-3 py-2 text-[12px] text-neutral-300">
            {info}
          </div>
        )}

        <Button
          type="submit"
          variant="signal"
          size="lg"
          loading={submitting}
          className="w-full"
          disabled={submitting || code.length !== 6}
        >
          {submitting ? "" : "Verify and continue →"}
        </Button>

        <div className="flex items-center justify-between border-t border-hairline pt-3 text-[12px] text-neutral-400">
          <span>Didn't get it?</span>
          <button
            type="button"
            disabled={resending || cooldown > 0 || !email}
            onClick={() => triggerResend(false)}
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-neutral-500 disabled:no-underline"
          >
            {cooldown > 0
              ? `Resend in ${cooldown}s`
              : resending
                ? "Sending…"
                : "Resend code"}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
