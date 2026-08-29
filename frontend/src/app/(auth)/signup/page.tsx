"use client";
import { useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { validateEmail, validatePassword } from "@/lib/validation";

export default function SignupPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(email: string, password: string) {
    setError(null);
    const eErr = validateEmail(email);
    if (eErr) {
      setError(eErr);
      return;
    }
    const pErr = validatePassword(password);
    if (pErr) {
      setError(pErr);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { ok?: true; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      const params = new URLSearchParams({ email });
      window.location.assign(`/verify-email?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      mode="signup"
      title="Create your account"
      subtitle="Spin up Hermes Agent in your own Ubuntu sandbox."
      switchHref="/login"
      switchHrefLabel="Sign in"
      switchPrefix="Already have one?"
      onSubmit={onSubmit}
      submitting={submitting}
      error={error}
      minPassword={8}
      showGlyph
    />
  );
}
