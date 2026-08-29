import "server-only";
import type { ForgeAttemptRow } from "../db";

export type ForgeFinalizationPhase =
  | { step: "none" }
  | { step: "managed" }
  | { step: "persona" }
  | { step: "sanitizer" }
  | { step: "restart_requested"; previousStartId: string }
  | { step: "restarted"; attempts: number };

export type ForgeFinalizerPod = {
  serverId: number;
  podFullUuid: string;
};

export type ForgePodFinalizerDependencies = {
  isInstalled(serverId: number): Promise<boolean>;
  isExecReady(podFullUuid: string): Promise<boolean>;
  readPhase(podFullUuid: string): Promise<ForgeFinalizationPhase>;
  applyManagedConfiguration(
    attempt: ForgeAttemptRow,
    podFullUuid: string,
  ): Promise<void>;
  writePersona(
    attempt: ForgeAttemptRow,
    podFullUuid: string,
  ): Promise<void>;
  installSanitizer(podFullUuid: string): Promise<void>;
  writePhase(
    podFullUuid: string,
    phase: Exclude<ForgeFinalizationPhase, { step: "none" }>,
  ): Promise<void>;
  getContainerStartId(podFullUuid: string): Promise<string>;
  restartPod(podFullUuid: string): Promise<void>;
  isHealthy(podFullUuid: string): Promise<boolean>;
  repairServices(podFullUuid: string): Promise<void>;
};

const MAX_READINESS_ATTEMPTS = 30;
const REPAIR_ATTEMPTS = new Set([5, 15]);

export class ForgePodPendingError extends Error {
  stage: "installing" | "starting";

  constructor(stage: "installing" | "starting") {
    super(`Forge pod is still ${stage}`);
    this.name = "ForgePodPendingError";
    this.stage = stage;
  }
}

export function isForgePodPendingError(
  error: unknown,
): error is ForgePodPendingError {
  return error instanceof ForgePodPendingError;
}

export function createForgePodFinalizer(
  dependencies: ForgePodFinalizerDependencies,
) {
  return async function finalizeForgePod(
    attempt: ForgeAttemptRow,
    pod: ForgeFinalizerPod,
  ): Promise<void> {
    if (!(await dependencies.isInstalled(pod.serverId))) {
      throw new ForgePodPendingError("installing");
    }
    if (!(await dependencies.isExecReady(pod.podFullUuid))) {
      throw new ForgePodPendingError("starting");
    }

    let phase = await dependencies.readPhase(pod.podFullUuid);
    if (phase.step === "none") {
      await dependencies.applyManagedConfiguration(attempt, pod.podFullUuid);
      phase = { step: "managed" };
      await dependencies.writePhase(pod.podFullUuid, phase);
    }
    if (phase.step === "managed") {
      await dependencies.writePersona(attempt, pod.podFullUuid);
      phase = { step: "persona" };
      await dependencies.writePhase(pod.podFullUuid, phase);
    }
    if (phase.step === "persona") {
      await dependencies.installSanitizer(pod.podFullUuid);
      phase = { step: "sanitizer" };
      await dependencies.writePhase(pod.podFullUuid, phase);
    }
    if (phase.step === "sanitizer") {
      const previousStartId = await dependencies.getContainerStartId(
        pod.podFullUuid,
      );
      phase = { step: "restart_requested", previousStartId };
      await dependencies.writePhase(pod.podFullUuid, phase);
      await dependencies.restartPod(pod.podFullUuid);
      throw new ForgePodPendingError("starting");
    }
    if (phase.step === "restart_requested") {
      const currentStartId = await dependencies.getContainerStartId(
        pod.podFullUuid,
      );
      if (currentStartId === phase.previousStartId) {
        await dependencies.restartPod(pod.podFullUuid);
        throw new ForgePodPendingError("starting");
      }
      phase = { step: "restarted", attempts: 0 };
      await dependencies.writePhase(pod.podFullUuid, phase);
    }

    if (await dependencies.isHealthy(pod.podFullUuid)) return;
    if (phase.attempts >= MAX_READINESS_ATTEMPTS) {
      throw new Error(
        `Forge pod did not become healthy after ${MAX_READINESS_ATTEMPTS} readiness checks`,
      );
    }
    if (REPAIR_ATTEMPTS.has(phase.attempts)) {
      await dependencies.repairServices(pod.podFullUuid);
    }
    phase = { step: "restarted", attempts: phase.attempts + 1 };
    await dependencies.writePhase(pod.podFullUuid, phase);
    throw new ForgePodPendingError("starting");
  };
}

export function serializeForgePhase(phase: ForgeFinalizationPhase): string {
  if (phase.step === "restart_requested") {
    if (!phase.previousStartId || /[\r\n]/.test(phase.previousStartId)) {
      throw new Error("invalid Forge container start id");
    }
    return `restart_requested:${phase.previousStartId}`;
  }
  if (phase.step === "restarted") {
    if (!Number.isSafeInteger(phase.attempts) || phase.attempts < 0) {
      throw new Error("invalid Forge readiness attempt count");
    }
    return `restarted:${phase.attempts}`;
  }
  return phase.step;
}

export function parseForgePhase(raw: string): ForgeFinalizationPhase {
  const value = raw.trim();
  if (
    value === "none" ||
    value === "managed" ||
    value === "persona" ||
    value === "sanitizer"
  ) {
    return { step: value };
  }
  if (value.startsWith("restart_requested:")) {
    const previousStartId = value.slice("restart_requested:".length);
    if (previousStartId && !/[\r\n]/.test(previousStartId)) {
      return { step: "restart_requested", previousStartId };
    }
  }
  if (value.startsWith("restarted:")) {
    const attempts = Number(value.slice("restarted:".length));
    if (Number.isSafeInteger(attempts) && attempts >= 0) {
      return { step: "restarted", attempts };
    }
  }
  throw new Error("invalid Forge finalization phase");
}
