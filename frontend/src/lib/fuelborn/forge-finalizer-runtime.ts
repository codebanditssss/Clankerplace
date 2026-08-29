import "server-only";
import { withLock } from "../billing/locks";
import { applyManagedConfig, managedGatewayV1 } from "../managed-ai";
import {
  describePodExecError,
  execInPod,
  execInPodStdin,
} from "../node-exec";
import { composeForgePersona, writePersona } from "../persona";
import { restartGateway } from "../pod-config";
import { installSanitizer, restartPod as restartContainer } from "../sanitizer";
import {
  createForgePodFinalizer,
  ForgePodPendingError,
  parseForgePhase,
  serializeForgePhase,
} from "./forge-finalizer";

type ApplicationApi = (path: string) => Promise<any>;

const PHASE_PATH = "/home/container/.hermes/.fuelborn-forge-phase";

function isContainerStarting(error: unknown): boolean {
  const { code } = describePodExecError(error);
  return code === "pod_not_running" || code === "pod_not_found";
}

async function withStartingRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isContainerStarting(error)) {
      throw new ForgePodPendingError("starting");
    }
    throw error;
  }
}

export function createRuntimeForgePodFinalizer(api: ApplicationApi) {
  const finalize = createForgePodFinalizer({
    isInstalled: async (serverId) => {
      const server = (await api(`/servers/${serverId}`)) as {
        attributes: { container: { installed: number } };
      };
      return server.attributes.container.installed === 1;
    },
    isExecReady: async (podFullUuid) => {
      try {
        await execInPod(
          podFullUuid,
          ["exec", podFullUuid, "true"],
          { timeoutMs: 6_000, maxBuffer: 4_096 },
        );
        return true;
      } catch (error) {
        if (isContainerStarting(error)) return false;
        throw error;
      }
    },
    readPhase: async (podFullUuid) =>
      withStartingRetry(async () => {
        const { stdout } = await execInPod(
          podFullUuid,
          [
            "exec",
            podFullUuid,
            "bash",
            "-lc",
            `if [ -f ${PHASE_PATH} ]; then cat ${PHASE_PATH}; else printf 'none\\n'; fi`,
          ],
          { timeoutMs: 6_000, maxBuffer: 4_096 },
        );
        return parseForgePhase(stdout);
      }),
    applyManagedConfiguration: async (attempt, podFullUuid) =>
      withStartingRetry(() => applyManagedConfig(podFullUuid, attempt.user_id)),
    writePersona: async (attempt, podFullUuid) =>
      withStartingRetry(() =>
        writePersona(
          podFullUuid,
          composeForgePersona({
            name: attempt.name,
            mission: attempt.mission,
            personality: attempt.personality,
          }),
        ),
      ),
    installSanitizer: async (podFullUuid) =>
      withStartingRetry(() =>
        installSanitizer(podFullUuid, managedGatewayV1()),
      ),
    writePhase: async (podFullUuid, phase) =>
      withStartingRetry(() =>
        execInPodStdin(
          podFullUuid,
          [
            "exec",
            "-i",
            podFullUuid,
            "bash",
            "-lc",
            `mkdir -p /home/container/.hermes && tmp=${PHASE_PATH}.tmp.$$ && cat > "$tmp" && mv "$tmp" ${PHASE_PATH}`,
          ],
          `${serializeForgePhase(phase)}\n`,
        ),
      ),
    getContainerStartId: async (podFullUuid) =>
      withStartingRetry(async () => {
        const { stdout } = await execInPod(
          podFullUuid,
          ["inspect", "--format", "{{.State.StartedAt}}", podFullUuid],
          { timeoutMs: 6_000, maxBuffer: 4_096 },
        );
        const startId = stdout.trim();
        if (!startId) throw new Error("Forge pod container has no start time");
        return startId;
      }),
    restartPod: async (podFullUuid) =>
      withStartingRetry(() => restartContainer(podFullUuid)),
    isHealthy: async (podFullUuid) =>
      withStartingRetry(async () => {
        const { stdout } = await execInPod(
          podFullUuid,
          [
            "exec",
            podFullUuid,
            "bash",
            "-lc",
            "if pod-gateway status 2>/dev/null | grep -q 'gateway: running' " +
              "&& curl -fsS --max-time 2 http://127.0.0.1:8765/healthz >/dev/null; " +
              "then echo ready; else echo pending; fi",
          ],
          { timeoutMs: 6_000, maxBuffer: 4_096 },
        );
        return stdout.trim() === "ready";
      }),
    repairServices: async (podFullUuid) =>
      withStartingRetry(async () => {
        await installSanitizer(podFullUuid, managedGatewayV1());
        await restartGateway(podFullUuid);
      }),
  });

  return (
    attempt: Parameters<typeof finalize>[0],
    pod: Parameters<typeof finalize>[1],
  ) =>
    withLock(`forge-finalize:${pod.podFullUuid}`, () =>
      finalize(attempt, pod),
    );
}
