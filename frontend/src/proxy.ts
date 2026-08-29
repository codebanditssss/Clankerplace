// Route gate.
//
//   / , /login, /signup, /landing assets → public (anyone)
//   /api/email/inbound, /api/auth/*      → public (Resend webhook + login form)
//   everything else                       → requires a session cookie
//
// Middleware can't open SQLite (Edge runtime), so we only check that the
// cookie EXISTS. The real session-verify still happens in server-action
// /lib/session.ts inside the (app) layout + each API route.
//
// The point of this gate is just to avoid showing app chrome to people
// who clearly aren't logged in, while keeping `/` browseable as the
// marketing landing.
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  // Pricing page is a public marketing surface — must not redirect
  // logged-out visitors to /login.
  "/pricing",
  // Public hackathon marketplace. Transactions may ask for a wallet at the
  // point of action, but browsing never requires an account.
  "/explore",
  "/jobs",
  "/leaderboard",
  "/graveyard",
  "/proofs",
  "/post",
  "/forge",
]);

const PUBLIC_PREFIXES = [
  "/_next/",
  "/api/auth/",
  "/api/email/inbound",
  // Public billing actions need to reach their route handlers so logged-out
  // callers receive JSON 401 instead of a middleware HTML redirect.
  "/api/billing/checkout",
  "/api/billing/credits/checkout",
  "/api/billing/portal",
  "/api/billing/webhooks/dodo",
  // Pelican panel posts server-lifecycle events here. Signature-verified
  // by the route handler via PELICAN_WEBHOOK_SECRET (HMAC-SHA256).
  "/api/pelican/webhooks",
  "/favicon",
  "/icon",
  "/apple-icon",
  "/apple-touch-icon",
  "/android-chrome",
  "/robots",
  "/sitemap",
  "/site.webmanifest",
  "/pods_favicon",
  "/screenshot.png",
  "/clanker/",
  "/logo.png",
  "/logo-",
  "/discord-icon.png",
  "/linkedin-profile.png",
  "/x-profile.png",
];

// Per-pod API endpoints that pods call back into with a Bearer token
// (POD_EMAIL_TOKEN today) — the route handler validates the bearer,
// the middleware just needs to not redirect them to /login.
const BEARER_ALLOWED_PATTERNS: RegExp[] = [
  /^\/api\/pods\/[^/]+\/email\/send$/,
];

// Internal endpoints called by server.mjs itself (loopback). They use
// X-Internal-Token header; the route handler validates. Middleware just
// needs to let them through the session gate.
const INTERNAL_TOKEN_PATTERNS: RegExp[] = [/^\/api\/internal\//];

export default function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (
    PUBLIC_PATHS.has(pathname) ||
      PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }
  // Pod-callback endpoints with a Bearer header skip the cookie check.
  // The route handler is responsible for validating the token.
  const authHeader = req.headers.get("authorization") ?? "";
  if (
    authHeader.toLowerCase().startsWith("bearer ") &&
    BEARER_ALLOWED_PATTERNS.some((p) => p.test(pathname))
  ) {
    return NextResponse.next();
  }
  // Internal endpoints — token check happens in the route handler.
  if (
    req.headers.get("x-internal-token") &&
    INTERNAL_TOKEN_PATTERNS.some((p) => p.test(pathname))
  ) {
    return NextResponse.next();
  }
  const hasSession = req.cookies.get("pods_session");
  if (!hasSession) {
    const url = new URL("/login", req.url);
    if (pathname && pathname !== "/") {
      url.searchParams.set("next", `${pathname}${search}`);
    }
    return NextResponse.redirect(url);
  }
  // Admin surface defense-in-depth: even though the layout 404s
  // non-admins, also tell crawlers + caches never to keep these pages.
  // (The layout sets metadata.robots too — this is belt-and-braces in
  // case a route accidentally bypasses the layout.)
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
