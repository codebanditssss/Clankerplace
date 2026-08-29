import { test } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pods-cohort-"));
process.env.PODS_DB_PATH = join(dir, "test.db");
// Test env (NODE_ENV !== production). Cast because @types/node now
// declares NODE_ENV as readonly; runtime assignment still works.
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

const db = (await import("../../src/lib/db")).default;
const cohort = await import("../../src/lib/billing/cohort");
const config = await import("../../src/lib/billing/config");
const ledger = await import("../../src/lib/billing/ledger");
const meter = await import("../../src/lib/billing/meter");

config.setConfig({
  key: "feature.cohort_pricing_enabled",
  value: true,
  adminId: 0,
});

/**
 * Coverage of the cohort-based pricing model (1-free-pod variant):
 *
 *   users.id 1..founding_size   → 'founding'    → ONE free pod
 *   users.id ..+paid_size       → 'paid_cohort' → needs $5 unlock, then ONE free pod
 *   users.id > total            → 'payg'
 *
 * Plus the master flag (feature.cohort_pricing_enabled) and admin-tunable
 * sizes. The free slot is tracked per-user via
 *   users.cohort_free_pod_uuid_short
 * and claimed/released by deploy/delete routes.
 */

// Seed users with predictable IDs 1..20.
for (let id = 1; id <= 20; id++) {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, pelican_user_id, email_verified_at)
     VALUES (?, ?, 'x', ?, datetime('now'))`,
  ).run(id, `u${id}@cohort.test`, 8000 + id);
}

test("cohort: pure id-based assignment (default sizes 5/10)", () => {
  assert.equal(cohort.cohortForUserId(1), "founding");
  assert.equal(cohort.cohortForUserId(5), "founding");
  assert.equal(cohort.cohortForUserId(6), "paid_cohort");
  assert.equal(cohort.cohortForUserId(15), "paid_cohort");
  assert.equal(cohort.cohortForUserId(16), "payg");
  assert.equal(cohort.cohortForUserId(9999), "payg");
});

test("cohort: founding users are eligible without paying", () => {
  assert.equal(cohort.isUserCohortEligible(1), true);
  assert.equal(cohort.isUserCohortEligible(5), true);
});

test("cohort: paid_cohort starts LOCKED (not eligible until $5 paid)", () => {
  assert.equal(cohort.isUserCohortEligible(6), false);
  // canDeployAnotherPod should return ok=false with needs_topup
  const gate = cohort.canDeployAnotherPod(6);
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.equal(gate.reason, "needs_topup");
    assert.equal(gate.required_cents, 500);
    assert.equal(gate.have_topped_up_cents, 0);
  }
});

test("cohort: paying $5 unlocks paid_cohort", () => {
  // Insert a fake invoice + credit for user 6.
  db.prepare(
    `INSERT INTO invoices (
       id, user_id, usd_amount_cents, currency, token_amount,
       deposit_address, treasury_address, price_quote_usd,
       quote_expires_at, status, created_at, updated_at
     ) VALUES ('inv-coh-6', 6, 500, 'USDC', '500000',
              'depCoh6', 'treaCoh6', '1.0', 9999999999, 'confirmed', 0, 0)`,
  ).run();
  ledger.creditInvoice({
    invoiceId: "inv-coh-6",
    userId: 6,
    usdAmountCents: 500,
  });
  assert.equal(cohort.isUserCohortEligible(6), true);
  const gate = cohort.canDeployAnotherPod(6);
  assert.equal(gate.ok, true);
  if (gate.ok) {
    assert.equal(gate.tier, "paid_cohort_free");
    assert.equal(gate.will_be_free, true);
  }
});

test("cohort: PAYG users get standard tier (no special gate)", () => {
  const gate = cohort.canDeployAnotherPod(16);
  assert.equal(gate.ok, true);
  if (gate.ok) {
    assert.equal(gate.tier, "payg");
    assert.equal(gate.will_be_free, false);
  }
});

test("cohort: master flag off → everyone is PAYG", () => {
  config.setConfig({
    key: "feature.cohort_pricing_enabled",
    value: false,
    adminId: 0,
  });
  assert.equal(cohort.cohortForUserId(1), "payg");
  assert.equal(cohort.isUserCohortEligible(1), false);
  config.setConfig({
    key: "feature.cohort_pricing_enabled",
    value: true,
    adminId: 0,
  });
});

test("cohort: admin can bump founding_size to grow the cohort", () => {
  assert.equal(cohort.cohortForUserId(10), "paid_cohort");
  assert.equal(cohort.isUserCohortEligible(10), false);
  config.setConfig({
    key: "cohort.founding_size",
    value: 10,
    adminId: 0,
  });
  assert.equal(cohort.cohortForUserId(10), "founding");
  assert.equal(cohort.isUserCohortEligible(10), true);
  config.resetConfig({ key: "cohort.founding_size", adminId: 0 });
});

test("cohort: admin can raise unlock fee from $5 to $25", () => {
  let gate = cohort.canDeployAnotherPod(7);
  assert.equal(gate.ok, false);
  config.setConfig({
    key: "cohort.paid_unlock_cents",
    value: 2500,
    adminId: 0,
  });
  gate = cohort.canDeployAnotherPod(7);
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.equal(gate.required_cents, 2500);
    assert.match(gate.message, /\$25/);
  }
  db.prepare(
    `INSERT INTO invoices (
       id, user_id, usd_amount_cents, currency, token_amount,
       deposit_address, treasury_address, price_quote_usd,
       quote_expires_at, status, created_at, updated_at
     ) VALUES ('inv-coh-7', 7, 2500, 'USDC', '2500000',
              'depCoh7', 'treaCoh7', '1.0', 9999999999, 'confirmed', 0, 0)`,
  ).run();
  ledger.creditInvoice({
    invoiceId: "inv-coh-7",
    userId: 7,
    usdAmountCents: 2500,
  });
  gate = cohort.canDeployAnotherPod(7);
  assert.equal(gate.ok, true);
  config.resetConfig({ key: "cohort.paid_unlock_cents", adminId: 0 });
});

test("cohort: 1-free-pod model — first pod free, second pod PAYG (founding)", () => {
  // User 1 deploys their first pod. Meter should skip debit for the
  // CLAIMED pod only.
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "coh-pod-1a",
    pod_full_uuid: "full-coh-pod-1a",
    user_id: 1,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "running",
  });
  // Claim the slot (deploy route would do this after Pelican create).
  const claimed = cohort.claimFreePodSlot(1, "coh-pod-1a");
  assert.equal(claimed, true, "first claim should succeed");

  // Tick the claimed pod → should NOT bill.
  const lid1 = meter.tickPod(
    {
      pod_uuid_short: "coh-pod-1a",
      user_id: 1,
      rate_milli_cents_per_hour: 5000,
      last_billed_at: 0,
      sub_micro_cents: 0,
      tier_slug: "medium",
    },
    3600,
  );
  assert.equal(lid1, null, "claimed (free) pod should not be billed");
  assert.equal(ledger.getBalanceCents(1), 0);

  // User 1 deploys a 2nd pod. Claim attempt should FAIL (slot taken).
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "coh-pod-1b",
    pod_full_uuid: "full-coh-pod-1b",
    user_id: 1,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "running",
  });
  const reclaim = cohort.claimFreePodSlot(1, "coh-pod-1b");
  assert.equal(reclaim, false, "second claim must fail (slot already taken)");

  // Tick the 2nd pod → SHOULD bill (PAYG).
  const lid2 = meter.tickPod(
    {
      pod_uuid_short: "coh-pod-1b",
      user_id: 1,
      rate_milli_cents_per_hour: 5000,
      last_billed_at: 0,
      sub_micro_cents: 0,
      tier_slug: "medium",
    },
    3600,
  );
  assert.ok(lid2 != null, "2nd pod must bill PAYG");
  assert.equal(ledger.getBalanceCents(1), -5);
});

test("cohort: deleting the free pod releases the slot", () => {
  // User 2 deploys, claims slot, then deletes.
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "coh-pod-2a",
    pod_full_uuid: "full-coh-pod-2a",
    user_id: 2,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "running",
  });
  cohort.claimFreePodSlot(2, "coh-pod-2a");
  assert.equal(cohort.getFreePodUuid(2), "coh-pod-2a");

  // Delete that pod → release.
  cohort.releaseFreePodSlot(2, "coh-pod-2a");
  assert.equal(cohort.getFreePodUuid(2), null);

  // Next deploy claims a fresh slot.
  const claimed = cohort.claimFreePodSlot(2, "coh-pod-2b");
  assert.equal(claimed, true);
  assert.equal(cohort.getFreePodUuid(2), "coh-pod-2b");
});

test("cohort: release is idempotent and scoped — wrong uuid is no-op", () => {
  // User 3 has no claim. Releasing a nonsense uuid is harmless.
  cohort.releaseFreePodSlot(3, "ghost");
  assert.equal(cohort.getFreePodUuid(3), null);

  // User 3 claims a pod. Releasing a DIFFERENT uuid leaves it alone.
  cohort.claimFreePodSlot(3, "coh-pod-3a");
  cohort.releaseFreePodSlot(3, "coh-pod-WRONG");
  assert.equal(cohort.getFreePodUuid(3), "coh-pod-3a");
});

test("cohort: meter bills PAYG user normally (id 16+)", () => {
  meter.upsertMeterStateFromPelican({
    pod_uuid_short: "coh-pod-16",
    pod_full_uuid: "full-coh-pod-16",
    user_id: 16,
    ramMib: 4096,
    diskMib: 20000,
    cpuPercent: 200,
    initialState: "running",
  });
  const lid = meter.tickPod(
    {
      pod_uuid_short: "coh-pod-16",
      user_id: 16,
      rate_milli_cents_per_hour: 5000,
      last_billed_at: 0,
      sub_micro_cents: 0,
      tier_slug: "medium",
    },
    3600,
  );
  assert.ok(lid != null, "PAYG user should be billed");
  assert.equal(ledger.getBalanceCents(16), -5);
});

test("cohort: getCohortSummary reports correct effective_tier", () => {
  // User 1 — founding. Hasn't claimed yet.
  const u1 = cohort.getCohortSummary(1);
  assert.equal(u1.cohort, "founding");
  // From the earlier test, user 1 has cohort_free_pod_uuid_short=coh-pod-1a
  // (the slot is in use). So effective tier = free_in_use.
  assert.equal(u1.effective_tier, "free_in_use");
  assert.equal(u1.free_pod_uuid_short, "coh-pod-1a");

  // User 4 — founding, has not claimed any pod.
  const u4 = cohort.getCohortSummary(4);
  assert.equal(u4.cohort, "founding");
  assert.equal(u4.effective_tier, "free_available");
  assert.equal(u4.free_pod_uuid_short, null);

  // User 7 — paid_cohort, paid the unlock in the prior test.
  const u7 = cohort.getCohortSummary(7);
  assert.equal(u7.cohort, "paid_cohort");
  // No pod claimed yet → free_available.
  assert.equal(u7.effective_tier, "free_available");

  // User 8 — paid_cohort, still locked.
  const u8 = cohort.getCohortSummary(8);
  assert.equal(u8.cohort, "paid_cohort");
  assert.equal(u8.effective_tier, "paid_cohort_locked");

  // User 16 — PAYG.
  const u16 = cohort.getCohortSummary(16);
  assert.equal(u16.cohort, "payg");
  assert.equal(u16.effective_tier, "payg");
  assert.equal(u16.free_pod_uuid_short, null);
});

test("cohort: invalid userId is treated as payg (safe default)", () => {
  assert.equal(cohort.cohortForUserId(0), "payg");
  assert.equal(cohort.cohortForUserId(-1), "payg");
  assert.equal(cohort.cohortForUserId(NaN), "payg");
});

test("cohort: isUserFreeForever is deprecated and throws outside production", () => {
  assert.throws(() => cohort.isUserFreeForever(1), /deprecated/);
});
