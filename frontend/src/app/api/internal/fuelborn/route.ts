import { NextResponse, type NextRequest } from "next/server";
import { runLifecycleEffects } from "@/lib/fuelborn/effects-worker";
import { runFuelTick } from "@/lib/fuelborn/lifecycle";

export const runtime = "nodejs";

let running = false;

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-internal-token");
  const expected =
    process.env.INTERNAL_METER_TOKEN ?? process.env.INTERNAL_RECONCILE_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "fuelborn_not_configured" },
      { status: 503 },
    );
  }
  if (!token || token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (running) {
    return NextResponse.json({ skipped: true, reason: "already_running" });
  }

  running = true;
  try {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const ticks = runFuelTick(nowSeconds);
    const effects = await runLifecycleEffects({ nowSeconds });
    return NextResponse.json({
      ok: true,
      agents_ticked: ticks.length,
      fuel_burned: ticks.reduce(
        (sum, tick) => sum + tick.burned_micro_fuel,
        0,
      ),
      deaths: ticks.filter((tick) => tick.transition === "died").length,
      effects,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[fuelborn] cycle failed:", message);
    return NextResponse.json(
      { error: "fuelborn_cycle_failed", message },
      { status: 500 },
    );
  } finally {
    running = false;
  }
}
