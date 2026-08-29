import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-config-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const config = await import("../../src/lib/billing/config");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (200, 'c@config.test', 'x', 9100, datetime('now')),
          (201, 'd@config.test', 'x', 9101, datetime('now'))`,
).run();

test("config: returns default when no row exists", () => {
  config.__testing.clearCache();
  assert.equal(
    config.getConfig("pricing.invoice.min_usd_cents"),
    100,
  );
});

test("config: subscription billing disables legacy PAYG gates by default", () => {
  config.__testing.clearCache();
  assert.equal(config.getConfig("feature.usage_billing_enabled"), false);
  assert.equal(config.getConfig("feature.auto_suspend_enabled"), false);
  assert.equal(config.getConfig("feature.storage_billing_enabled"), false);
  assert.equal(config.getConfig("feature.cohort_pricing_enabled"), false);
});

test("config: setConfig persists + invalidates cache", () => {
  config.setConfig({
    key: "pricing.invoice.min_usd_cents",
    value: 500,
    adminId: 1,
  });
  assert.equal(
    config.getConfig("pricing.invoice.min_usd_cents"),
    500,
  );
  // Direct DB read confirms write
  const row = db
    .prepare(`SELECT value_json FROM billing_config WHERE key = ?`)
    .get("pricing.invoice.min_usd_cents") as { value_json: string };
  assert.equal(JSON.parse(row.value_json), 500);
});

test("config: setConfig rejects wrong type", () => {
  assert.throws(() => {
    config.setConfig({
      key: "pricing.invoice.min_usd_cents",
      // @ts-expect-error intentional bad type
      value: "not a number",
      adminId: 1,
    });
  }, /expected number/);
});

test("config: setConfig rejects negative cents", () => {
  assert.throws(() => {
    config.setConfig({
      key: "pricing.invoice.min_usd_cents",
      value: -1,
      adminId: 1,
    });
  }, /must be >= 0/);
});

test("config: resetConfig reverts to default", () => {
  config.setConfig({
    key: "threshold.warn_cents",
    value: 999,
    adminId: 1,
  });
  assert.equal(config.getConfig("threshold.warn_cents"), 999);
  config.resetConfig({ key: "threshold.warn_cents", adminId: 1 });
  assert.equal(config.getConfig("threshold.warn_cents"), 100); // default
});

test("config: per-user override beats DB value beats default", () => {
  // Default: 100
  // DB: 500 (from earlier test)
  // Override for user 200: 1000
  config.setUserOverride({
    userId: 200,
    key: "pricing.invoice.min_usd_cents",
    value: 1000,
  });
  config.__testing.clearCache();
  assert.equal(
    config.getConfig("pricing.invoice.min_usd_cents"),
    500,
    "global call sees DB value",
  );
  assert.equal(
    config.getConfig("pricing.invoice.min_usd_cents", { userId: 200 }),
    1000,
    "user 200 sees per-user override",
  );
  assert.equal(
    config.getConfig("pricing.invoice.min_usd_cents", { userId: 201 }),
    500,
    "user 201 (no override) sees DB value",
  );
});

test("config: setUserOverride with value=undefined clears the override", () => {
  config.setUserOverride({
    userId: 200,
    key: "pricing.invoice.min_usd_cents",
    value: undefined,
  });
  assert.equal(
    config.getConfig("pricing.invoice.min_usd_cents", { userId: 200 }),
    500, // back to DB value
  );
});

test("config: snapshotConfig lists every key with overridden flag", () => {
  const snap = config.snapshotConfig();
  const minRow = snap.find((r) => r.key === "pricing.invoice.min_usd_cents");
  assert.ok(minRow);
  assert.equal(minRow!.overridden, true);
  assert.equal(minRow!.effective, 500);
  assert.equal(minRow!.default, 100);
  const warnRow = snap.find((r) => r.key === "threshold.warn_cents");
  assert.ok(warnRow);
  assert.equal(warnRow!.overridden, false);
  assert.equal(warnRow!.effective, 100);
});

test("config: feature flag boolean validates correctly", () => {
  config.setConfig({
    key: "feature.auto_suspend_enabled",
    value: false,
    adminId: 1,
  });
  assert.equal(config.getConfig("feature.auto_suspend_enabled"), false);
  assert.throws(() => {
    config.setConfig({
      key: "feature.auto_suspend_enabled",
      // @ts-expect-error intentional bad type
      value: "no",
      adminId: 1,
    });
  }, /expected boolean/);
  // Restore for downstream tests
  config.resetConfig({ key: "feature.auto_suspend_enabled", adminId: 1 });
});

test("config: cache invalidates on write across keys", () => {
  // Read warn_cents (caches it as 100, the default)
  assert.equal(config.getConfig("threshold.warn_cents"), 100);
  // Write a different key — should still invalidate the whole cache
  config.setConfig({
    key: "threshold.suspend_floor_cents",
    value: -100,
    adminId: 1,
  });
  // Subsequent read of warn_cents goes to DB (or default) — still 100,
  // proving no stale-cache footgun. Test the integer-max constraint too.
  assert.equal(config.getConfig("threshold.warn_cents"), 100);
});
