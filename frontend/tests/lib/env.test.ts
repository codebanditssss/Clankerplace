import { test } from "node:test";
import { strict as assert } from "node:assert";

const env = await import("../../src/lib/env");

const goodProd = {
  NODE_ENV: "production",
  SESSION_SECRET: "x",
  PODS_DB_PATH: "/tmp/x.db",
  PELICAN_URL: "https://panel.local",
  PELICAN_API_KEY: "k",
  RESEND: "re_xxx",
  INTERNAL_METER_TOKEN: "t",
  DODO_PAYMENTS_API_KEY: "dodo_test_key",
  DODO_PAYMENTS_WEBHOOK_KEY: "whsec_test",
  DODO_PRODUCT_DEVELOPER: "prod_dev",
  DODO_PRODUCT_PRO: "prod_pro",
  DODO_PRODUCT_SCALE: "prod_scale",
  DODO_CREDIT_PACK_10: "prod_credit_10",
  DODO_CREDIT_PACK_25: "prod_credit_25",
  DODO_CREDIT_PACK_50: "prod_credit_50",
  DODO_CREDIT_PACK_100: "prod_credit_100",
  PODS_PUBLIC_URL: "https://pods.test",
} as NodeJS.ProcessEnv;

test("env: full prod set passes", () => {
  const r = env.checkEnv(goodProd);
  assert.equal(r.ok, true);
  assert.equal(r.missing_required.length, 0);
  assert.equal(r.missing_in_production.length, 0);
});

test("env: missing PELICAN_URL in prod fails", () => {
  const e = { ...goodProd } as NodeJS.ProcessEnv;
  delete e.PELICAN_URL;
  const r = env.checkEnv(e);
  assert.equal(r.ok, false);
  assert.ok(r.missing_in_production.includes("PELICAN_URL"));
});

test("env: missing in dev only warns, doesn't fail", () => {
  const e: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    SESSION_SECRET: "x",
    PODS_DB_PATH: "/tmp/x.db",
  };
  const r = env.checkEnv(e);
  assert.equal(r.ok, true);
  assert.equal(r.missing_required.length, 0);
});

test("env: missing SESSION_SECRET always fails", () => {
  const e = { ...goodProd } as NodeJS.ProcessEnv;
  delete e.SESSION_SECRET;
  const r = env.checkEnv(e);
  assert.equal(r.ok, false);
  assert.ok(r.missing_required.includes("SESSION_SECRET"));
});

test("env: INTERNAL_RECONCILE_TOKEN substitutes for INTERNAL_METER_TOKEN", () => {
  const e = { ...goodProd } as NodeJS.ProcessEnv;
  delete e.INTERNAL_METER_TOKEN;
  e.INTERNAL_RECONCILE_TOKEN = "t2";
  const r = env.checkEnv(e);
  assert.equal(r.ok, true);
});

test("env: missing recommended in prod warns but doesn't fail", () => {
  const e = { ...goodProd } as NodeJS.ProcessEnv;
  delete e.PELICAN_WEBHOOK_SECRET;
  const r = env.checkEnv(e);
  assert.equal(r.ok, true);
  assert.ok(r.missing_recommended.includes("PELICAN_WEBHOOK_SECRET"));
});
