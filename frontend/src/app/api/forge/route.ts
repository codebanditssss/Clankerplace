import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/current-user";

export const runtime = "nodejs";

type PrepareBody = {
  idempotency_key?: unknown;
  name?: unknown;
  mission?: unknown;
  personality?: unknown;
  model?: unknown;
  owner_wallet?: unknown;
  deposit_wei?: unknown;
};

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: PrepareBody;
  try {
    body = (await req.json()) as PrepareBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const invalid = requiredStrings(body);
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: "invalid_forge_request", fields: invalid },
      { status: 400 },
    );
  }

  try {
    // Forge pulls in the native SQLite runtime. Keep it behind the session
    // check so anonymous Vercel requests can return 401 without loading it.
    const [{ prepareForge, publicForgeAttempt }, { loadForgeRuntimeConfig }] =
      await Promise.all([
        import("@/lib/fuelborn/forge"),
        import("@/lib/fuelborn/forge-runtime"),
      ]);
    const config = loadForgeRuntimeConfig();
    const result = prepareForge({
      userId: user.id,
      pelicanUserId: user.pelicanUserId,
      idempotencyKey: body.idempotency_key as string,
      name: body.name as string,
      mission: body.mission as string,
      personality: body.personality as string,
      model: body.model as string,
      ownerWallet: body.owner_wallet as string,
      depositWei: body.deposit_wei as string,
      config: config.forge,
    });
    return NextResponse.json(
      {
        attempt: publicForgeAttempt(result.attempt),
        transaction: result.transaction,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const configurationError = message.startsWith("Forge configuration");
    return NextResponse.json(
      {
        error: configurationError
          ? "forge_not_configured"
          : "invalid_forge_request",
        message,
      },
      { status: configurationError ? 503 : 400 },
    );
  }
}

function requiredStrings(body: PrepareBody): string[] {
  return [
    "idempotency_key",
    "name",
    "mission",
    "personality",
    "model",
    "owner_wallet",
    "deposit_wei",
  ].filter((key) => {
    const value = body[key as keyof PrepareBody];
    return typeof value !== "string" || value.trim().length === 0;
  });
}
