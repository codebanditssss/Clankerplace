// Cross-node docker exec wrapper.
//
// Pods live on different Pelican Wings nodes. Our Next.js process runs
// on node 1, so `docker exec <full-uuid>` only works for node-1 pods.
// For node-2 (and future) pods, we ssh over the Tailscale tailnet to
// the right node and run docker exec there.
//
// Mapping node ID → tailnet IP comes from PELICAN_NODE_TAILSCALE_IPS:
//   "2:100.92.124.106,3:100.x.x.x"
// Node 1 is implicit ("local").
//
// The pod's node is read from Pelican's /servers/<uuid> attributes.
// We cache it in-process for ~1 hour (pods rarely migrate between
// nodes; reissuing a pod gives a new uuid anyway).

import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";

const execFile = promisify(execFileCb);

const NODE_TAILSCALE_IPS = parseNodeMap(
  process.env.PELICAN_NODE_TAILSCALE_IPS ?? "",
);
const LOCAL_NODE_ID = Number(process.env.PELICAN_NODE_ID ?? "1");
const SSH_USER = process.env.PODS_NODE_SSH_USER ?? "podsadmin";

function parseNodeMap(raw: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const part of raw.split(",")) {
    const [id, ip] = part.split(":").map((s) => s.trim());
    const n = Number(id);
    if (Number.isFinite(n) && ip) m.set(n, ip);
  }
  return m;
}

// Cache: pod uuid (full or short) -> { nodeId, ts }
const nodeCache = new Map<string, { nodeId: number; ts: number }>();
const NODE_CACHE_TTL = 60 * 60 * 1000;

/** Accepts either the full UUID (`abc12345-...`) or the short uuid_short. */
export async function getPodNodeId(podUuid: string): Promise<number> {
  const hit = nodeCache.get(podUuid);
  if (hit && Date.now() - hit.ts < NODE_CACHE_TTL) return hit.nodeId;
  try {
    // Pelican accepts filter[uuid] (full) AND filter[uuid_short]. Try
    // the shorter form first if the input is 8 chars, else the full.
    const isShort = !podUuid.includes("-") && podUuid.length <= 12;
    const filter = isShort ? "uuid_short" : "uuid";
    const data = await applicationApi<{
      data: Array<{ attributes: ServerAttributes }>;
    }>(`/servers?filter[${filter}]=${encodeURIComponent(podUuid)}`);
    const nodeId = data.data?.[0]?.attributes?.node ?? LOCAL_NODE_ID;
    nodeCache.set(podUuid, { nodeId, ts: Date.now() });
    return nodeId;
  } catch {
    return LOCAL_NODE_ID;
  }
}

export function isLocalNode(nodeId: number): boolean {
  return nodeId === LOCAL_NODE_ID;
}

export function tailnetIpFor(nodeId: number): string | null {
  return NODE_TAILSCALE_IPS.get(nodeId) ?? null;
}

export type PodExecErrorInfo = {
  code: "pod_not_running" | "pod_not_found" | "node_unmapped" | "exec_failed";
  status: number;
  message: string;
  raw: string;
};

export function describePodExecError(err: unknown): PodExecErrorInfo {
  const raw = err instanceof Error ? err.message : String(err);
  if (/container\s+\S+\s+is not running/i.test(raw)) {
    return {
      code: "pod_not_running",
      status: 409,
      message: "Pod is not running. Start it from Actions, then try again.",
      raw,
    };
  }
  if (/No such container|No such object/i.test(raw)) {
    return {
      code: "pod_not_found",
      status: 409,
      message: "Pod container was not found. Restart the pod or contact support if it was just created.",
      raw,
    };
  }
  if (/no tailnet IP is mapped/i.test(raw)) {
    return {
      code: "node_unmapped",
      status: 502,
      message: "Pod node is not reachable. Contact support if this keeps happening.",
      raw,
    };
  }
  return {
    code: "exec_failed",
    status: 502,
    message: raw,
    raw,
  };
}

/**
 * Run a docker command for a pod, regardless of which node it lives on.
 * Resolves the pod's node via Pelican (cached) and routes the docker
 * subcommand either to the local daemon or via `ssh <tailnet-ip>`.
 *
 * `podUuid` can be either the full UUID (preferred) or the short
 * uuid_short — `getPodNodeId` handles both.
 */
export async function execInPod(
  podUuid: string,
  dockerArgs: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const nodeId = await getPodNodeId(podUuid);
  const timeout = opts.timeoutMs ?? 8000;
  const maxBuffer = opts.maxBuffer ?? 4 * 1024 * 1024;

  if (isLocalNode(nodeId)) {
    return execFile("docker", dockerArgs, { timeout, maxBuffer });
  }
  const ip = tailnetIpFor(nodeId);
  if (!ip) {
    throw new Error(
      `pod ${podUuid} lives on node ${nodeId} but no tailnet IP is mapped (PELICAN_NODE_TAILSCALE_IPS)`,
    );
  }
  // SSH-over-tailnet. The shell on the remote side needs to handle the
  // arg list — quote each arg.
  const remote = ["docker", ...dockerArgs]
    .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
    .join(" ");
  return execFile(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=4",
      `${SSH_USER}@${ip}`,
      remote,
    ],
    { timeout, maxBuffer },
  );
}

/**
 * Pipe `contents` into stdin of a remote docker exec. Mirrors the
 * spawn-based file-write helpers in persona.ts / sanitizer.ts, but
 * node-aware.
 *
 * Use when you need to write a file whose contents would explode shell
 * quoting (markdown, arbitrary bytes).
 */
export function execInPodStdin(
  podUuid: string,
  dockerArgs: string[],
  stdinData: string,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const nodeId = await getPodNodeId(podUuid);
    let cmd: string;
    let args: string[];
    if (isLocalNode(nodeId)) {
      cmd = "docker";
      args = dockerArgs;
    } else {
      const ip = tailnetIpFor(nodeId);
      if (!ip) {
        reject(
          new Error(`pod ${podUuid} on node ${nodeId}, no tailnet IP mapped`),
        );
        return;
      }
      const remote = ["docker", ...dockerArgs]
        .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
        .join(" ");
      cmd = "ssh";
      args = [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=4",
        `${SSH_USER}@${ip}`,
        remote,
      ];
    }
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`exec exit ${code}: ${err.trim()}`)),
    );
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}
