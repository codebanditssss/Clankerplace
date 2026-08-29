import "server-only";
import bcrypt from "bcryptjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import db, {
  type AccountEmailLoginMigrationRow,
  type PasswordResetRow,
  type PendingSignupRow,
  type UserRow,
  type WalletIdentityRow,
} from "./db";
import {
  applicationApi,
  findPelicanUserByEmail,
  PelicanApiError,
} from "./pelican";
import { maybePromoteAdmin } from "./billing/bootstrap-admin";
import { getSessionUserId } from "./session";
import {
  generateOtp,
  hashOtp,
  isExpired,
  otpExpiry,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SEC,
  verifyOtp,
} from "./otp";
import { sendPasswordResetEmail, sendSignupOtpEmail } from "./auth-emails";
import {
  normalizeEmail,
  validateEmail,
  validatePassword,
} from "./validation";

const BCRYPT_ROUNDS = 10;

// Sentinel value stored in users.password_hash for accounts created via
// OAuth. The schema requires password_hash NOT NULL and SQLite can't drop
// the constraint via ALTER, so we write a never-matches-bcrypt value
// (real hashes start with $2). Format: `$oauth$<provider>` — keeps the
// originating provider on the row for diagnostics.
const OAUTH_PASSWORD_PREFIX = "$oauth$";
// Sentinel for wallet-only accounts (no password, no email). users.email
// is NOT NULL UNIQUE in the schema, so legacy wallet-only accounts get a synthetic email of the form `<address>@wallet.pods.local`.
// This keeps the existing schema intact without needing a nullable email
// migration, while staying obviously non-deliverable.
const WALLET_PASSWORD_SENTINEL = "$wallet$solana";
const WALLET_EMAIL_DOMAIN = "wallet.pods.local";
const execFileAsync = promisify(execFile);

const PANEL_CONTAINER =
  process.env.PELICAN_CONTAINER_NAME ?? "pelican-panel-1";

/**
 * Creates a TYPE_ACCOUNT (client) Pelican ApiKey for the given user by shelling
 * out to `docker exec pelican-panel-1 php artisan tinker`. There is no
 * Application-API endpoint for minting client tokens — they're meant to be
 * created by users via the panel UI — so this is the pragmatic backdoor for
 * server-side onboarding.
 *
 * If PELICAN_SSH_HOST is set, the docker exec is wrapped in `ssh <host> ...`
 * so this can run from a developer laptop that doesn't have the panel
 * container locally. Requires key-based ssh (BatchMode=yes) — no password
 * prompt is possible from a server request handler.
 */
async function mintPelicanClientToken(
  pelicanUserId: number,
): Promise<string> {
  if (!Number.isInteger(pelicanUserId) || pelicanUserId <= 0) {
    throw new Error("invalid pelicanUserId");
  }
  // Token format: <16-char identifier><32-char token> (per App\Models\ApiKey).
  const tinker = `
    $id = Illuminate\\Support\\Str::random(16);
    $tok = Illuminate\\Support\\Str::random(32);
    App\\Models\\ApiKey::create([
      'user_id' => ${pelicanUserId},
      'key_type' => App\\Models\\ApiKey::TYPE_ACCOUNT,
      'identifier' => $id, 'token' => $tok,
      'memo' => 'pods.ml session', 'permissions' => [], 'allowed_ips' => [],
    ]);
    echo $id . $tok . PHP_EOL;
  `.replace(/\n\s+/g, " ").trim();

  const sshHost = process.env.PELICAN_SSH_HOST;
  const [bin, args] = sshHost
    ? [
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=accept-new",
          sshHost,
          // ssh joins these into one remote command string; single-quote the
          // tinker payload so the remote shell sees it as one arg, escaping
          // any embedded single quotes the PHP way.
          `docker exec ${PANEL_CONTAINER} php artisan tinker --execute='${tinker.replace(/'/g, "'\\''")}'`,
        ],
      ]
    : [
        "docker",
        [
          "exec",
          PANEL_CONTAINER,
          "php",
          "artisan",
          "tinker",
          "--execute=" + tinker,
        ],
      ];

  let stdout: string, stderr: string;
  try {
    const res = await execFileAsync(bin, args, {
      timeout: sshHost ? 30_000 : 15_000,
    });
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `tinker failed: ${e.stderr?.trim() || e.stdout?.trim() || e.message || "unknown"}`,
    );
  }
  const token = stdout.trim().split(/\s+/).pop();
  if (!token || token.length !== 48) {
    throw new Error(
      `unexpected tinker output (stdout=${stdout.slice(0, 200)} stderr=${stderr.slice(0, 200)})`,
    );
  }
  return token;
}

