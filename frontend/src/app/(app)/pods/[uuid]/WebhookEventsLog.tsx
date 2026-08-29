"use client";

// Lightweight inspector for webhook events received at a path. Tails the
// shared Caddy access log via /api/pods/<uuid>/webhooks/events, filters
// down to one connector's webhookPath prefix, and renders the most
// recent N hits. Polls every 5s so the user gets near-real-time
// feedback right inside the connector card.
//
// Status colouring: 2xx green, 4xx amber (most often signature
// rejected), 5xx red (Hermes adapter not yet running / crashed).
import { useEffect, useState } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";

type Event = {
  ts: number;
  method: string;
  path: string;
  status: number;
  size: number;
  duration_ms: number;
  remote_ip: string;
  user_agent: string;
  signature: string | null;
};

export default function WebhookEventsLog({
  identifier,
  pathPrefix,
}: {
  identifier: string;
  /** Filter events to this path prefix (e.g. "/webhooks", "/telegram", "/v1") */
  pathPrefix: string;
}) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await fetch(
          `/api/pods/${identifier}/webhooks/events?limit=20&path=${encodeURIComponent(pathPrefix)}`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const d = (await r.json()) as { events: Event[] };
        if (!cancelled) setEvents(d.events);
      } catch {
        /* network blip — keep last value */
      }
    }
    refresh();
    const t = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [identifier, pathPrefix]);

  const count = events?.length ?? 0;
  const latest = events?.[0];

  return (
    <div className="mt-2 border border-[color:var(--border)] bg-[color:var(--bg-2)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[color:var(--bg-3)]"
      >
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-[color:var(--text-tertiary)]" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--text-secondary)]">
            Recent events
          </span>
          <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--bg-3)] px-1.5 text-[10px] text-[color:var(--text-tertiary)]">
            {events === null ? "…" : count}
          </span>
          {latest && !expanded && (
            <span className="ml-1 truncate font-mono text-[10px] text-[color:var(--text-quaternary)]">
              last:{" "}
              <StatusPill status={latest.status} />{" "}
              {timeAgo(latest.ts)}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-[color:var(--text-tertiary)]" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-[color:var(--text-tertiary)]" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-[color:var(--border-subtle)] px-3 py-2">
          {events === null ? (
            <p className="text-[11px] text-[color:var(--text-quaternary)]">
              Loading…
            </p>
          ) : events.length === 0 ? (
            <p className="text-[11px] text-[color:var(--text-quaternary)]">
              No events yet. Send a request to the URL above to see it appear
              here within ~5s.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {events.map((e, i) => (
                <li
                  key={`${e.ts}-${i}`}
                  className="flex items-center gap-2 px-1.5 py-1 font-mono text-[11px] hover:bg-[color:var(--bg-3)]"
                >
                  <StatusPill status={e.status} />
                  <span className="w-10 flex-none text-[color:var(--text-tertiary)]">
                    {e.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[color:var(--text-secondary)]">
                    {e.path}
                  </span>
                  {e.signature && (
                    <span
                      title={`signature: ${e.signature.slice(0, 24)}…`}
                      className="bg-[color:var(--acc-blue-soft)]/40 px-1 text-[9px] text-[color:var(--acc-blue)]"
                    >
                      sig
                    </span>
                  )}
                  <span className="w-12 flex-none text-right text-[10px] text-[color:var(--text-quaternary)]">
                    {e.duration_ms}ms
                  </span>
                  <span
                    title={new Date(e.ts * 1000).toISOString()}
                    className="w-16 flex-none text-right text-[10px] text-[color:var(--text-quaternary)]"
                  >
                    {timeAgo(e.ts)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: number }) {
  const tone =
    status >= 500
      ? "bg-[color:var(--acc-red-soft)] text-[color:var(--acc-red)]"
      : status >= 400
        ? "bg-[color:var(--acc-amber-soft)] text-[color:var(--acc-amber)]"
        : status >= 200 && status < 300
          ? "bg-[color:var(--acc-green-soft)] text-[color:var(--acc-green)]"
          : "bg-[color:var(--bg-3)] text-[color:var(--text-tertiary)]";
  return (
    <span
      className={`inline-flex w-9 flex-none justify-center px-1 text-[10px] tabular ${tone}`}
    >
      {status}
    </span>
  );
}

function timeAgo(ts: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
