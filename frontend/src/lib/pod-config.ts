// Shared helpers for poking at a running pod's hermes configuration.
//
// Everything is `docker exec` against the pod's container — Wings names the
// container after the server's full UUID, which we get from the Application
// API. We read/write two files inside the container:
//   /home/container/.hermes/.env         — flat KEY=VALUE pairs
//   /home/container/.hermes/config.yaml  — structured YAML (model.default,
//                                          whatsapp.reply_prefix, etc.)
//
// Both are owned by the container user (UID 998). chmod 600 because they
// contain API keys.
import YAML from "yaml";
import { execInPod } from "@/lib/node-exec";

export async function dockerExec(
  uuid: string,
  cmd: string[],
  timeoutMs = 8000,
): Promise<string> {
  // Routes through node-exec so pods on remote Wings nodes are reached
  // over the Tailscale tailnet automatically.
  const { stdout } = await execInPod(uuid, ["exec", uuid, ...cmd], {
    timeoutMs,
    maxBuffer: 1024 * 256,
  });
  return stdout;
}

export async function readEnv(uuid: string): Promise<Record<string, string>> {
  const text = await dockerExec(uuid, [
    "bash",
    "-lc",
    "cat /home/container/.hermes/.env 2>/dev/null || true",
  ]);
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return out;
}

export async function writeEnv(
  uuid: string,
  updates: Record<string, string | null>,
) {
  const current = await readEnv(uuid);
  for (const [k, v] of Object.entries(updates)) {
    if (v == null) delete current[k];
    else current[k] = v;
  }
  const body =
    Object.entries(current)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";
  const escaped = body.replace(/'/g, `'\\''`);
  await dockerExec(uuid, [
    "bash",
    "-lc",
    `mkdir -p /home/container/.hermes && printf '%s' '${escaped}' > /home/container/.hermes/.env && chmod 600 /home/container/.hermes/.env`,
  ]);
}

// Returns the parsed YAML doc or null if it doesn't exist / is empty.
export async function readConfigYaml(
  uuid: string,
): Promise<Record<string, unknown>> {
  const text = await dockerExec(uuid, [
    "bash",
    "-lc",
    "cat /home/container/.hermes/config.yaml 2>/dev/null || true",
  ]);
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    const parsed = YAML.parse(trimmed);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// Merge-write config.yaml — caller mutates a draft and we serialize. Anything
// the caller doesn't touch is left untouched (so the whatsapp settings page
// doesn't clobber model.default written by the provider page, and vice
// versa).
export async function patchConfigYaml(
  uuid: string,
  mutator: (cfg: Record<string, unknown>) => void,
) {
  const current = await readConfigYaml(uuid);
  mutator(current);
  const body = YAML.stringify(current);
  const escaped = body.replace(/'/g, `'\\''`);
  await dockerExec(uuid, [
    "bash",
    "-lc",
    `mkdir -p /home/container/.hermes && printf '%s' '${escaped}' > /home/container/.hermes/config.yaml && chmod 600 /home/container/.hermes/config.yaml`,
  ]);
}

// Non-blocking gateway restart. Prefers `pod-gateway restart` (which is
// supervisor-aware and returns immediately). Falls back to raw pkill for the
// rare case where a pod was started before pod-gateway shipped — the
// supervisor in pods-ml-pod-init.sh still respawns the gateway either way.
export async function restartGateway(uuid: string) {
  await dockerExec(
    uuid,
    [
      "bash",
      "-lc",
      // CRITICAL: do NOT inline the hermes pkill regex into this shell
      // string. `pkill -f` matches the *full command line* of every
      // process, and our own `bash -lc "..."` argv is one of those — so
      // including the regex as a literal causes pkill to TERM the parent
      // bash mid-execution (exit 143) before our `|| true` can catch it.
      // pod-gateway encapsulates the actual pkill inside its own script
      // file, so the regex never appears in our argv.
      "rm -f /home/container/.hermes/.supervisor-disabled 2>/dev/null; " +
        "pod-gateway restart || true",
    ],
    12000,
  );
}

export async function whatsappPaired(uuid: string): Promise<boolean> {
  // Hermes uses `get_hermes_dir("platforms/whatsapp/session", "whatsapp/session")`
  // which prefers the legacy `~/.hermes/whatsapp/session` if it exists on
  // disk (so existing pairings keep working after a Hermes upgrade) and
  // otherwise creates the new `~/.hermes/platforms/whatsapp/session`. We
  // have to check BOTH or the dashboard sees "needs pairing" forever on
  // legacy-layout pods even after a successful QR scan.
  try {
    const out = await dockerExec(uuid, [
      "bash",
      "-lc",
      "for p in /home/container/.hermes/whatsapp/session " +
        "/home/container/.hermes/platforms/whatsapp/session; do " +
        "  if [ -d \"$p\" ] && [ -n \"$(ls -A \"$p\" 2>/dev/null)\" ]; then " +
        "    echo paired; exit 0; " +
        "  fi; " +
        "done; echo no",
    ]);
    return out.trim() === "paired";
  } catch {
    return false;
  }
}
