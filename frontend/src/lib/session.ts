import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "pods_session";
const RESET_COOKIE_NAME = "pods_reset";

/**
 * Cookie Domain so the session survives navigation between pods.ml,
 * www.pods.ml, app.pods.ml — sign-in on any of them lights up the
 * others. Driven by OAUTH_BASE_URL (which we set to the canonical
 * app host in prod). Falls back to host-scoped for the azure FQDN
 * and localhost.
 */
function cookieDomain(): string | undefined {
  const base = process.env.OAUTH_BASE_URL;
  if (!base) return undefined;
  try {
    const host = new URL(base).hostname;
    if (host === "pods.ml" || host.endsWith(".pods.ml")) return ".pods.ml";
    return undefined;
  } catch {
    return undefined;
  }
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return "dev-only-do-not-use-in-prod-aaaaaaaaaaaaaaaa";
}
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days
const RESET_MAX_AGE_SEC = 5 * 60; // 5 minutes between OTP-verify and set-password

type SessionPayload = { uid: number; iat: number; scope?: string };

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function pack(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function unpack(token: string, maxAgeSec: number): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (typeof payload.uid !== "number" || typeof payload.iat !== "number") {
      return null;
    }
    if (Date.now() / 1000 - payload.iat > maxAgeSec) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSession(userId: number) {
  const token = pack({ uid: userId, iat: Math.floor(Date.now() / 1000) });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
    domain: cookieDomain(),
  });
}

export async function clearSession() {
  const jar = await cookies();
  // delete() ignores domain — set empty + maxAge=0 to actually clear
  // the parent-domain cookie too.
  jar.set(COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    domain: cookieDomain(),
  });
}

export async function getSessionUserId(): Promise<number | null> {
  const jar = await cookies();
  const tok = jar.get(COOKIE_NAME)?.value;
  if (!tok) return null;
  const payload = unpack(tok, MAX_AGE_SEC);
  if (!payload) return null;
  // Honor admin-side session revocation. If the user has a
  // session_min_iat (set by POST /api/admin/users/[id]/revoke-sessions
  // OR by their own logout-all-devices flow) and this token was issued
  // before it, treat the cookie as dead. Also covers suspended users:
  // suspended_at-bumping endpoints also bump session_min_iat so the
  // user is signed out immediately.
  //
  // The lookup is one prepared-stmt SELECT per request — sub-ms in
  // SQLite WAL mode. Avoid this on hot loops by caching outside session.ts.
  try {
    // Lazy-import to keep this module free of the db dependency cycle
    // at module-evaluation time.
    const { default: db } = await import("@/lib/db");
    const row = db
      .prepare<[number], { session_min_iat: number | null; suspended_at: string | null }>(
        "SELECT session_min_iat, suspended_at FROM users WHERE id = ?",
      )
      .get(payload.uid);
    if (!row) return null;
    if (row.suspended_at) return null;
    if (row.session_min_iat != null && payload.iat < row.session_min_iat) {
      return null;
    }
  } catch (e) {
    console.error("[session] revocation check failed", e);
  }
  return payload.uid;
}

// --- Password-reset cookie ---
// After a user successfully types the OTP from the reset email we drop a
// short-lived signed cookie scoped to "reset". The /api/auth/reset-password
// route trusts it as proof that the same person who proved control of the
// inbox is the one now choosing a new password, so they don't have to
// re-type the email or OTP on the next form.

export async function setResetSession(userId: number) {
  const token = pack({
    uid: userId,
    iat: Math.floor(Date.now() / 1000),
    scope: "reset",
  });
  const jar = await cookies();
  jar.set(RESET_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: RESET_MAX_AGE_SEC,
    domain: cookieDomain(),
  });
}

export async function clearResetSession() {
  const jar = await cookies();
  jar.set(RESET_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    domain: cookieDomain(),
  });
}

export async function getResetUserId(): Promise<number | null> {
  const jar = await cookies();
  const tok = jar.get(RESET_COOKIE_NAME)?.value;
  if (!tok) return null;
  const payload = unpack(tok, RESET_MAX_AGE_SEC);
  if (!payload || payload.scope !== "reset") return null;
  return payload.uid;
}
