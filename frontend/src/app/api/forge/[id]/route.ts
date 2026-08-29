import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { isForgePodPendingError } from "@/lib/fuelborn/forge-finalizer";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  try {
    const { getForgeAttempt, publicForgeAttempt } = await import(
      "@/lib/fuelborn/forge"
    );
    return NextResponse.json({
      attempt: publicForgeAttempt(getForgeAttempt(id, user.id)),
    });
  } catch (error) {
    return forgeError(error);
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const [
    { advanceForge, publicForgeAttempt, submitForgeTransaction },
    {
      createPelicanForgeProvisioner,
      createViemForgeRegistrationReader,
      loadForgeRuntimeConfig,
    },
  ] = await Promise.all([
    import("@/lib/fuelborn/forge"),
    import("@/lib/fuelborn/forge-runtime"),
  ]);
  let body: { tx_hash?: unknown } = {};
  try {
    body = (await req.json()) as { tx_hash?: unknown };
  } catch {
    // An empty body means "retry advancement" after the tx was submitted.
  }

  try {
    if (body.tx_hash !== undefined) {
      if (typeof body.tx_hash !== "string") {
        return NextResponse.json(
          { error: "invalid_transaction_hash" },
          { status: 400 },
        );
      }
      submitForgeTransaction({
        attemptId: id,
        userId: user.id,
        txHash: body.tx_hash,
      });
    }
    const config = loadForgeRuntimeConfig();
    const result = await advanceForge({
      attemptId: id,
      userId: user.id,
      reader: createViemForgeRegistrationReader(config.rpcUrl),
      provisioner: createPelicanForgeProvisioner(),
      config: config.forge,
    });
    return NextResponse.json({
      attempt: publicForgeAttempt(result.attempt),
      confirmations_remaining:
        result.confirmationsRemaining?.toString(10) ?? null,
    });
  } catch (error) {
    return forgeError(error);
  }
}

function forgeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (isForgePodPendingError(error)) {
    return NextResponse.json(
      { error: "forge_pod_pending", stage: error.stage, message },
      { status: 409 },
    );
  }
  if (message === "Forge attempt not found") {
    return NextResponse.json({ error: "forge_not_found" }, { status: 404 });
  }
  if (
    message.includes("not been submitted") ||
    message.includes("does not contain") ||
    message.includes("does not match") ||
    message.includes("different transaction")
  ) {
    return NextResponse.json(
      { error: "forge_not_ready", message },
      { status: 409 },
    );
  }
  if (message.startsWith("Forge configuration")) {
    return NextResponse.json(
      { error: "forge_not_configured", message },
      { status: 503 },
    );
  }
  console.error("[forge] advancement failed:", message);
  return NextResponse.json(
    { error: "forge_failed", message },
    { status: 502 },
  );
}
