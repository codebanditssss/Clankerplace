"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { OtpInput } from "@/components/otp-input";
import { validateEmail, validateOtp, validatePassword } from "@/lib/validation";

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetPasswordInner />
    </React.Suspense>
  );
}

type Step = "code" | "password";

function ResetPasswordInner() {
  const params = useSearchParams();
  const [email, setEmail] = React.useState(params.get("email") ?? "");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [step, setStep] = React.useState<Step>("code");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const eErr = validateEmail(email);
    if (eErr) {
      setError(eErr);
      return;
    }
    const cErr = validateOtp(code);
    if (cErr) {
      setError(cErr);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/verify-reset-otp", {
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
      setSubmitting(false);
      setStep("password");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const pErr = validatePassword(password);
    if (pErr) {
      setError(pErr);
      return;
    }
    if (password !== confirm) {
      setError("passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok?: true; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      // Reset endpoint also drops a fresh session cookie, so go straight in.
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const footer = (
    <>
      Need a new code?{" "}
      <Link
        href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}
        className="text-foreground underline-offset-4 hover:underline"
      >
        Send another →
      </Link>
    </>
  );

  if (step === "code") {
    return (
      <AuthCard
        eyebrow="Reset password · step 1 of 2"
        title="Enter your reset code"
        subtitle={
          email ? (
            <>
              We emailed a 6-digit code to{" "}
              <span className="text-foreground">{email}</span>. Enter it below.
            </>
          ) : (
            "Enter the email you used and the 6-digit code we sent."
          )
        }
        footer={footer}
      >
        <form onSubmit={verifyCode} className="space-y-4">
          {!params.get("email") && (
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
          <Button
            type="submit"
            variant="signal"
            size="lg"
            loading={submitting}
            disabled={submitting || code.length !== 6}
            className="w-full"
          >
            {submitting ? "" : "Verify code →"}
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Reset password · step 2 of 2"
      title="Choose a new password"
      subtitle="At least 8 characters. You'll be signed in after saving."
      footer={footer}
    >
      <form onSubmit={setNewPassword} className="space-y-3.5">
        <Field label="New password" hint="min 8 characters">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
          className="mt-1 w-full"
        >
          {submitting ? "" : "Save password →"}
        </Button>
      </form>
    </AuthCard>
  );
}
