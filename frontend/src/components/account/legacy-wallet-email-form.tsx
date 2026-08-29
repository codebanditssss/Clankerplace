"use client";

import { useState } from "react";
import { Check, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

type Phase = "details" | "code" | "done";

export function LegacyWalletEmailForm() {
  const [phase, setPhase] = useState<Phase>("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(action: "start" | "confirm") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/account/email-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, email, password, code }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "request failed");
        return;
      }
      if (action === "start") {
        setPhase("code");
        return;
      }
      setPhase("done");
      window.setTimeout(() => window.location.reload(), 800);
    } finally {
      setLoading(false);
    }
  }

  if (phase === "done") {
    return (
      <div className="flex items-center gap-2 border border-live/30 bg-live/10 px-3 py-2 text-[12px] text-live">
        <Check className="h-3.5 w-3.5" />
        Email login enabled.
      </div>
    );
  }

  return (
    <div className="space-y-3 border border-hairline bg-neutral-950 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={phase === "code" || loading}
          />
        </Field>
        {phase === "details" ? (
          <Field label="Password">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </Field>
        ) : (
          <Field label="Verification code">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={loading}
            />
          </Field>
        )}
      </div>
      {error ? <p className="text-[11px] text-error">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {phase === "details" ? (
          <Button
            type="button"
            variant="signal"
            size="sm"
            loading={loading}
            onClick={() => void submit("start")}
          >
            <Mail className="h-3.5 w-3.5" />
            Send code
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="signal"
              size="sm"
              loading={loading}
              onClick={() => void submit("confirm")}
            >
              <Check className="h-3.5 w-3.5" />
              Enable email login
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => void submit("start")}
            >
              Resend code
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