async function createPelicanUserAndToken(
  email: string,
  password: string,
): Promise<{ pelicanUserId: number; clientToken: string }> {
  // Local-dev escape hatch. Set PELICAN_DEV_STUB=1 in .env.local when you
  // don't have a Pelican panel reachable from this machine (no local
  // docker container, no SSH access to the prototype VM). Returns
  // deterministic-but-unique stub values so signup completes and the
  // user lands in the (app) layout. Pelican-dependent features (pod
  // deploy, listing pods, console, …) won't work — but OAuth, OTP signup, and the billing API all rely only
  // on local DB state and DO work.
  //
  // Production code path is unchanged when this env var is unset/anything
  // other than "1". The flag is intentionally explicit so Codex review
  // can grep for it.
  if (process.env.PELICAN_DEV_STUB === "1") {
    // Use the time + a random suffix for a non-colliding stub id in the
    // 100k-1M range (avoids clashes with real Pelican user ids 1..N).
    const stubId = 100_000 + Math.floor(Math.random() * 900_000);
    const stubToken =
      "stub" +
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2);
    console.warn(
      `[auth] PELICAN_DEV_STUB=1 — using stub Pelican user ${stubId} for ${email}. Pelican-backed features will not work.`,
    );
    return { pelicanUserId: stubId, clientToken: stubToken.slice(0, 48) };
  }

  const usernameBase = email.split("@")[0].replace(/[^a-z0-9]/g, "");
  const username = `${usernameBase}${Math.random().toString(36).slice(2, 6)}`.slice(
    0,
    24,
  );
  type PelicanUserResp = {
    object: string;
    attributes: { id: number };
  };

  // verifySignupOtp may be retried after a partial failure (e.g. tinker
  // crashed after the Pelican user was created, or the response was lost
  // mid-flight). On retry, Pelican rejects POST /users with 422 "email
  // already taken" — recover by looking up the existing user and reusing
  // its id, then continue to mint a token as normal.
  let pelicanUserId: number;
  try {
    const resp = await applicationApi<PelicanUserResp>("/users", {
      method: "POST",
      body: { email, username, password, root_admin: false },
    });
    pelicanUserId = resp.attributes.id;
  } catch (err) {
    if (
      err instanceof PelicanApiError &&
      err.status === 422 &&
      /email.*already been taken/i.test(err.body)
    ) {
      const existing = await findPelicanUserByEmail(email);
      if (existing == null) {
        throw new Error(
          `pelican said email taken but lookup found no user for ${email}`,
        );
      }
      pelicanUserId = existing;
    } else {
      throw err;
    }
  }

  const clientToken = await mintPelicanClientToken(pelicanUserId);
  return { pelicanUserId, clientToken };
}

export type CurrentUser = {
  id: number;
  email: string;
  pelicanUserId: number;
  emailVerifiedAt: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const uid = await getSessionUserId();
  if (uid == null) return null;
  const row = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(uid);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    pelicanUserId: row.pelican_user_id,
    emailVerifiedAt: row.email_verified_at,
  };
}

export function getPelicanClientToken(userId: number): string | null {
  const row = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  return row?.pelican_client_token ?? null;
}

// --- Signup ---

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string; code?: string };

function secondsSince(iso: string): number {
  const withT = iso.includes("T") ? iso : iso.replace(" ", "T");
  const withZ = withT.endsWith("Z") ? withT : withT + "Z";
  return (Date.now() - Date.parse(withZ)) / 1000;
}

