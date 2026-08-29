import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_LENGTH = 6;
export const OTP_TTL_SEC = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SEC = 30;

export function generateOtp(): string {
  let out = "";
  for (let i = 0; i < OTP_LENGTH; i++) out += String(randomInt(0, 10));
  return out;
}

// SHA-256 is fine here: OTPs are short-lived, rate-limited, and high-entropy
// within a 6-digit space — bcrypt would add 100ms per /verify call with no
// real win against an attacker who already has DB read.
export function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function verifyOtp(code: string, expectedHash: string): boolean {
  const got = Buffer.from(hashOtp(code));
  const want = Buffer.from(expectedHash);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export function otpExpiry(): string {
  return new Date(Date.now() + OTP_TTL_SEC * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

export function isExpired(expiresAt: string): boolean {
  // SQLite stores ISO-ish strings without 'Z'; Date parses them as local in
  // some envs. Force UTC interpretation by appending 'Z' if missing.
  const iso = expiresAt.includes("T") ? expiresAt : expiresAt.replace(" ", "T");
  const withZ = iso.endsWith("Z") ? iso : iso + "Z";
  return Date.parse(withZ) < Date.now();
}
