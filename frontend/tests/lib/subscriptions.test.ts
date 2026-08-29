import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-subs-"));
process.env.PODS_DB_PATH = join(dir, "test.db");

const db = (await import("../../src/lib/db")).default;
const subs = await import("../../src/lib/billing/subscriptions");

db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (1, 'subs@test.local', 'x', 9101, datetime('now'))`,
).run();
db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
   VALUES (2, 'legacy-pods@test.local', 'x', 9102, datetime('now'))`,
).run();
db.prepare(
  `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at, suspended_at)
   VALUES (3, 'suspended@test.local', 'x', 9103, datetime('now'), datetime('now'))`,
).run();

test("subscriptions: no subscription blocks new pod creation", () => {
  const gate = subs.canCreatePod(1);
  assert.equal(gate.ok, false);
  if (!gate.ok) assert.equal(gate.reason, "no_subscription");
});

test("subscriptions: active developer subscription allows first pod", () => {
  subs.upsertSubscriptionFromDodo({
    userId: 1,
    plan: "developer",
    status: "active",
    dodoCustomerId: "cus_1",
    dodoSubscriptionId: "sub_1",
  });
  const gate = subs.canCreatePod(1);
  assert.equal(gate.ok, true);
  if (gate.ok) {
    assert.equal(gate.active_pod_limit, 1);
    assert.equal(gate.active_pod_count, 0);
  }
});

test("subscriptions: stopped pods count toward the active pod limit", () => {
  db.prepare(
    `INSERT INTO pod_meter_state (
       pod_uuid_short, pod_full_uuid, user_id, tier_slug,
       rate_milli_cents_per_hour, ram_mib, disk_mib, cpu_percent,
       state, last_billed_at, sub_micro_cents, created_at, updated_at
     )
     VALUES ('podsub1', 'full-podsub1', 1, 'medium', 0, 4096, 20000, 200,
             'stopped', 0, 0, 0, 0)`,
  ).run();

  const gate = subs.canCreatePod(1);
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.equal(gate.reason, "pod_limit_exceeded");
    assert.equal(gate.active_pod_count, 1);
    assert.equal(gate.active_pod_limit, 1);
  }
});

test("subscriptions: blocked statuses reject deploys", () => {
  subs.upsertSubscriptionFromDodo({
    userId: 1,
    plan: "developer",
    status: "past_due",
    dodoCustomerId: "cus_1",
    dodoSubscriptionId: "sub_1",
  });
  const gate = subs.canCreatePod(1);
  assert.equal(gate.ok, false);
  if (!gate.ok) assert.equal(gate.reason, "subscription_inactive");
});

test("subscriptions: account suspension blocks deploys even with active subscription", () => {
  subs.upsertSubscriptionFromDodo({
    userId: 3,
    plan: "scale",
    status: "active",
    dodoCustomerId: "cus_suspended",
    dodoSubscriptionId: "sub_suspended",
  });
  const gate = subs.canCreatePod(3);
  assert.equal(gate.ok, false);
  if (!gate.ok) assert.equal(gate.reason, "account_suspended");
});

test("subscriptions: legacy pod_domains rows count toward pod limits", () => {
  subs.upsertSubscriptionFromDodo({
    userId: 2,
    plan: "developer",
    status: "active",
    dodoCustomerId: "cus_legacy",
    dodoSubscriptionId: "sub_legacy",
  });
  db.prepare(
    `INSERT INTO pod_domains (slug, pod_uuid_short, pod_full_uuid, port, user_id, kind)
     VALUES ('legacy-sub-domain', 'legsub01', 'full-legsub01', 8080, 2, 'auto')`,
  ).run();
  const gate = subs.canCreatePod(2);
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.equal(gate.reason, "pod_limit_exceeded");
    assert.equal(gate.active_pod_count, 1);
  }
});