/**
 * Step 1 of signup. Stores the email + password hash on `pending_signups`
 * (replacing any prior pending row for the same address), generates a
 * fresh 6-digit OTP, and emails it. We deliberately do NOT create the
 * Pelican user here — that only happens after the OTP is verified, to
 * avoid leaving orphaned panel accounts for typo'd / never-confirmed
 * email addresses.
 */
export async function createPendingSignup(
  rawEmail: string,
  password: string,
): Promise<Result> {
  const emailErr = validateEmail(rawEmail);
  if (emailErr) return { ok: false, error: emailErr };
  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, error: pwErr };

  const email = normalizeEmail(rawEmail);

  const existingUser = db
    .prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?")
    .get(email);
  if (existingUser) {
    return { ok: false, error: "email already registered", code: "exists" };
  }

  const existingPending = db
    .prepare<[string], PendingSignupRow>(
      "SELECT * FROM pending_signups WHERE email = ?",
    )
    .get(email);
  if (existingPending && secondsSince(existingPending.last_sent_at) < OTP_RESEND_COOLDOWN_SEC) {
    return {
      ok: false,
      error: `please wait a moment before requesting another code`,
      code: "rate_limited",
    };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expires = otpExpiry();

  db.prepare(
    `INSERT INTO pending_signups (email, password_hash, code_hash, expires_at, attempts, last_sent_at)
     VALUES (?, ?, ?, ?, 0, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET
       password_hash = excluded.password_hash,
       code_hash     = excluded.code_hash,
       expires_at    = excluded.expires_at,
       attempts      = 0,
       last_sent_at  = datetime('now')`,
  ).run(email, passwordHash, codeHash, expires);

  try {
    await sendSignupOtpEmail({ to: email, code });
  } catch (err) {
    return {
      ok: false,
      error: `failed to send verification email: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true };
}

export async function resendSignupOtp(rawEmail: string): Promise<Result> {
  const email = normalizeEmail(rawEmail);
  if (validateEmail(email)) {
    return { ok: false, error: "invalid email" };
  }
  const pending = db
    .prepare<[string], PendingSignupRow>(
      "SELECT * FROM pending_signups WHERE email = ?",
    )
    .get(email);
  if (!pending) return { ok: false, error: "no pending signup for this email" };
  if (secondsSince(pending.last_sent_at) < OTP_RESEND_COOLDOWN_SEC) {
    return {
      ok: false,
      error: "please wait a moment before requesting another code",
      code: "rate_limited",
    };
  }
  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expires = otpExpiry();
  db.prepare(
    `UPDATE pending_signups
        SET code_hash = ?, expires_at = ?, attempts = 0, last_sent_at = datetime('now')
      WHERE email = ?`,
  ).run(codeHash, expires, email);
  try {
    await sendSignupOtpEmail({ to: email, code });
  } catch (err) {
    return {
      ok: false,
      error: `failed to send verification email: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true };
}

/**
 * Step 2 of signup. Validates the OTP, creates the matching Pelican user,
 * inserts the verified row into `users`, and removes the pending row.
 * Returns the new CurrentUser so the caller can drop a session cookie.
 */
export async function verifySignupOtp(
  rawEmail: string,
  code: string,
): Promise<{ ok: true; user: CurrentUser } | { ok: false; error: string }> {
  const email = normalizeEmail(rawEmail);
  const pending = db
    .prepare<[string], PendingSignupRow>(
      "SELECT * FROM pending_signups WHERE email = ?",
    )
    .get(email);
  if (!pending) return { ok: false, error: "no pending signup for this email" };

  if (pending.attempts >= OTP_MAX_ATTEMPTS) {
    // Burn the pending row so the user is forced to restart signup
    // rather than grinding more guesses.
    db.prepare("DELETE FROM pending_signups WHERE email = ?").run(email);
    return {
      ok: false,
      error: "too many attempts — please request a new code",
    };
  }
  if (isExpired(pending.expires_at)) {
    return { ok: false, error: "code expired — request a new one" };
  }
  if (!verifyOtp(code, pending.code_hash)) {
    db.prepare(
      "UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?",
    ).run(email);
    return { ok: false, error: "incorrect code" };
  }

  // Race guard: someone could have completed signup for the same address
  // since we last looked.
  const alreadyUser = db
    .prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?")
    .get(email);
  if (alreadyUser) {
    db.prepare("DELETE FROM pending_signups WHERE email = ?").run(email);
    return { ok: false, error: "email already registered" };
  }

  // The password hash was made from the password the user typed at
  // signup-step-1, but we don't have the plaintext anymore. Pelican
  // needs a plaintext password to create the user — so we mint a random
  // strong password for the Pelican account. Pods users only ever log in
  // through this app, never directly into the Pelican panel UI, so a
  // throwaway password is fine.
  const pelicanPassword =
    "Pp" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + "!";

  let pelicanUserId: number;
  let clientToken: string;
  try {
    const created = await createPelicanUserAndToken(email, pelicanPassword);
    pelicanUserId = created.pelicanUserId;
    clientToken = created.clientToken;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `pelican user create failed: ${msg}` };
  }

  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, pelican_user_id, pelican_client_token, email_verified_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
    .run(email, pending.password_hash, pelicanUserId, clientToken);
  db.prepare("DELETE FROM pending_signups WHERE email = ?").run(email);

  const id = Number(info.lastInsertRowid);
  // Bootstrap-admin hook: if this signup matches BOOTSTRAP_ADMIN_EMAIL,
  // promote immediately so the operator doesn't have to restart the
  // server to claim admin after their own signup. The same env-var
  // check at boot (in db.ts) covers the OAuth and wallet signup paths
  // and the "already signed up before BOOTSTRAP_ADMIN_EMAIL was set"
  // case.
  maybePromoteAdmin(id, email);
  const row = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(id)!;
  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      pelicanUserId: row.pelican_user_id,
      emailVerifiedAt: row.email_verified_at,
    },
  };
}

