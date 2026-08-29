import { test } from "node:test";
import { strict as assert } from "node:assert";

const pricing = await import("../../src/lib/billing/pricing");

test("pricing: tier rates match spec ($0.012, $0.025, $0.05, $0.10, $0.20)", () => {
  assert.equal(pricing.TIER_BY_SLUG.nano.rateMilliCentsPerHour, 1200);
  assert.equal(pricing.TIER_BY_SLUG.small.rateMilliCentsPerHour, 2500);
  assert.equal(pricing.TIER_BY_SLUG.medium.rateMilliCentsPerHour, 5000);
  assert.equal(pricing.TIER_BY_SLUG.large.rateMilliCentsPerHour, 10000);
  assert.equal(pricing.TIER_BY_SLUG.xlarge.rateMilliCentsPerHour, 20000);
});

test("pricing: monthly cents are rate × 730 / 1000", () => {
  // nano: 1200 × 730 / 1000 = 876¢ = $8.76
  assert.equal(pricing.TIER_BY_SLUG.nano.monthlyCents, 876);
  // medium: 5000 × 730 / 1000 = 3650¢ = $36.50
  assert.equal(pricing.TIER_BY_SLUG.medium.monthlyCents, 3650);
});

test("pricing: tierFromRam picks the smallest tier that fits, rounding up", () => {
  // 1 GB exactly → nano
  assert.equal(pricing.tierFromRam(1024).slug, "nano");
  // 1.5 GB → small (next tier up)
  assert.equal(pricing.tierFromRam(1536).slug, "small");
  // 2 GB exactly → small
  assert.equal(pricing.tierFromRam(2048).slug, "small");
  // 4 GB → medium
  assert.equal(pricing.tierFromRam(4096).slug, "medium");
  // 32 GB → bigger than xlarge → still xlarge
  assert.equal(pricing.tierFromRam(32 * 1024).slug, "xlarge");
});

test("pricing: tierFromRam handles degenerate inputs", () => {
  assert.equal(pricing.tierFromRam(0).slug, "nano");
  assert.equal(pricing.tierFromRam(-1).slug, "nano");
  assert.equal(pricing.tierFromRam(NaN).slug, "nano");
});

test("pricing: burnPerDayCents sums rates × 24 / 1000", () => {
  // 1 medium pod: 5000 × 24 / 1000 = 120¢ = $1.20/day
  assert.equal(pricing.burnPerDayCents([5000]), 120);
  // 2 medium + 1 small: (5000+5000+2500) × 24 / 1000 = 300¢
  assert.equal(pricing.burnPerDayCents([5000, 5000, 2500]), 300);
  assert.equal(pricing.burnPerDayCents([]), 0);
});

test("pricing: storageMilliCentsPerDay matches $0.10/GB-mo spec (default config)", () => {
  // Default config: pricing.storage.cents_per_gb_month = 10
  // 1 GB: 1 × 10 × 1000 / 30 = 333.33 → ceil = 334 milli-cents/day
  //       × 30 days ≈ 10000 milli-cents = ~$0.10/mo ✓
  assert.equal(pricing.storageMilliCentsPerDay(1 * 1024), 334);
  // 5 GB: 50000/30 = 1666.67 → 1667 → ~$0.50/mo
  assert.equal(pricing.storageMilliCentsPerDay(5 * 1024), 1667);
  // 20 GB: 200000/30 = 6666.67 → 6667 → $2.00/mo (spec)
  assert.equal(pricing.storageMilliCentsPerDay(20 * 1024), 6667);
  // 30 GB: 300000/30 = 10000 milli-cents/day → $3.00/mo
  assert.equal(pricing.storageMilliCentsPerDay(30 * 1024), 10000);
});
