import { test } from "node:test";
import { strict as assert } from "node:assert";

process.env.DODO_PRODUCT_DEVELOPER = "prod_dev";
process.env.DODO_PRODUCT_PRO = "prod_pro";
process.env.DODO_PRODUCT_SCALE = "prod_scale";
process.env.DODO_CREDIT_PACK_10 = "prod_credit_10";
process.env.DODO_CREDIT_PACK_25 = "prod_credit_25";
process.env.DODO_CREDIT_PACK_50 = "prod_credit_50";
process.env.DODO_CREDIT_PACK_100 = "prod_credit_100";

const plans = await import("../../src/lib/billing/plans");
const planDetails = await import("../../src/lib/billing/plan-details");

test("plans: subscription status allow/block lists are deploy-safe", () => {
  assert.equal(plans.isActiveSubscriptionStatus("active"), true);
  assert.equal(plans.isActiveSubscriptionStatus("trialing"), true);
  assert.equal(plans.isBlockedSubscriptionStatus("cancelled"), true);
  assert.equal(plans.isBlockedSubscriptionStatus("expired"), true);
  assert.equal(plans.isBlockedSubscriptionStatus("unpaid"), true);
  assert.equal(plans.isBlockedSubscriptionStatus("past_due"), true);
  assert.equal(plans.isBlockedSubscriptionStatus("suspended"), true);
  assert.equal(plans.isBlockedSubscriptionStatus("unknown_future_status"), true);
  assert.equal(plans.isBlockedSubscriptionStatus(null), true);
});

test("plans: self-serve Dodo product mapping comes from env", () => {
  assert.equal(plans.getDodoProductForPlan("developer"), "prod_dev");
  assert.equal(plans.getDodoProductForPlan("pro"), "prod_pro");
  assert.equal(plans.getDodoProductForPlan("scale"), "prod_scale");
  assert.equal(plans.planIdForDodoProduct("prod_dev"), "developer");
  assert.equal(plans.planIdForDodoProduct("prod_pro"), "pro");
  assert.equal(plans.planIdForDodoProduct("prod_scale"), "scale");
  assert.equal(plans.planIdForDodoProduct("missing"), null);
});

test("plans: credit packs store exact cent values", () => {
  assert.equal(plans.CREDIT_PACKS.credit_10.amountCents, 1000);
  assert.equal(plans.CREDIT_PACKS.credit_25.amountCents, 2500);
  assert.equal(plans.CREDIT_PACKS.credit_50.amountCents, 5000);
  assert.equal(plans.CREDIT_PACKS.credit_100.amountCents, 10000);
  assert.equal(
    plans.creditPackForDodoProduct("prod_credit_50")?.id,
    "credit_50",
  );
});

test("plans: per-pod resource limits match subscription tiers", () => {
  assert.equal(
    plans.isWithinPlanResourceLimits("developer", {
      memoryMib: 4 * 1024,
      cpuPercent: 200,
    }),
    true,
  );
  assert.equal(
    plans.isWithinPlanResourceLimits("developer", {
      memoryMib: 8 * 1024,
      cpuPercent: 400,
    }),
    false,
  );
  assert.equal(
    plans.isWithinPlanResourceLimits("pro", {
      memoryMib: 8 * 1024,
      cpuPercent: 400,
    }),
    true,
  );
  assert.equal(
    plans.isWithinPlanResourceLimits("pro", {
      memoryMib: 16 * 1024,
      cpuPercent: 800,
    }),
    false,
  );
  assert.equal(
    plans.isWithinPlanResourceLimits("scale", {
      memoryMib: 16 * 1024,
      cpuPercent: 800,
    }),
    true,
  );
  assert.equal(
    plans.isWithinPlanResourceLimits("enterprise", {
      memoryMib: 128 * 1024,
      cpuPercent: 6400,
    }),
    true,
  );
  assert.equal(
    plans.isWithinPlanResourceLimits("unknown", {
      memoryMib: 1024,
      cpuPercent: 50,
    }),
    false,
  );
});

test("plans: displayed self-serve plan details match billing definitions", () => {
  for (const [planId, plan] of Object.entries(plans.SELF_SERVE_PLANS)) {
    const detail =
      planDetails.PLAN_DETAIL_BY_ID[planId as keyof typeof plans.SELF_SERVE_PLANS];
    const monthlyPriceCents = plan.monthlyPriceCents ?? 0;
    const activePodLimit = plan.activePodLimit ?? 0;
    const ramGb = plan.ramGb ?? 0;
    const cpu = plan.cpu ?? 0;
    const perPod = activePodLimit === 1 ? "" : " per Pod";

    assert.equal(detail.name, plan.name);
    assert.equal(detail.price, `$${monthlyPriceCents / 100}/month`);
    assert.equal(
      detail.podLimit,
      `${activePodLimit} Active Pod${activePodLimit === 1 ? "" : "s"}`,
    );
    assert.equal(detail.resources, `${ramGb} GB RAM${perPod} - ${cpu} vCPU${perPod}`);
  }
});