export async function beginWalletEmailLoginMigration(
  userId: number,
  rawEmail: string,
  password: string,
): Promise<Result> {
  const user = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!user || user.password_hash !== WALLET_PASSWORD_SENTINEL) {
    return { ok: false, error: "this account does not need migration" };
  }
  if (!isWalletSyntheticEmail(user.email)) {
    return { ok: false, error: "this account already has an email login" };
  }

  const emailErr = validateEmail(rawEmail);
  if (emailErr) return { ok: false, error: emailErr };
  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, error: pwErr };

  const email = normalizeEmail(rawEmail);
  if (isWalletSyntheticEmail(email)) {
    return { ok: false, error: "enter a deliverable email address" };
  }

  const existingUser = db
    .prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?")
    .get(email);
  if (existingUser && existingUser.id !== userId) {
    return { ok: false, error: "email already registered", code: "exists" };
  }

  const existingMigrationByEmail = db
    .prepare<[string], AccountEmailLoginMigrationRow>(
      "SELECT * FROM account_email_login_migrations WHERE email = ?",
    )
    .get(email);
  if (existingMigrationByEmail && existingMigrationByEmail.user_id !== userId) {
    return { ok: false, error: "email migration already pending" };
  }
  const existingMigration = db
    .prepare<[number], AccountEmailLoginMigrationRow>(
      "SELECT * FROM account_email_login_migrations WHERE user_id = ?",
    )
    .get(userId);
  if (
    existingMigration &&
    secondsSince(existingMigration.last_sent_at) < OTP_RESEND_COOLDOWN_SEC
  ) {
    return {
      ok: false,
      error: "please wait a moment before requesting another code",
      code: "rate_limited",
    };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expires = otpExpiry();

  db.prepare(
    `INSERT INTO account_email_login_migrations (user_id, email, password_hash, code_hash, expires_at, attempts, last_sent_at)
     VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       email         = excluded.email,
       password_hash = excluded.password_hash,
       code_hash     = excluded.code_hash,
       expires_at    = excluded.expires_at,
       attempts      = 0,
       last_sent_at  = datetime('now')`,
  ).run(userId, email, passwordHash, codeHash, expires);

  try {
    await sendSignupOtpEmail({ to: email, code });
  } catch (err) {
    return {
      ok: false,
      error: `failed to send verification email: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true };
}

export function confirmWalletEmailLoginMigration(
  userId: number,
  rawEmail: string,
  code: string,
): { ok: true; user: CurrentUser } | { ok: false; error: string } {
  const user = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!user || user.password_hash !== WALLET_PASSWORD_SENTINEL) {
    return { ok: false, error: "this account does not need migration" };
  }
  if (!isWalletSyntheticEmail(user.email)) {
    return { ok: false, error: "this account already has an email login" };
  }

  const email = normalizeEmail(rawEmail);
  const pending = db
    .prepare<[number, string], AccountEmailLoginMigrationRow>(
      `SELECT * FROM account_email_login_migrations
        WHERE user_id = ? AND email = ?`,
    )
    .get(userId, email);
  if (!pending) return { ok: false, error: "no pending verification for this email" };

  if (pending.attempts >= OTP_MAX_ATTEMPTS) {
    db.prepare("DELETE FROM account_email_login_migrations WHERE user_id = ?").run(userId);
    return {
      ok: false,
      error: "too many attempts - please request a new code",
    };
  }
  if (isExpired(pending.expires_at)) {
    return { ok: false, error: "code expired - request a new one" };
  }
  if (!verifyOtp(code, pending.code_hash)) {
    db.prepare(
      `UPDATE account_email_login_migrations
          SET attempts = attempts + 1
        WHERE user_id = ?`,
    ).run(userId);
    return { ok: false, error: "incorrect code" };
  }

  const alreadyUser = db
    .prepare<[string, number], UserRow>(
      "SELECT * FROM users WHERE email = ? AND id <> ?",
    )
    .get(email, userId);
  if (alreadyUser) {
    db.prepare("DELETE FROM account_email_login_migrations WHERE user_id = ?").run(userId);
    return { ok: false, error: "email already registered" };
  }

  const updated = db.transaction(() => {
    const info = db
      .prepare(
        `UPDATE users
            SET email = ?,
                password_hash = ?,
                email_verified_at = datetime('now')
          WHERE id = ?
            AND password_hash = ?`,
      )
      .run(email, pending.password_hash, userId, WALLET_PASSWORD_SENTINEL);
    db.prepare("DELETE FROM account_email_login_migrations WHERE user_id = ?").run(userId);
    return info;
  })();
  if (updated.changes !== 1) {
    return { ok: false, error: "account migration failed" };
  }

  maybePromoteAdmin(userId, email);
  const row = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId)!;
  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      pelicanUserId: row.pelican_user_id,
      emailVerifiedAt: row.email_verified_at,
    },
  };
}


// --- Login ---

export type LoginResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; error: string; code?: "unverified" | "invalid" };

export async function verifyLogin(
  rawEmail: string,
  password: string,
): Promise<LoginResult> {
  const email = normalizeEmail(rawEmail);
  if (!email || !password) {
    return { ok: false, error: "email and password required", code: "invalid" };
  }
  const row = db
    .prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?")
    .get(email);
  if (!row) {
    return { ok: false, error: "invalid credentials", code: "invalid" };
  }
  // OAuth-only users carry the `$oauth$<provider>` sentinel in
  // password_hash. Give a useful error instead of "invalid credentials"
  // so the user knows to use the provider button.
  if (row.password_hash.startsWith(OAUTH_PASSWORD_PREFIX)) {
    const provider = row.password_hash.slice(OAUTH_PASSWORD_PREFIX.length);
    return {
      ok: false,
      error: `this account signs in with ${provider} — use the ${provider} button`,
      code: "invalid",
    };
  }
  // Wallet-only users have $wallet$ sentinel and a synthetic email.
  // Same idea: tell the user which path they actually need.
  if (row.password_hash === WALLET_PASSWORD_SENTINEL) {
    return {
      ok: false,
      error: "this legacy wallet-only account needs an email login migration",
      code: "invalid",
    };
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return { ok: false, error: "invalid credentials", code: "invalid" };
  }
  if (!row.email_verified_at) {
    return {
      ok: false,
      error: "please verify your email before signing in",
      code: "unverified",
    };
  }
  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      pelicanUserId: row.pelican_user_id,
      emailVerifiedAt: row.email_verified_at,
    },
  };
}

// --- Password reset ---

/**
 * Always returns ok=true regardless of whether the email exists, to avoid
 * leaking which addresses are registered. The email send is silently
 * skipped for unknown addresses.
 */
export async function requestPasswordReset(rawEmail: string): Promise<Result> {
  const emailErr = validateEmail(rawEmail);
  if (emailErr) return { ok: false, error: emailErr };
  const email = normalizeEmail(rawEmail);

  const user = db
    .prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?")
    .get(email);
  if (!user) {
    // Return ok so the response shape doesn't reveal account existence.
    return { ok: true };
  }

  const existing = db
    .prepare<[number], PasswordResetRow>(
      "SELECT * FROM password_reset_codes WHERE user_id = ?",
    )
    .get(user.id);
  if (existing && existing.consumed_at == null) {
    if (secondsSince(existing.last_sent_at) < OTP_RESEND_COOLDOWN_SEC) {
      // Don't tell the caller they're being throttled — same anti-leak
      // reasoning as above. The user just won't see a new email yet.
      return { ok: true };
    }
  }

  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expires = otpExpiry();
  db.prepare(
    `INSERT INTO password_reset_codes (user_id, code_hash, expires_at, attempts, consumed_at, last_sent_at)
     VALUES (?, ?, ?, 0, NULL, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       code_hash    = excluded.code_hash,
       expires_at   = excluded.expires_at,
       attempts     = 0,
       consumed_at  = NULL,
       last_sent_at = datetime('now')`,
  ).run(user.id, codeHash, expires);

  try {
    await sendPasswordResetEmail({ to: email, code });
  } catch (err) {
    // Don't surface the error to the caller (avoids account-existence
    // leak by error-message divergence). Server log is enough.
    console.error("[auth] failed to send reset email", err);
  }
  return { ok: true };
}

/**
 * Verifies the OTP from the reset email and marks the row consumed.
 * On success returns the user id so the caller can drop a short-lived
 * reset-session cookie.
 */
export async function verifyResetCode(
  rawEmail: string,
  code: string,
): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const email = normalizeEmail(rawEmail);
  const user = db
    .prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?")
    .get(email);
  if (!user) return { ok: false, error: "invalid code" };

  const row = db
    .prepare<[number], PasswordResetRow>(
      "SELECT * FROM password_reset_codes WHERE user_id = ?",
    )
    .get(user.id);
  if (!row || row.consumed_at != null) {
    return { ok: false, error: "invalid code" };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    db.prepare("DELETE FROM password_reset_codes WHERE user_id = ?").run(user.id);
    return { ok: false, error: "too many attempts — request a new code" };
  }
  if (isExpired(row.expires_at)) {
    return { ok: false, error: "code expired — request a new one" };
  }
  if (!verifyOtp(code, row.code_hash)) {
    db.prepare(
      "UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = ?",
    ).run(user.id);
    return { ok: false, error: "invalid code" };
  }
  db.prepare(
    "UPDATE password_reset_codes SET consumed_at = datetime('now') WHERE user_id = ?",
  ).run(user.id);
  return { ok: true, userId: user.id };
}

/**
 * Final reset step. Caller has already proven control via verifyResetCode
 * and is holding the short-lived `pods_reset` cookie that contains userId.
 * We re-hash the password, write it, then wipe the reset row.
 */
export async function setPassword(
  userId: number,
  newPassword: string,
): Promise<Result> {
  const pwErr = validatePassword(newPassword);
  if (pwErr) return { ok: false, error: pwErr };
  const user = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!user) return { ok: false, error: "user not found" };
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
  db.prepare("DELETE FROM password_reset_codes WHERE user_id = ?").run(userId);
  return { ok: true };
}

// --- OAuth ---

export type OauthLinkResult =
  | { ok: true; user: CurrentUser; created: boolean }
  | { ok: false; error: string };

/**
 * Find-or-create flow for OAuth callbacks. Three branches:
 *
 *   1. (provider, providerUserId) already in oauth_identities → existing
 *      linked user. Sign them in.
 *   2. Email matches a local user → auto-link the OAuth identity to that
 *      user. Backfills email_verified_at if it was still null (legacy
 *      users from before OTP signup existed).
 *   3. No match → create a Pelican user (via the same idempotent helper
 *      used by OTP signup, so a Pelican-side orphan from a prior failed
 *      attempt is recovered), insert local users row with the
 *      `$oauth$<provider>` sentinel password, link.
 *
 * Auto-link is intentional: both Google and GitHub verify the email
 * before we ever see it (Google: verified_email field; GitHub: only
 * verified primary email is accepted). Linking two sign-in methods to
 * the same verified address is the common modern pattern.
 */
export async function findOrCreateOauthUser(
  provider: "google" | "github",
  providerUserId: string,
  rawEmail: string,
): Promise<OauthLinkResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: "no email returned from provider" };

  // 1. Fast path: already linked.
  const linked = db
    .prepare<[string, string], UserRow>(
      `SELECT u.* FROM users u
         JOIN oauth_identities oi ON oi.user_id = u.id
        WHERE oi.provider = ? AND oi.provider_user_id = ?`,
    )
    .get(provider, providerUserId);
  if (linked) {
    return {
      ok: true,
      created: false,
      user: {
        id: linked.id,
        email: linked.email,
        pelicanUserId: linked.pelican_user_id,
        emailVerifiedAt: linked.email_verified_at,
      },
    };
  }

  // 2. Email matches a local user → link.
  const existing = db
    .prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?")
    .get(email);
  if (existing) {
    db.prepare(
      `INSERT INTO oauth_identities (user_id, provider, provider_user_id, email_at_link)
       VALUES (?, ?, ?, ?)`,
    ).run(existing.id, provider, providerUserId, email);
    if (!existing.email_verified_at) {
      db.prepare(
        "UPDATE users SET email_verified_at = datetime('now') WHERE id = ?",
      ).run(existing.id);
    }
    maybePromoteAdmin(existing.id, email);
    const refreshed = db
      .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
      .get(existing.id)!;
    return {
      ok: true,
      created: false,
      user: {
        id: refreshed.id,
        email: refreshed.email,
        pelicanUserId: refreshed.pelican_user_id,
        emailVerifiedAt: refreshed.email_verified_at,
      },
    };
  }

  // 3. Brand-new user — mint a Pelican account.
  const pelicanPassword =
    "Pp" +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    "!";

  let pelicanUserId: number;
  let clientToken: string;
  try {
    const created = await createPelicanUserAndToken(email, pelicanPassword);
    pelicanUserId = created.pelicanUserId;
    clientToken = created.clientToken;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `pelican user create failed: ${msg}` };
  }

  const sentinel = OAUTH_PASSWORD_PREFIX + provider;
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, pelican_user_id, pelican_client_token, email_verified_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
    .run(email, sentinel, pelicanUserId, clientToken);
  const newId = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO oauth_identities (user_id, provider, provider_user_id, email_at_link)
     VALUES (?, ?, ?, ?)`,
  ).run(newId, provider, providerUserId, email);
  maybePromoteAdmin(newId, email);

  const row = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(newId)!;
  return {
    ok: true,
    created: true,
    user: {
      id: row.id,
      email: row.email,
      pelicanUserId: row.pelican_user_id,
      emailVerifiedAt: row.email_verified_at,
    },
  };
}

// --- Wallet sign-in ---

export type WalletLinkResult =
  | { ok: true; user: CurrentUser; created: boolean }
  | { ok: false; error: string; code?: string };

/**
 * Find-or-create flow for wallet sign-in (a legacy wallet that previously produced a valid signed nonce).
 *
 * Mirrors findOrCreateOauthUser exactly: three branches:
 *
 *   1. (address) already in wallet_identities → existing linked user.
 *      Sign in.
 *   2. — wallet has no email to match on, so the "auto-link by email"
 *      branch that OAuth gets doesn't apply. Skip.
 *   3. No match → fresh wallet-only account. Pelican needs a unique
 *      email + a password — we synthesize both. The user can later
 *      link a real email + provider via the account page.
 *
 * The caller (verify route) is responsible for having proven the
 * signature; this function does no crypto.
 */
export async function findOrCreateWalletUser(
  address: string,
): Promise<WalletLinkResult> {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) {
    return { ok: false, error: "invalid wallet address", code: "bad_address" };
  }

  // 1. Fast path: already linked.
  const linked = db
    .prepare<[string], UserRow>(
      `SELECT u.* FROM users u
         JOIN wallet_identities w ON w.user_id = u.id
        WHERE w.address = ?`,
    )
    .get(address);
  if (linked) {
    return {
      ok: true,
      created: false,
      user: {
        id: linked.id,
        email: linked.email,
        pelicanUserId: linked.pelican_user_id,
        emailVerifiedAt: linked.email_verified_at,
      },
    };
  }

  // 3. Brand-new wallet-only user. Synthesize email + password.
  const syntheticEmail = `${address.toLowerCase()}@${WALLET_EMAIL_DOMAIN}`;
  const pelicanPassword =
    "Pp" +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    "!";

  let pelicanUserId: number;
  let clientToken: string;
  try {
    const created = await createPelicanUserAndToken(
      syntheticEmail,
      pelicanPassword,
    );
    pelicanUserId = created.pelicanUserId;
    clientToken = created.clientToken;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `pelican user create failed: ${msg}` };
  }

  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, pelican_user_id, pelican_client_token, email_verified_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      syntheticEmail,
      WALLET_PASSWORD_SENTINEL,
      pelicanUserId,
      clientToken,
    );
  const newId = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO wallet_identities (user_id, address, is_primary) VALUES (?, ?, 1)`,
  ).run(newId, address);

  const row = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(newId)!;
  return {
    ok: true,
    created: true,
    user: {
      id: row.id,
      email: row.email,
      pelicanUserId: row.pelican_user_id,
      emailVerifiedAt: row.email_verified_at,
    },
  };
}

/**
 * Attach a wallet to an existing (already-logged-in) user. Used when a
 * user signed up with email/OAuth and now wants to also sign in with
 * their wallet. Refuses to attach a wallet already linked to a
 * different user.
 */
export async function linkWalletToUser(
  userId: number,
  address: string,
): Promise<Result> {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) {
    return { ok: false, error: "invalid wallet address" };
  }
  const existing = db
    .prepare<[string], WalletIdentityRow>(
      `SELECT * FROM wallet_identities WHERE address = ?`,
    )
    .get(address);
  if (existing) {
    if (existing.user_id === userId) return { ok: true }; // idempotent
    return {
      ok: false,
      error: "this wallet is already linked to another account",
      code: "already_linked",
    };
  }
  db.prepare(
    `INSERT INTO wallet_identities (user_id, address, is_primary) VALUES (?, ?, 0)`,
  ).run(userId, address);
  return { ok: true };
}

export function listWalletsForUser(userId: number): WalletIdentityRow[] {
  return db
    .prepare<[number], WalletIdentityRow>(
      `SELECT * FROM wallet_identities WHERE user_id = ? ORDER BY is_primary DESC, created_at ASC`,
    )
    .all(userId);
}

export function unlinkWallet(userId: number, address: string): Result {
  const info = db
    .prepare(
      `DELETE FROM wallet_identities WHERE user_id = ? AND address = ?`,
    )
    .run(userId, address);
  if (info.changes === 0) {
    return { ok: false, error: "wallet not linked to this account" };
  }
  return { ok: true };
}

/** Used by the login page to render the "synthetic" wallet-only email
 * as something nicer (e.g. "Wallet <short>...<short>"). */
export function isWalletSyntheticEmail(email: string): boolean {
  return email.endsWith(`@${WALLET_EMAIL_DOMAIN}`);
}
