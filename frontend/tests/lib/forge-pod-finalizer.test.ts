import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ForgeAttemptRow } from "../../src/lib/db";
import type {
  ForgeFinalizationPhase,
  ForgePodFinalizerDependencies,
} from "../../src/lib/fuelborn/forge-finalizer";

const finalization = await import("../../src/lib/fuelborn/forge-finalizer");

const attempt = {
  id: "attempt-123",
  user_id: 601,
  name: "Ember",
  mission: "Keep the community informed.",
  personality: "Calm, direct, and curious.",
} as ForgeAttemptRow;

const pod = { serverId: 77, podFullUuid: "full-pod-77" };

function dependencies(
  overrides: Partial<ForgePodFinalizerDependencies> = {},
): ForgePodFinalizerDependencies {
  return {
    isInstalled: async () => true,
    isExecReady: async () => true,
    readPhase: async () => ({ step: "none" }),
    applyManagedConfiguration: async () => {},
    writePersona: async () => {},
    installSanitizer: async () => {},
    writePhase: async () => {},
    getContainerStartId: async () => "start-old",
    restartPod: async () => {},
    isHealthy: async () => true,
    repairServices: async () => {},
    ...overrides,
  };
}

test("forge pod finalizer: installation and container startup are retryable gates", async () => {
  const installing = finalization.createForgePodFinalizer(
    dependencies({ isInstalled: async () => false }),
  );
  await assert.rejects(
    () => installing(attempt, pod),
    (error: unknown) =>
      error instanceof finalization.ForgePodPendingError &&
      error.stage === "installing",
  );

  const starting = finalization.createForgePodFinalizer(
    dependencies({ isExecReady: async () => false }),
  );
  await assert.rejects(
    () => starting(attempt, pod),
    (error: unknown) =>
      error instanceof finalization.ForgePodPendingError &&
      error.stage === "starting",
  );
});

test("forge pod finalizer: each completed configuration effect gets a durable phase", async () => {
  const calls: string[] = [];
  let phase: ForgeFinalizationPhase = { step: "none" };
  const finalize = finalization.createForgePodFinalizer(
    dependencies({
      readPhase: async () => phase,
      applyManagedConfiguration: async () => {
        calls.push("managed");
      },
      writePersona: async (forge) => {
        calls.push(
          ["persona", forge.name, forge.mission, forge.personality].join(":"),
        );
      },
      installSanitizer: async () => {
        calls.push("sanitizer");
      },
      writePhase: async (_uuid, next) => {
        phase = next;
        calls.push("phase:" + finalization.serializeForgePhase(next));
      },
      getContainerStartId: async () => "start-old",
      restartPod: async () => {
        calls.push("restart");
      },
    }),
  );

  await assert.rejects(() => finalize(attempt, pod), /still starting/);
  assert.deepEqual(calls, [
    "managed",
    "phase:managed",
    "persona:Ember:Keep the community informed.:Calm, direct, and curious.",
    "phase:persona",
    "sanitizer",
    "phase:sanitizer",
    "phase:restart_requested:start-old",
    "restart",
  ]);
});

test("forge pod finalizer: an observed container restart is never repeated", async () => {
  const calls: string[] = [];
  const finalize = finalization.createForgePodFinalizer(
    dependencies({
      readPhase: async () => ({
        step: "restart_requested",
        previousStartId: "start-old",
      }),
      getContainerStartId: async () => "start-new",
      restartPod: async () => {
        calls.push("restart");
      },
      writePhase: async (_uuid, phase) => {
        calls.push("phase:" + finalization.serializeForgePhase(phase));
      },
      isHealthy: async () => true,
    }),
  );

  await finalize(attempt, pod);

  assert.deepEqual(calls, ["phase:restarted:0"]);
});

test("forge pod finalizer: an unobserved restart request is safely retried", async () => {
  const calls: string[] = [];
  const finalize = finalization.createForgePodFinalizer(
    dependencies({
      readPhase: async () => ({
        step: "restart_requested",
        previousStartId: "start-old",
      }),
      getContainerStartId: async () => "start-old",
      restartPod: async () => {
        calls.push("restart");
      },
    }),
  );

  await assert.rejects(() => finalize(attempt, pod), /still starting/);

  assert.deepEqual(calls, ["restart"]);
});

test("forge pod finalizer: unhealthy services are repaired before the retry limit", async () => {
  const calls: string[] = [];
  const finalize = finalization.createForgePodFinalizer(
    dependencies({
      readPhase: async () => ({ step: "restarted", attempts: 5 }),
      isHealthy: async () => false,
      repairServices: async () => {
        calls.push("repair");
      },
      writePhase: async (_uuid, phase) => {
        calls.push("phase:" + finalization.serializeForgePhase(phase));
      },
    }),
  );

  await assert.rejects(() => finalize(attempt, pod), /still starting/);

  assert.deepEqual(calls, ["repair", "phase:restarted:6"]);
});

test("forge pod finalizer: persistent failed health becomes a diagnostic error", async () => {
  const finalize = finalization.createForgePodFinalizer(
    dependencies({
      readPhase: async () => ({ step: "restarted", attempts: 30 }),
      isHealthy: async () => false,
    }),
  );

  await assert.rejects(
    () => finalize(attempt, pod),
    /did not become healthy after 30 readiness checks/,
  );
});

test("forge pod finalizer: phase serialization rejects malformed state", () => {
  const phases: ForgeFinalizationPhase[] = [
    { step: "none" },
    { step: "managed" },
    { step: "persona" },
    { step: "sanitizer" },
    { step: "restart_requested", previousStartId: "2026-08-29T00:00:00Z" },
    { step: "restarted", attempts: 7 },
  ];
  for (const phase of phases) {
    assert.deepEqual(
      finalization.parseForgePhase(finalization.serializeForgePhase(phase)),
      phase,
    );
  }
  assert.throws(
    () => finalization.parseForgePhase("restart_requested:"),
    /invalid Forge finalization phase/,
  );
  assert.throws(
    () => finalization.parseForgePhase("restarted:not-a-number"),
    /invalid Forge finalization phase/,
  );
});

test("forge pod finalizer: only pending lifecycle errors are retryable", () => {
  assert.equal(
    finalization.isForgePodPendingError(
      new finalization.ForgePodPendingError("starting"),
    ),
    true,
  );
  assert.equal(
    finalization.isForgePodPendingError(new Error("managed key missing")),
    false,
  );
});
