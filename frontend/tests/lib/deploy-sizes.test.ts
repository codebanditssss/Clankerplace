import { test } from "node:test";
import { strict as assert } from "node:assert";

const sizes = await import("../../src/lib/deploy-sizes");

test("deploy sizes: parse request payload by id only", () => {
  assert.equal(sizes.deploySizeFromRequest("large")?.id, "large");
  assert.equal(sizes.deploySizeFromRequest({ id: "xlarge" })?.id, "xlarge");
  assert.equal(sizes.deploySizeFromRequest({ id: "bad-size" }), null);
  assert.equal(sizes.deploySizeFromRequest({ memoryMib: 999999 }), null);
});

test("deploy sizes: plan fit checks RAM and CPU caps", () => {
  const xlarge = sizes.deploySizeById("xlarge");
  assert.ok(xlarge);
  assert.equal(sizes.sizeFitsPlan(xlarge, { ramGb: 8, cpu: 4 }), false);
  assert.equal(sizes.sizeFitsPlan(xlarge, { ramGb: 16, cpu: 8 }), true);
  assert.equal(sizes.sizeFitsPlan(xlarge, { ramGb: null, cpu: null }), true);
});

test("deploy sizes: only Hermes accepts explicit size selection", () => {
  assert.equal(sizes.canSelectDeploySizeForPodType("hermes"), true);
  assert.equal(sizes.canSelectDeploySizeForPodType("n8n"), false);
  assert.equal(sizes.canSelectDeploySizeForPodType("code-sandbox"), false);
  assert.equal(sizes.canSelectDeploySizeForPodType("minecraft-paper"), false);
});
