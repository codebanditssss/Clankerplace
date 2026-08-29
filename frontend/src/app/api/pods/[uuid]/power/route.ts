// POST /api/pods/<uuid>/power
// Body: { signal: "start" | "stop" | "restart" | "kill" }
//
// Sends a power signal to the pod via Pelican's Client API. Application
// API doesn't expose power; only the per-user client token can flip a
// server on/off. We look the token up from our SQLite users table (it
// was minted at signup via mintPelicanClientToken).
//
// Returns 204 on success — Pelican's power endpoint also returns 204.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import db from "@/lib/db";
import { setMeterStateState } from "@/lib/billing/meter";

const PANEL_URL = process.env.PELICAN_URL ?? "";

type Signal = "start" | "stop" | "restart" | "kill";
const VALID_SIGNALS: Signal[] = ["start", "stop", "restart", "kill"];

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: { signal?: string };
  try {
    body = (await req.json()) as { signal?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const signal = body.signal as Signal | undefined;
  if (!signal || !VALID_SIGNALS.includes(signal)) {
    return NextResponse.json(
      { error: `signal must be one of: ${VALID_SIGNALS.join(", ")}` },
      { status: 400 },
    );
  }

  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Pull the user's stored Pelican client token (TYPE_ACCOUNT key
  // minted at signup time). We need this because power signals live
  // under /api/client, not /api/application, and the application key
  // doesn't have permission to flip server power.
  const row = db
    .prepare<[number], { pelican_client_token: string | null }>(
      "SELECT pelican_client_token FROM users WHERE id = ?",
    )
    .get(user.id);
  if (!row?.pelican_client_token) {
    return NextResponse.json(
      { error: "no client token on file — please sign out and back in" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      `${PANEL_URL}/api/client/servers/${encodeURIComponent(srv.identifier)}/power`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${row.pelican_client_token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ signal }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Pelican ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Mirror the power action into pod_meter_state so the meter tick stops
  // billing instantly on stop/kill. For restart we *also* advance
  // last_billed_at to now: the container is briefly down for the restart
  // and we don't want to bill that gap as if it were running. (The next
  // tick after the start completes will resume the meter clean.)
  try {
    if (signal === "start") {
      setMeterStateState(uuid, "running", {
        advanceLastBilledTo: Math.floor(Date.now() / 1000),
      });
    } else if (signal === "stop" || signal === "kill") {
      setMeterStateState(uuid, "stopped");
    } else if (signal === "restart") {
      // Stay in 'running' state but reset the bill clock — see comment above.
      setMeterStateState(uuid, "running", {
        advanceLastBilledTo: Math.floor(Date.now() / 1000),
      });
    }
  } catch (err) {
    console.warn(
      `[power] meter-state update failed for ${uuid}: ${err instanceof Error ? err.message : err}`,
    );
  }

  return NextResponse.json({ ok: true, signal });
}
