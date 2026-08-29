// Shared input validators for auth flows. Plain functions so they can be
// imported on both the client and the server — no `server-only` here.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;
export const MAX_EMAIL = 254; // RFC 5321 hard limit.

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateEmail(raw: string): string | null {
  const e = normalizeEmail(raw);
  if (!e) return "email is required";
  if (e.length > MAX_EMAIL) return "email is too long";
  if (!EMAIL_RE.test(e)) return "enter a valid email address";
  return null;
}

export function validatePassword(pw: string): string | null {
  if (!pw) return "password is required";
  if (pw.length < MIN_PASSWORD) {
    return `password must be at least ${MIN_PASSWORD} characters`;
  }
  if (pw.length > MAX_PASSWORD) return "password is too long";
  return null;
}

export function validateOtp(code: string): string | null {
  if (!/^\d{6}$/.test(code)) return "enter the 6-digit code";
  return null;
}
