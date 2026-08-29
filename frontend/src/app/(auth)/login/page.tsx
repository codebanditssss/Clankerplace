"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { validateEmail, validatePassword } from "@/lib/validation";

const OAUTH_ERRORS: Record<string, string> = {
  oauth_denied: "Sign-in cancelled. Try again or use email and password.",
  oauth_state:
    "The sign-in link expired or didn't match. Start the sign-in again.",
  oauth_missing_params: "Provider returned an incomplete response — try again.",
  oauth_exchange:
    "Couldn't reach the provider to finish signing you in. Try again in a moment.",
  oauth_link:
    "We couldn't link your account. If this keeps happening, sign up with email and password.",
  oauth_provider: "The provider rejected the sign-in. Try again.",
  oauth_not_configured: "This sign-in method isn't enabled on this server.",
};

export default function LoginPage() {
  // useSearchParams() forces a CSR bailout at build time; wrap the
  // page body in <Suspense> so Next.js prerender stops blaming us.
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useSearchParams();

  // Surface OAuth callback errors (?error=oauth_*) as the form error.
  useEffect(() => {
    const code = search?.get("error");
    if (code && OAUTH_ERRORS[code]) setError(OAUTH_ERRORS[code]);
    else if (code) setError(`Sign-in error: ${code}`);
  }, [search]);

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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as {
        ok?: true;
        error?: string;
        code?: "unverified" | "invalid";
      };
      if (!res.ok || !data.ok) {
        if (data.code === "unverified") {
          // Funnel back into the verification flow so they can finish.
          const params = new URLSearchParams({ email, resend: "1" });
          window.location.assign(`/verify-email?${params.toString()}`);
          return;
        }
        setError(data.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      const next = new URL(window.location.href).searchParams.get("next");
      window.location.assign(safeNextPath(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      mode="signin"
      title="Sign in"
      subtitle="Manage your Clankers, work, and fuel."
      switchHref="/signup"
      switchHrefLabel="Create one"
      switchPrefix="No account?"
      onSubmit={onSubmit}
      submitting={submitting}
      error={error}
      forgotHref="/forgot-password"
      showGlyph
    />
  );
}

function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  try {
    const parsed = new URL(next, window.location.origin);
    if (parsed.origin !== window.location.origin) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
