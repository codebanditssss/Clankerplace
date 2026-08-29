// Shared helpers for the pod_domains feature.
//
// Slug generation, container IP discovery, Caddy sync.
//
// CADDY SYNC MODEL:
//   We don't talk to Caddy's admin API. Instead, the host has a small
//   sudo-NOPASSWD helper at /usr/local/sbin/pods-ml-domain that writes
//   per-slug Caddyfile fragments under /etc/caddy/domains/ and reloads
//   Caddy. The helper validates slug + ip + port server-side; the
//   sudoers grant is the only privileged path the frontend gets. Source
//   of truth is the SQLite pod_domains table — the .caddy files on
//   disk are derived state we can rebuild from the DB any time.
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const DOMAIN_ROOT = process.env.PODS_DOMAIN_ROOT ?? "bigcat.pw";

// Curated single-word slug list. Used as both the pod's auto-domain
// (juno.bigcat.pw) and the agent's email username (juno@inbox.bigcat.pw),
// so we want something short, evocative, and human-readable. ~200
// entries — enough headroom for individual users, and `generateUniqueSlug`
// falls back to `<name>-2` style suffixes on collision so we never run
// out globally.
const NAMES = [
  // mythology
  "juno", "atlas", "vega", "lyra", "iris", "hera", "freya", "thor",
  "gaia", "leto", "eros", "nyx", "helia", "ceres", "calypso", "selene",
  "rhea", "thalia", "luna", "eos", "echo", "phoebe", "circe", "thetis",
  // stars / space
  "nova", "aurora", "orion", "rigel", "polaris", "sirius", "antares",
  "comet", "halo", "nebula", "quasar", "orbit", "zenith", "pulsar",
  "stellar", "cosmo", "andro", "cassi",
  // plants / nature
  "fern", "sage", "hazel", "willow", "juniper", "rowan", "alder",
  "cedar", "holly", "ivy", "oak", "thistle", "briar", "sorrel",
  "clover", "linden", "maple", "myrtle", "bramble", "yarrow",
  // animals
  "otter", "finch", "lark", "raven", "kestrel", "marten", "sable",
  "lynx", "vole", "swift", "robin", "magpie", "badger", "ermine",
  "mink", "koi", "newt", "ibex", "stoat", "heron", "puffin", "wren",
  "tern", "tanager", "shrike",
  // gems / minerals
  "opal", "jade", "amber", "onyx", "ruby", "pearl", "topaz", "quartz",
  "coral", "garnet", "agate", "beryl", "jasper", "lapis", "ember",
  "amethyst",
  // elements / colors / textures
  "cobalt", "copper", "indigo", "scarlet", "ochre", "ivory", "ash",
  "flint", "frost", "dusk", "dawn", "umber", "saffron", "russet",
  "sepia", "verdigris",
  // music / art
  "aria", "opus", "riff", "treble", "tempo", "cadence", "sonata",
  "rhapsody", "lyric", "stanza",
  // short / cute / playful
  "pip", "milo", "theo", "tilde", "mocha", "soda", "scoot", "beat",
  "ping", "kobold", "quill", "tinker", "wisp", "puck", "sprig",
  "nibs", "pixel", "byte", "logic", "vector",
];

function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateSlug(): string {
  return rand(NAMES);
}

// Allocate a slug guaranteed-not-in-use according to `isTaken`. Tries
// random NAMES first; if 20 random picks all collide (means lots of
// pods globally, or unlucky streak), picks a base name and finds the
// lowest free integer suffix — `juno-2`, `juno-3`, etc.
export function generateUniqueSlug(
  isTaken: (slug: string) => boolean,
): string {
  for (let i = 0; i < 20; i++) {
    const c = rand(NAMES);
    if (!isTaken(c)) return c;
  }
  const base = rand(NAMES);
  for (let n = 2; n <= 9999; n++) {
    const c = `${base}-${n}`;
    if (!isTaken(c)) return c;
  }
  throw new Error("could not allocate slug — registry exhausted");
}

// DNS-label sanity. RFC 1035-ish: a-z 0-9 dash, must start+end alnum, 3-63.
export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

export function fullDomain(slug: string): string {
  return `${slug}.${DOMAIN_ROOT}`;
}

// Read the container's docker-bridge IP. Wings creates each container on
// the default bridge with a per-container IP in 172.18.0.0/16 (node 1)
// or 172.21.0.0/24 (node 2). IPs change on container recreation; callers
// MUST refresh after a stop/start cycle. Routes through the node-aware
// exec so node-2 pods are inspected over the Tailscale tailnet.
export async function getContainerIp(uuid: string): Promise<string | null> {
  try {
    const { execInPod } = await import("@/lib/node-exec");
    const { stdout } = await execInPod(
      uuid,
      [
        "inspect",
        uuid,
        "--format",
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      ],
      { timeoutMs: 4000 },
    );
    const ip = stdout.trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
    return ip;
  } catch {
    return null;
  }
}

// Resolve where the pod lives and dispatch the helper call to that
// node. For node-1 pods we shell out locally; for other-node pods we
// SSH over the tailnet (same shim used by lib/node-exec.ts).
async function runDomainHelperOnPodNode(
  podUuid: string,
  args: string[],
): Promise<void> {
  const { getPodNodeId, isLocalNode, tailnetIpFor } = await import(
    "@/lib/node-exec"
  );
  const nodeId = await getPodNodeId(podUuid);
  if (isLocalNode(nodeId)) {
    await exec("sudo", ["-n", "/usr/local/sbin/pods-ml-domain", ...args], {
      timeout: 8000,
    });
    return;
  }
  const ip = tailnetIpFor(nodeId);
  if (!ip) {
    throw new Error(
      `pod ${podUuid} on node ${nodeId} but no tailnet IP mapped`,
    );
  }
  const sshUser = process.env.PODS_NODE_SSH_USER ?? "podsadmin";
  await exec(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=4",
      `${sshUser}@${ip}`,
      ["sudo", "-n", "/usr/local/sbin/pods-ml-domain", ...args]
        .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
        .join(" "),
    ],
    { timeout: 10000 },
  );
}

