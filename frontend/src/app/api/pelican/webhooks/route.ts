import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getMeterState,
  setMeterStateState,
  upsertMeterStateFromPelican,
} from "@/lib/billing/meter";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { billingLog } from "@/lib/billing/logger";
import db from "@/lib/db";

export const runtime = "nodejs";

/**
 * Pelican webhook receiver. Pelican panel can be configured (via custom
 * plugin) to POST server-lifecycle events here. Sync into pod_meter_state
 * so the meter reflects state changes that happened OUTSIDE our UI:
 *
 *   server.installed       — install finished, container can run.
 *                            Flip provisioning → stopped (Pelican still
 *                            controls power; we wait for power.change).
 *   server.power.change    — running / offline / starting / stopping.
 *                            Flip the meter row accordingly.
 *   server.deleted         — server removed from Pelican.
 *                            Flip meter row to 'deleted'.
 *
 * Security: signature header must match PELICAN_WEBHOOK_SECRET via HMAC.
 * Path is gated in middleware.ts (added to public prefixes below).
 *
 * Idempotency: every state transition is "set to X regardless of current
 * X" — redelivery of the same event is a no-op.
 *
 * Why the additional 5-min reconciliation (see reconcile-pelican.ts):
 * Pelican's webhook delivery isn't guaranteed (the panel plugin is
 * best-effort). The cross-check catches dropped events.
 */

type PelicanEventName =
  | "server.installed"
  | "server.power.change"
  | "server.deleted";

type PelicanEvent =
  | {
      event: "server.installed";
      data: {
        uuid: string;
        identifier: string; // = uuid_short
      };
    }
  | {
      event: "server.power.change";
      data: {
        uuid: string;
        identifier: string;
        state: "running" | "offline" | "starting" | "stopping" | "crashed";
      };
    }
  | {
      event: "server.deleted";
      data: {
        uuid: string;
        identifier: string;
      };
    };

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.PELICAN_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-pelican-signature");
  if (!verifySignature(raw, sig)) {
    billingLog.warn("pelican.webhook.bad_sig", {
      sig_present: sig != null,
    });
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let event: PelicanEvent;
  try {
    event = JSON.parse(raw) as PelicanEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!event || typeof event.event !== "string") {
    return NextResponse.json({ error: "missing_event" }, { status: 400 });
  }

  const podShort = event.data?.identifier;
  if (!podShort) {
    return NextResponse.json({ error: "missing_identifier" }, { status: 400 });
  }

  switch (event.event as PelicanEventName) {
    case "server.installed": {
      // Install finished. If we have a meter row, leave it in
      // 'provisioning' or 'stopped' until power.change=running flips it.
      // If the meter row is missing (rare: Pelican has the pod but we
      // don't), backfill from the live server data.
      const existing = getMeterState(podShort);
      if (!existing) {
        try {
          const found = await applicationApi<{
            data: Array<{ attributes: ServerAttributes }>;
          }>(`/servers?filter[uuid_short]=${encodeURIComponent(podShort)}`);
          const srv = found.data?.[0]?.attributes;
          if (!srv) {
            billingLog.warn("pelican.webhook.installed.no_server", { pod: podShort });
            break;
          }
          // Look up which local user owns this pelican_user_id (best-effort).
          const owner = db
            .prepare<[number], { id: number }>(
              `SELECT id FROM users WHERE pelican_user_id = ?`,
            )
            .get(srv.user);
          if (!owner) {
            billingLog.warn("pelican.webhook.installed.no_local_user", {
              pod: podShort,
              pelican_user: srv.user,
            });
            break;
          }
          upsertMeterStateFromPelican({
            pod_uuid_short: podShort,
            pod_full_uuid: srv.uuid,
            user_id: owner.id,
            ramMib: srv.limits.memory,
            diskMib: srv.limits.disk,
            cpuPercent: srv.limits.cpu,
            initialState: "stopped",
          });
        } catch (err) {
          billingLog.error("pelican.webhook.installed.backfill_failed", {
            pod: podShort,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      break;
    }
    case "server.power.change": {
      // The discriminated union narrows event.event but TS doesn't
      // narrow the .data property correspondingly when we read it
      // through the parent variable. Re-cast on this branch only.
      const data = event.data as Extract<
        PelicanEvent,
        { event: "server.power.change" }
      >["data"];
      const state = data.state;
      const meterState =
        state === "running" || state === "starting"
          ? "running"
          : "stopped";
      try {
        setMeterStateState(podShort, meterState, {
          // On any power change, advance last_billed_at so the brief
          // transition window isn't billed.
          advanceLastBilledTo: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        billingLog.error("pelican.webhook.power.failed", {
          pod: podShort,
          state,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }
    case "server.deleted": {
      try {
        setMeterStateState(podShort, "deleted");
      } catch (err) {
        billingLog.error("pelican.webhook.deleted.failed", {
          pod: podShort,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }
    default:
      billingLog.warn("pelican.webhook.unknown_event", { event: event.event });
      return NextResponse.json({ ok: true, ignored: true });
  }

  billingLog.info("pelican.webhook.handled", {
    event: event.event,
    pod: podShort,
  });
  return NextResponse.json({ ok: true });
}
