"use client";

import * as React from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { validateEmail } from "@/lib/validation";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const err = validateEmail(email);
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok?: true; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  if (sent) {
    const params = new URLSearchParams({ email });
    return (
      <AuthCard
        eyebrow="Reset password"
        title="Check your inbox"
        subtitle={
          <>
            If an account exists for{" "}
            <span className="text-foreground">{email}</span>, a 6-digit code is
            on its way. It expires in 10 minutes.
          </>
        }
        footer={
          <>
            Remembered it?{" "}
            <Link
              href="/login"
              className="text-foreground underline-offset-4 hover:underline"
            >
              Back to sign in →
            </Link>
          </>
        }
      >
        <Link
          href={`/reset-password?${params.toString()}`}
          className="inline-flex h-11 w-full items-center justify-center bg-signal px-5 text-[14px] font-medium text-neutral-950 transition-colors hover:bg-signal/90"
        >
          Enter the code →
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Reset password"
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a 6-digit code to reset it."
      footer={
        <>
          Remembered it?{" "}
          <Link
            href="/login"
            className="text-foreground underline-offset-4 hover:underline"
          >
            Back to sign in →
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="h-11 w-full border border-hairline bg-neutral-950 px-4 text-[14px] focus:border-signal/60 focus:outline-none"
          aria-label="Email"
        />
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
          className="w-full"
        >
          {submitting ? "" : "Send reset code →"}
        </Button>
      </form>
    </AuthCard>
  );
}
