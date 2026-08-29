// Helpers for the in-pod content-sanitizer proxy.
//
// On the host side (this Node process), we ship sanitizer.py + a
// launcher into the pod, write the upstream URL into sanitizer.env,
// and kick off the script. From that point Hermes' model.base_url
// points at http://127.0.0.1:8765/v1 instead of the real provider,
// and the sanitizer pads any empty content blocks before forwarding.
//
// Why this lives separate from persona.ts: this is provider-shape
// plumbing, not agent persona/notes. Keeping concerns split.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execInPod, execInPodStdin } from "@/lib/node-exec";

const PODS_DIR = "/home/container/.pods";
export const SANITIZER_PROXY_PORT = 8765;
export const SANITIZER_PROXY_BASE = `http://127.0.0.1:${SANITIZER_PROXY_PORT}`;

// In the Next.js build the package root is at .../frontend/.next/server/...
// so reading scripts/pod-sanitizer/* needs to be relative to the source
// tree. process.cwd() lands at the frontend root in production.
function readBundled(name: string): string {
  return readFileSync(
    join(process.cwd(), "scripts", "pod-sanitizer", name),
    "utf8",
  );
}

/**
 * Copy sanitizer.py + sanitizer.sh into the pod, write sanitizer.env
 * with the user's upstream URL, then start the proxy.
 *
 * `upstreamBaseUrl` is the URL Hermes WOULD have called directly
 * (e.g. https://api.example.com/v1). The proxy strips any /v1 suffix
 * internally — it forwards request.path unchanged onto the upstream
 * root, and Hermes' base_url gets retargeted to localhost:8765/v1.
 */
export async function installSanitizer(
  podFullUuid: string,
  upstreamBaseUrl: string,
): Promise<void> {
  // Sanitizer prefers the upstream root (without /v1), since Hermes
  // sends the full path itself.
  const upstreamRoot = upstreamBaseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");

  const scriptPy = readBundled("sanitizer.py");
  const scriptSh = readBundled("sanitizer.sh");
  const envFile =
    `PODS_SANITIZER_UPSTREAM=${upstreamRoot}\n` +
    `PODS_SANITIZER_PORT=${SANITIZER_PROXY_PORT}\n`;

  // Pipe each file through `docker exec -i ... cat > target`.
  await writeFileInPod(
    podFullUuid,
    `${PODS_DIR}/sanitizer.py`,
    scriptPy,
    /*chmod*/ "0755",
  );
  await writeFileInPod(
    podFullUuid,
    `${PODS_DIR}/sanitizer.sh`,
    scriptSh,
    "0755",
  );
  await writeFileInPod(
    podFullUuid,
    `${PODS_DIR}/sanitizer.env`,
    envFile,
    "0600",
  );

  // Launch / relaunch (node-aware).
  await execInPod(
    podFullUuid,
    ["exec", podFullUuid, "bash", `${PODS_DIR}/sanitizer.sh`],
    { timeoutMs: 15_000, maxBuffer: 64 * 1024 },
  );
}

/**
 * Update /usr/local/bin/pods-ml-pod-init.sh inside the pod to the
 * current repo version. The script unsets the install-time
 * HERMES_INFERENCE_* env vars that Pelican otherwise leaves in the
 * runtime container (which then trip Hermes' oneshot
 * detect_provider_for_model auto-override). Until the docker image
 * is rebuilt, this per-pod patch is how the change ships.
 *
 * Caller is responsible for restarting the container afterwards so
 * PID 1 picks up the new script.
 */
export async function patchPodInit(podFullUuid: string): Promise<void> {
  // Source of truth lives at images/sandbox-ubuntu/pods-ml-pod-init.sh;
  // the frontend keeps a copy alongside the sanitizer scripts so it can
  // be bundled with the Next.js deploy. Keep in sync (one of two paths
  // until we rebuild the docker image with the new script).
  const script = readBundled("pods-ml-pod-init.sh");
  await writeFileInPod(
    podFullUuid,
    "/tmp/pods-ml-pod-init.sh",
    script,
    "0755",
  );
  await execInPod(
    podFullUuid,
    [
      "exec",
      podFullUuid,
      "bash",
      "-lc",
      "sudo cp /tmp/pods-ml-pod-init.sh /usr/local/bin/pods-ml-pod-init.sh && sudo chmod +x /usr/local/bin/pods-ml-pod-init.sh",
    ],
    { timeoutMs: 6000 },
  );
}

/**
 * docker-restart the container so PID 1 re-execs with the new
 * pods-ml-pod-init.sh + clean env. Sanitizer auto-starts because the
 * new script checks for /home/container/.pods/sanitizer.sh.
 */
export async function restartPod(podFullUuid: string): Promise<void> {
  await execInPod(podFullUuid, ["restart", podFullUuid], { timeoutMs: 30_000 });
}

/**
 * Idempotent: bring down the sanitizer if running. Called when the
 * provider switch flips back to a mode that talks to the upstream
 * directly (e.g. anthropic_messages, which has its own native
 * sanitization, or switching off a custom provider entirely).
 */
export async function stopSanitizer(podFullUuid: string): Promise<void> {
  await execInPod(
    podFullUuid,
    [
      "exec",
      podFullUuid,
      "bash",
      "-lc",
      `if [ -f ${PODS_DIR}/sanitizer.pid ]; then ` +
        `pid=$(cat ${PODS_DIR}/sanitizer.pid); ` +
        `kill -TERM "$pid" 2>/dev/null || true; sleep 1; ` +
        `kill -KILL "$pid" 2>/dev/null || true; ` +
        `rm -f ${PODS_DIR}/sanitizer.pid; ` +
        `fi; ` +
        `pkill -f ${PODS_DIR}/sanitizer.py 2>/dev/null || true`,
    ],
    { timeoutMs: 5_000 },
  );
}

async function writeFileInPod(
  podFullUuid: string,
  path: string,
  contents: string,
  chmod: string,
): Promise<void> {
  await execInPodStdin(
    podFullUuid,
    [
      "exec",
      "-i",
      podFullUuid,
      "bash",
      "-lc",
      `mkdir -p ${PODS_DIR} && cat > ${path} && chmod ${chmod} ${path}`,
    ],
    contents,
  );
}
