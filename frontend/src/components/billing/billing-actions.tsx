"use client";

import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ButtonVariant = ComponentProps<typeof Button>["variant"];
type ButtonSize = ComponentProps<typeof Button>["size"];

type CheckoutResponse = {
  checkout_url?: string;
  portal_url?: string;
  error?: string;
  message?: string;
};

export function SubscriptionCheckoutButton({
  plan,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  plan: "developer" | "pro" | "scale";
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <RedirectButton
      endpoint="/api/billing/checkout"
      body={{ plan }}
      variant={variant}
      size={size}
      className={className}
    >
      {children}
    </RedirectButton>
  );
}

export function CreditPackCheckoutButton({
  pack,
  children,
  variant = "secondary",
  size = "sm",
  className,
}: {
  pack: "credit_10" | "credit_25" | "credit_50" | "credit_100";
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <RedirectButton
      endpoint="/api/billing/credits/checkout"
      body={{ pack }}
      variant={variant}
      size={size}
      className={className}
    >
      {children}
    </RedirectButton>
  );
}

export function BillingPortalButton({
  children = "Manage billing",
  variant = "secondary",
  size = "sm",
  className,
}: {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <RedirectButton
      endpoint="/api/billing/portal"
      variant={variant}
      size={size}
      className={className}
    >
      {children}
    </RedirectButton>
  );
}

function RedirectButton({
  endpoint,
  body,
  children,
  variant,
  size,
  className,
}: {
  endpoint: string;
  body?: Record<string, string>;
  children: ReactNode;
  variant: ButtonVariant;
  size: ButtonSize;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) {
        const next =
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search}`
            : "/billing";
        router.push(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as CheckoutResponse;
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? `Request failed (${res.status})`);
      }
      const url = json.checkout_url ?? json.portal_url;
      if (!url) throw new Error("Payment session did not include a redirect URL.");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => void submit()}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CreditCard className="h-3 w-3" />}
        {children}
        {!busy ? <ExternalLink className="h-3 w-3" /> : null}
      </Button>
      {error ? <span className="max-w-[18rem] text-[11px] text-error">{error}</span> : null}
    </span>
  );
}
