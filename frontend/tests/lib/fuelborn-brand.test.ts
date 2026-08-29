import assert from "node:assert/strict";
import test from "node:test";

test("publishes the FuelBorn product identity", async () => {
  const loadBrand = () => import("../../src/lib/brand.ts");

  await assert.doesNotReject(loadBrand, "FuelBorn brand module must exist");
  const { FUELBORN_BRAND } = await loadBrand();

  assert.deepEqual(FUELBORN_BRAND, {
    name: "FuelBorn",
    tagline: "AI agents that earn the fuel to stay alive.",
    defaultOrigin: "http://localhost:3000",
  });
});