// Same as above but runs UNCONDITIONALLY on the local TLS-terminating
// node (node 1). Used to write the pass-through include that fronts a
// sibling node's Caddy listener on the tailnet.
async function runDomainHelperLocal(args: string[]): Promise<void> {
  await exec("sudo", ["-n", "/usr/local/sbin/pods-ml-domain", ...args], {
    timeout: 8000,
  });
}

// Call the host helper to install/remove a Caddy include + reload Caddy.
// Errors propagate so the API route can roll back the DB row if Caddy
// rejects the change.
//
// For node-2+ pods we ALSO write a pass-through include on node 1 so
// the TLS-terminating Caddy can forward `<slug>.<root>` over the
// tailnet to the sibling's internal Caddy (which then proxies to the
// local container IP). Single-port user-added domains go through the
// same routing path.
export async function addCaddyDomain(
  slug: string,
  podUuid: string,
  ip: string,
  port: number,
): Promise<void> {
  const { getPodNodeId, isLocalNode, tailnetIpFor } = await import(
    "@/lib/node-exec"
  );
  const nodeId = await getPodNodeId(podUuid);
  // Write the slug→container-ip include on the node that actually owns
  // the container (so `ip` is locally routable there).
  await runDomainHelperOnPodNode(podUuid, ["add", slug, ip, String(port)]);
  if (!isLocalNode(nodeId)) {
    const tnetIp = tailnetIpFor(nodeId);
    if (!tnetIp) throw new Error(`no tailnet IP for node ${nodeId}`);
    await runDomainHelperLocal(["add-multi-remote", slug, tnetIp]);
  }
}

// Path-routed include for the per-pod auto-domain. One subdomain fronts
// every Hermes webhook adapter (OpenAI API, Telegram, Stripe/GitHub,
// Microsoft Graph, WeCom, Feishu, BlueBubbles, Twilio SMS) plus the
// user's free-form web app on /. The actual port map lives in the
// pods-ml-domain helper so this side just hands over slug + ip.
export async function addCaddyDomainMulti(
  slug: string,
  podUuid: string,
  ip: string,
): Promise<void> {
  const { getPodNodeId, isLocalNode, tailnetIpFor } = await import(
    "@/lib/node-exec"
  );
  const nodeId = await getPodNodeId(podUuid);
  await runDomainHelperOnPodNode(podUuid, ["add-multi", slug, ip]);
  if (!isLocalNode(nodeId)) {
    const tnetIp = tailnetIpFor(nodeId);
    if (!tnetIp) throw new Error(`no tailnet IP for node ${nodeId}`);
    await runDomainHelperLocal(["add-multi-remote", slug, tnetIp]);
  }
}

// Public webhook URLs that a user pastes into the corresponding platform
// dashboard. Path map MUST stay in sync with pods-ml-domain's add-multi.
export const WEBHOOK_URL_PATHS = {
  api: "/v1",
  webhooks: "/webhooks",
  telegram: "/telegram",
  msgraph: "/msgraph",
  wecom: "/wecom",
  feishu: "/feishu",
  bluebubbles: "/bluebubbles",
  twilio: "/twilio",
} as const;

export function buildWebhookUrl(
  slug: string,
  key: keyof typeof WEBHOOK_URL_PATHS,
  trailing?: string,
): string {
  const t = trailing ? `/${trailing.replace(/^\/+/, "")}` : "";
  return `https://${fullDomain(slug)}${WEBHOOK_URL_PATHS[key]}${t}`;
}

// Remove the slug's Caddy include on EVERY known node. Idempotent — the
// helper does `rm -f` so a missing include is fine. We have to hit all
// nodes because the slug may have a pass-through entry on node 1 AND
// a real entry on the pod's node, and we don't always know which.
export async function removeCaddyDomain(slug: string): Promise<void> {
  const ipMap = parseTailnetMap();
  const tasks: Promise<void>[] = [
    exec("sudo", ["-n", "/usr/local/sbin/pods-ml-domain", "remove", slug], {
      timeout: 8000,
    }).then(() => undefined),
  ];
  const sshUser = process.env.PODS_NODE_SSH_USER ?? "podsadmin";
  for (const ip of ipMap.values()) {
    tasks.push(
      exec(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=accept-new",
          "-o",
          "ConnectTimeout=4",
          `${sshUser}@${ip}`,
          `sudo -n /usr/local/sbin/pods-ml-domain remove '${slug.replace(/'/g, "'\\''")}'`,
        ],
        { timeout: 10000 },
      )
        .then(() => undefined)
        // Swallow per-node remove failures so one offline node doesn't
        // block deprovisioning. The Caddy include is derived state — we
        // can rebuild it later from the pod_domains table.
        .catch(() => undefined),
    );
  }
  // Local must succeed; remotes are best-effort.
  await tasks[0];
  await Promise.all(tasks.slice(1));
}

function parseTailnetMap(): Map<number, string> {
  const m = new Map<number, string>();
  for (const part of (process.env.PELICAN_NODE_TAILSCALE_IPS ?? "").split(",")) {
    const [id, ip] = part.split(":").map((s) => s.trim());
    const n = Number(id);
    if (Number.isFinite(n) && ip) m.set(n, ip);
  }
  return m;
}
