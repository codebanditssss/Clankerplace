"use client";

// Persona tab for Hermes pods.
//
// Mirrors ~/.hermes/SOUL.md (the user-owned persona) into a textarea.
// Below it, /home/container/AGENTS.md — the platform-owned operating
// notes (mailbox address, future capabilities) — is shown read-only so
// the user can see what extras the agent gets without being able to
// break them. AGENTS.md is rewritten on every deploy from pod state.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Sparkles, Eye, EyeOff } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea, Hint } from "@/components/ui/input";

type PersonaResponse = {
  persona: string;
  managed: string;
  error?: string;
};

export default function PersonaTab({
  identifier,
  installed,
}: {
  identifier: string;
  installed: boolean;
}) {
  const [persona, setPersona] = useState("");
  const [managed, setManaged] = useState("");
  const [serverPersona, setServerPersona] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showManaged, setShowManaged] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/pods/${identifier}/persona`, {
        cache: "no-store",
      });
      const d = (await r.json()) as PersonaResponse;
      if (!r.ok) {
        setLoadErr(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setLoadErr(null);
      setPersona(d.persona);
      setServerPersona(d.persona);
      setManaged(d.managed);
      setLoaded(true);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [identifier]);

  useEffect(() => {
    if (!installed) return;
    refresh();
  }, [installed, refresh]);

  const dirty = persona !== serverPersona;

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/pods/${identifier}/persona`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      const d = (await r.json()) as { ok?: true; error?: string };
      if (!r.ok || !d.ok) {
        toast.error(d.error ?? `Save failed: HTTP ${r.status}`);
        return;
      }
      toast.success("Persona saved — Hermes picks it up on the next message.");
      setServerPersona(persona);
    } finally {
      setSaving(false);
    }
  }

  if (!installed) {
    return (
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        Pod is still installing — persona editor unlocks when the agent is live.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-none items-center justify-center border border-[color:var(--border)] bg-[color:var(--bg-3)]">
              <Sparkles className="h-4 w-4 text-[color:var(--acc-purple)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-tight">
                Persona
              </div>
              <p className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">
                Hermes reads <code>~/.hermes/SOUL.md</code> fresh on every
                message. Anything you write here becomes the agent&apos;s tone,
                voice, and behavior.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {loadErr ? (
            <div className="border border-[color:var(--acc-red)]/30 bg-[color:var(--acc-red-soft)] px-2.5 py-2 text-[12px] text-[color:var(--acc-red)]">
              {loadErr}
            </div>
          ) : !loaded ? (
            <div className="flex items-center gap-2 text-[12px] text-[color:var(--text-tertiary)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading persona…
            </div>
          ) : (
            <>
              <Textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                rows={14}
                placeholder={`You are a warm, playful assistant who uses kaomoji occasionally.\n\n(or)\n\nYou are a concise technical expert. No fluff, just facts.\n\n(or)\n\nYou speak like a friendly coworker who happens to know everything.`}
                className="font-mono text-[12px] leading-relaxed"
              />
              <Hint>
                Plain markdown. Saves restart nothing — the next message picks
                up the new persona.
              </Hint>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={saving}
                  disabled={!dirty}
                  onClick={save}
                >
                  <Save className="h-3 w-3" /> Save persona
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!dirty || saving}
                  onClick={() => setPersona(serverPersona)}
                >
                  Reset
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {managed && (
        <Card>
          <CardHeader>
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
                  Capabilities (AGENTS.md)
                </div>
                <p className="mt-0.5 text-[11px] text-[color:var(--text-tertiary)]">
                  Platform-owned operating notes Hermes auto-loads from{" "}
                  <code>/home/container/AGENTS.md</code>. Read-only —
                  rewritten on every deploy.
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManaged((s) => !s)}
            >
              {showManaged ? (
                <>
                  <EyeOff className="h-3 w-3" /> Hide
                </>
              ) : (
                <>
                  <Eye className="h-3 w-3" /> Show
                </>
              )}
            </Button>
          </CardHeader>
          {showManaged && (
            <CardBody>
              <pre className="whitespace-pre-wrap border border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] p-3 font-mono text-[11px] leading-relaxed text-[color:var(--text-secondary)]">
                {managed}
              </pre>
            </CardBody>
          )}
        </Card>
      )}
    </div>
  );
}
