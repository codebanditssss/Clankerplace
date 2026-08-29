import { test } from "node:test";
import { strict as assert } from "node:assert";

const nodeExec = await import("../../src/lib/node-exec");

test("node exec: a Docker container restart is a retryable not-running state", () => {
  const info = nodeExec.describePodExecError(
    new Error(
      "Error response from daemon: Container abc123 is restarting, wait until the container is running",
    ),
  );

  assert.equal(info.code, "pod_not_running");
  assert.equal(info.status, 409);
});
