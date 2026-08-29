import { NextRequest, NextResponse } from "next/server";
import {
  appUrl,
  consumeOauthState,
  exchangeCodeForProfile,
  isProvider,
  isProviderConfigured,
} from "@/lib/oauth";
import { findOrCreateOauthUser } from "@/lib/auth";
import { setSession } from "@/lib/session";

function backToLogin(errorCode: string) {
  const url = appUrl("/login");
  url.searchParams.set("error", errorCode);
  return NextResponse.redirect(url);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isProvider(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  if (!isProviderConfigured(provider)) {
    return backToLogin("oauth_not_configured");
  }

  // Pull query params from req.url — only the search portion matters,
  // the origin we get from req.url may be the internal proxy address.
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    // Provider-side cancel / consent denied / app-not-approved.
    return backToLogin(
      error === "access_denied" ? "oauth_denied" : "oauth_provider",
    );
  }
  if (!code || !state) {
    return backToLogin("oauth_missing_params");
  }

  // Verify CSRF state. Cookie is single-use (consume deletes it) so a
  // replayed callback URL can't succeed even before the code is consumed
  // by the provider's token endpoint.
  const stateOk = await consumeOauthState(provider, state);
  if (!stateOk) {
    return backToLogin("oauth_state");
  }

  let profile;
  try {
    profile = await exchangeCodeForProfile(provider, code);
  } catch (err) {
    console.error("[oauth] exchange/profile failed:", err);
    return backToLogin("oauth_exchange");
  }

  const res = await findOrCreateOauthUser(
    provider,
    profile.providerUserId,
    profile.email,
  );
  if (!res.ok) {
    console.error("[oauth] link failed:", res.error);
    return backToLogin("oauth_link");
  }

  await setSession(res.user.id);
  return NextResponse.redirect(appUrl("/"));
}
