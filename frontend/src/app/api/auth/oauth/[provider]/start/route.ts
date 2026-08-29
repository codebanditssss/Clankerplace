import { NextRequest, NextResponse } from "next/server";
import {
  appUrl,
  buildAuthorizeUrl,
  isProvider,
  isProviderConfigured,
  startOauthState,
} from "@/lib/oauth";
import { getSessionUserId } from "@/lib/session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isProvider(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  if (!isProviderConfigured(provider)) {
    return NextResponse.json(
      { error: `${provider} oauth is not configured` },
      { status: 503 },
    );
  }
  // If a session already exists, OAuth is a no-op.
  const uid = await getSessionUserId();
  if (uid != null) {
    return NextResponse.redirect(appUrl("/"));
  }
  const nonce = await startOauthState(provider);
  return NextResponse.redirect(buildAuthorizeUrl(provider, nonce));
}
