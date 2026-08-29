import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";

const dir = mkdtempSync(join(tmpdir(), "pods-wallet-migrate-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const auth = await import("../../src/lib/auth");
const otp = await import("../../src/lib/otp");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (1, 'abc123wallet@wallet.pods.local', '$wallet$solana', 9701, datetime('now'))`,
).run();
db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (2, 'def456wallet@wallet.pods.local', '$wallet$solana', 9702, datetime('now'))`,
).run();

test("wallet migration: verified email enables normal password login", async () => {
  const passwordHash = await bcrypt.hash("new-password", 10);
  db.prepare(
    `INSERT INTO account_email_login_migrations (user_id, email, password_hash, code_hash, expires_at, attempts, last_sent_at)
     VALUES (1, 'legacy-real@test.local', ?, ?, ?, 0, datetime('now'))`,
  ).run(passwordHash, otp.hashOtp("123456"), otp.otpExpiry());

  const result = auth.confirmWalletEmailLoginMigration(
    1,
    "legacy-real@test.local",
    "123456",
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.user.email, "legacy-real@test.local");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM account_email_login_migrations").get().c,
    0,
  );

  const login = await auth.verifyLogin("legacy-real@test.local", "new-password");
  assert.equal(login.ok, true);
});

test("wallet migration: incorrect code does not update account", async () => {
  const passwordHash = await bcrypt.hash("another-password", 10);
  db.prepare(
    `INSERT INTO account_email_login_migrations (user_id, email, password_hash, code_hash, expires_at, attempts, last_sent_at)
     VALUES (2, 'wrong-code@test.local', ?, ?, ?, 0, datetime('now'))`,
  ).run(passwordHash, otp.hashOtp("222222"), otp.otpExpiry());

  const result = auth.confirmWalletEmailLoginMigration(
    2,
    "wrong-code@test.local",
    "111111",
  );
  assert.equal(result.ok, false);
  assert.equal(
    db.prepare("SELECT email FROM users WHERE id = 2").get().email,
    "def456wallet@wallet.pods.local",
  );
  assert.equal(
    db.prepare("SELECT attempts FROM account_email_login_migrations WHERE email = 'wrong-code@test.local'").get().attempts,
    1,
  );
});
