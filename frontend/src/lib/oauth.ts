import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// OAuth provider integration (Google + GitHub). Stateless flow:
//
//   /api/auth/oauth/<p>/start    → set signed state cookie, 302 to provider
//   /api/auth/oauth/<p>/callback → verify state cookie, exchange code,
//                                  fetch profile, find-or-create user, set
//                                  session, 302 to /
//
// The state cookie is HMAC-signed with SESSION_SECRET and carries the
// provider name, so we don't need a server-side store and a callback for
// provider A can't accidentally accept a state issued for provider B.

export type Provider = "google" | "github";

type ProviderConfig = {
  authorize: string;
  token: string;
  scopes: string[];
  clientId: () => string;
  clientSecret: () => string;
};

const env = (k: string): string => process.env[k] ?? "";

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "profile"],
    clientId: () => env("GOOGLE_CLIENT_ID"),
    clientSecret: () => env("GOOGLE_CLIENT_SECRET"),
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    // user:email lets us read the verified primary email even when the
    // user has it set to private (then /user.email is null).
    scopes: ["read:user", "user:email"],
    clientId: () => env("GITHUB_CLIENT_ID"),
    clientSecret: () => env("GITHUB_CLIENT_SECRET"),
  },
};

export function isProvider(p: string): p is Provider {
  return p === "google" || p === "github";
}

export function isProviderConfigured(p: Provider): boolean {
  return Boolean(PROVIDERS[p].clientId() && PROVIDERS[p].clientSecret());
}

function getOauthBaseUrl(): string {
  const base = env("OAUTH_BASE_URL");
  if (!base) throw new Error("OAUTH_BASE_URL is not set");
  return base.replace(/\/$/, "");
}

export function redirectUriFor(provider: Provider): string {
  return `${getOauthBaseUrl()}/api/auth/oauth/${provider}/callback`;
}

// Builds an absolute URL for an in-app path against OAUTH_BASE_URL.
//
// Why not `new URL(path, req.url)`? Behind a reverse proxy (Caddy on the
// prototype VM), Next.js receives the *internal* URL (typically
// http://localhost:3000/...) rather than the public hostname. Using
// req.url for the post-OAuth redirect target would send the user back to
// localhost. OAUTH_BASE_URL is the canonical public URL we already
// require for redirect_uri, so reuse it.
export function appUrl(path: string): URL {
  const base = getOauthBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return new URL(base + p);
}

// --- State cookie (CSRF) ---

const STATE_COOKIE = "pods_oauth_state";
const STATE_TTL_SEC = 600;

type StatePayload = { nonce: string; provider: Provider; iat: number };

function stateSecret(): string {
  const s = env("SESSION_SECRET");
  if (s) return s;
  if (env("NODE_ENV") === "production") {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return "dev-only-do-not-use-in-prod-aaaaaaaaaaaaaaaa";
}

function sign(value: string): string {
  return createHmac("sha256", stateSecret()).update(value).digest("base64url");
}

function packState(p: StatePayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function unpackState(token: string): StatePayload | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Partial<StatePayload>;
    if (
      typeof p.nonce !== "string" ||
      typeof p.provider !== "string" ||
      !isProvider(p.provider) ||
      typeof p.iat !== "number"
    ) {
      return null;
    }
    if (Date.now() / 1000 - p.iat > STATE_TTL_SEC) return null;
    return { nonce: p.nonce, provider: p.provider, iat: p.iat };
  } catch {
    return null;
  }
}

/**
 * Derive the cookie Domain so the state cookie is readable by every
 * pods.ml subdomain. Without this, /start running on pods.ml sets a
 * host-scoped cookie that /callback on app.pods.ml can never read,
 * producing the "oauth_state expired or didn't match" error.
 *
 * Pulls from OAUTH_BASE_URL (e.g. https://app.pods.ml) so the cookie
 * is scoped to the same parent the provider redirects back to.
 */
function stateCookieDomain(): string | undefined {
  const base = env("OAUTH_BASE_URL");
  if (!base) return undefined;
  try {
    const host = new URL(base).hostname;
    // pods.ml or *.pods.ml → ".pods.ml" so all subdomains share it.
    if (host === "pods.ml" || host.endsWith(".pods.ml")) return ".pods.ml";
    // Bare IP / non-public host (azure FQDN, localhost, …) — leave
    // host-scoped, which is what the browser defaults to.
    return undefined;
  } catch {
    return undefined;
  }
}

export async function startOauthState(provider: Provider): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const token = packState({
    nonce,
    provider,
    iat: Math.floor(Date.now() / 1000),
  });
  const jar = await cookies();
  jar.set(STATE_COOKIE, token, {
    httpOnly: true,
    secure: env("NODE_ENV") === "production",
    // lax (not strict) — the cookie must survive the cross-site redirect
    // back from the provider. lax is enough for GET callbacks.
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SEC,
    domain: stateCookieDomain(),
  });
  return nonce;
}

export async function consumeOauthState(
  provider: Provider,
  expectedNonce: string,
): Promise<boolean> {
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  // Single-use: delete regardless of outcome so a replay can't succeed.
  // Match domain on delete or browsers ignore the unset.
  jar.set(STATE_COOKIE, "", {
    path: "/",
    maxAge: 0,
    domain: stateCookieDomain(),
  });
  if (!raw) return false;
  const payload = unpackState(raw);
  if (!payload || payload.provider !== provider) return false;
  const a = Buffer.from(payload.nonce);
  const b = Buffer.from(expectedNonce);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Authorize URL builder ---

export function buildAuthorizeUrl(provider: Provider, state: string): string {
  const cfg = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: redirectUriFor(provider),
    response_type: "code",
    scope: cfg.scopes.join(" "),
    state,
  });
  if (provider === "google") {
    // Force the account chooser so users on multi-account browsers can
    // pick which Google identity to use.
    params.set("prompt", "select_account");
    params.set("access_type", "online");
  }
  if (provider === "github") {
    // Let users re-pick scopes / account if they switch.
    params.set("allow_signup", "true");
  }
  return `${cfg.authorize}?${params.toString()}`;
}

// --- Token exchange + profile fetch ---

export type ProviderProfile = {
  providerUserId: string;
  email: string;
  name?: string;
};

type TokenResp = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

async function exchangeCode(
  provider: Provider,
  code: string,
): Promise<string> {
  const cfg = PROVIDERS[provider];
  const res = await fetch(cfg.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: cfg.clientId(),
      client_secret: cfg.clientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUriFor(provider),
    }).toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `token exchange ${provider} failed: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as TokenResp;
  if (data.error || !data.access_token) {
    throw new Error(
      `token exchange ${provider} failed: ${data.error_description || data.error || "no access_token"}`,
    );
  }
  return data.access_token;
}

async function fetchGoogleProfile(
  accessToken: string,
): Promise<ProviderProfile> {
  const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`google profile fetch failed: HTTP ${r.status}`);
  const u = (await r.json()) as {
    id?: string;
    email?: string;
    verified_email?: boolean;
    name?: string;
  };
  if (!u.id) throw new Error("google profile missing id");
  if (!u.email) throw new Error("google profile missing email");
  // verified_email is true for all standard Google accounts; only some
  // older / federated ones come back false. Reject those to avoid
  // account-takeover via unverified email match.
  if (u.verified_email === false) {
    throw new Error("google profile email is not verified");
  }
  return { providerUserId: String(u.id), email: u.email, name: u.name };
}

async function fetchGithubProfile(
  accessToken: string,
): Promise<ProviderProfile> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pods.ml-oauth",
  };
  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", { headers, cache: "no-store" }),
    fetch("https://api.github.com/user/emails", { headers, cache: "no-store" }),
  ]);
  if (!userRes.ok) {
    throw new Error(`github /user failed: HTTP ${userRes.status}`);
  }
  if (!emailsRes.ok) {
    throw new Error(`github /user/emails failed: HTTP ${emailsRes.status}`);
  }
  const u = (await userRes.json()) as {
    id?: number;
    login?: string;
    name?: string;
  };
  const emails = (await emailsRes.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  const primary =
    emails.find((e) => e.primary && e.verified) ??
    emails.find((e) => e.verified);
  if (!u.id) throw new Error("github profile missing id");
  if (!primary) throw new Error("no verified email on github account");
  return {
    providerUserId: String(u.id),
    email: primary.email,
    name: u.name || u.login,
  };
}

export async function exchangeCodeForProfile(
  provider: Provider,
  code: string,
): Promise<ProviderProfile> {
  const accessToken = await exchangeCode(provider, code);
  return provider === "google"
    ? await fetchGoogleProfile(accessToken)
    : await fetchGithubProfile(accessToken);
}
