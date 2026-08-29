// Registry of pod types pods.ml can deploy.
//
// Each type is a self-contained product slice: an egg (or family of eggs)
// in Pelican, a docker image, a deploy form, a resource preset, and an
// optional post-deploy display (e.g. Minecraft surfaces host:port,
// n8n surfaces a direct URL, code-sandbox shows the chosen IDE entry
// point). The /api/deploy route dispatches off `slug`.
//
// Hermes stays the implicit default for back-compat: a request without
// pod_type lands on Hermes. New types must declare their own `slug`.

export type PodTypeKind = "agent" | "automation" | "game" | "sandbox";

export type PodTypeFlavor = {
  id: string;
  label: string;
  blurb: string;
  /** Env vars Pelican injects when this flavor is picked. */
  env?: Record<string, string>;
  accent?: string;
};

export type PodTypeField = {
  env: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
  hint?: string;
  /** When set, render as a radio of flavors instead of a free-text input. */
  flavors?: PodTypeFlavor[];
};

export type PodType = {
  slug: string;
  label: string;
  blurb: string;
  kind: PodTypeKind;
  /** Pelican egg ID this type deploys against. Sourced from env at runtime. */
  eggIdEnv: string;
  /** Default docker image; egg's image normally wins. */
  defaultImage?: string;
  /** Default resource preset (Pelican units). */
  defaults: {
    memoryMib: number;
    swapMib: number;
    diskMib: number;
    cpuPercent: number;
    /** Pelican feature_limits.allocations — how many host ports we need. */
    allocations: number;
  };
  /** Form fields rendered on the deploy page. */
  fields?: PodTypeField[];
  /**
   * Hint about the primary public-facing URL/port shape so the post-deploy
   * page can render the right "how to connect" block.
   */
  surface:
    | {
        kind: "http";
        defaultPort: number;
        protocol: "https";
        /**
         * Hermes fronts many webhook adapters on one subdomain, so its
         * auto-domain needs the path-routed Caddy include (add-multi).
         * Every other HTTP pod is a single web app — its auto-domain must
         * reverse-proxy the subdomain ROOT straight to `defaultPort`.
         * Defaults to single-port when unset.
         */
        multiPort?: true;
      }
    | { kind: "tcp"; defaultPort: number; protocol: "minecraft" | "raw" }
    | { kind: "console-only" };
  accent?: string;
  /** Whether to show the connectors tab on the pod page. */
  showConnectors?: boolean;
  /** Whether to show the providers tab (LLM/TTS/etc.) on the pod page. */
  showProviders?: boolean;
};

export const POD_TYPES: PodType[] = [
  {
    slug: "hermes",
    label: "Hermes Agent",
    blurb:
      "Always-on AI agent with persistent memory, skills, MCP servers, and 30+ messaging connectors.",
    kind: "agent",
    eggIdEnv: "PELICAN_HERMES_EGG_ID",
    defaultImage: "pods-ml/sandbox-ubuntu:1.0",
    defaults: {
      memoryMib: 2048,
      swapMib: 0,
      diskMib: 10240,
      cpuPercent: 100,
      allocations: 1,
    },
    surface: { kind: "http", defaultPort: 8080, protocol: "https", multiPort: true },
    showConnectors: true,
    showProviders: true,
    accent: "text-[#e2c170]",
  },
  {
    slug: "n8n",
    label: "n8n",
    blurb:
      "Visual workflow automation — drag-and-drop nodes, 400+ integrations, queue mode, code blocks. Public webhook URL out of the box. First visit walks you through creating your owner login.",
    kind: "automation",
    eggIdEnv: "PELICAN_N8N_EGG_ID",
    defaultImage: "ghcr.io/pelican-eggs/yolks:nodejs_22",
    defaults: {
      memoryMib: 2048,
      swapMib: 0,
      diskMib: 8000,
      cpuPercent: 100,
      allocations: 1,
    },
    // No deploy-time credentials: modern n8n dropped N8N_BASIC_AUTH_* and
    // uses built-in user management. The first person to open the editor
    // creates the owner account (email + password) in-browser; everyone
    // else logs in against it. The frontend wires N8N_EDITOR_BASE_URL /
    // WEBHOOK_URL to the auto-domain post-deploy so that login and OAuth
    // redirects resolve correctly behind Caddy.
    surface: { kind: "http", defaultPort: 5678, protocol: "https" },
    showConnectors: false,
    showProviders: false,
    accent: "text-[#ea4b71]",
  },
  {
    slug: "code-sandbox",
    label: "Code Sandbox",
    blurb:
      "Ubuntu pod with your choice of IDE — VS Code in browser (code-server), Claude Code CLI, or plain shell. Persistent /home/container, sudo, public URL.",
    kind: "sandbox",
    eggIdEnv: "PELICAN_CODE_SANDBOX_EGG_ID",
    defaultImage: "pods-ml/sandbox-ubuntu:1.0",
    defaults: {
      memoryMib: 2048,
      swapMib: 0,
      diskMib: 10240,
      cpuPercent: 100,
      allocations: 1,
    },
    fields: [
      {
        env: "SANDBOX_FLAVOR",
        label: "IDE flavor",
        flavors: [
          {
            id: "code-server",
            label: "VS Code (code-server)",
            blurb:
              "Full VS Code in your browser, password-protected. Extensions via Open VSX. Recommended for most coding workflows.",
            env: { SANDBOX_FLAVOR: "code-server" },
            accent: "text-[#007ACC]",
          },
          {
            id: "claude-code",
            label: "Claude Code CLI",
            blurb:
              "Anthropic's terminal-native coding agent. Pre-installed via the official curl installer; launch via web terminal with `claude`.",
            env: { SANDBOX_FLAVOR: "claude-code" },
            accent: "text-[#cc785c]",
          },
          {
            id: "plain",
            label: "Plain Ubuntu shell",
            blurb:
              "Just Ubuntu 22.04 with sudo. Bring your own toolchain — apt-install what you need.",
            env: { SANDBOX_FLAVOR: "plain" },
            accent: "text-zinc-400",
          },
        ],
      },
      {
        env: "SANDBOX_PASSWORD",
        label: "code-server password",
        secret: true,
        optional: true,
        hint: "Required if you pick the VS Code flavor. Used to gate the web IDE at /. Skip for Claude Code or plain.",
      },
      {
        env: "SANDBOX_GIT_REPO",
        label: "Clone a repo on first boot",
        placeholder: "https://github.com/your-org/your-repo.git",
        optional: true,
        hint: "Cloned into /home/container/workspace at first boot. Skip to start blank.",
      },
    ],
    surface: { kind: "http", defaultPort: 8080, protocol: "https" },
    showConnectors: false,
    showProviders: false,
    accent: "text-[#3b82f6]",
  },
  {
    slug: "minecraft-paper",
    label: "Minecraft (Paper)",
    blurb:
      "High-performance Bukkit/Spigot-compatible Minecraft server. Picks the latest stable Paper build for the chosen Minecraft version. Console, SFTP, plugin folder access — full ops control.",
    kind: "game",
    eggIdEnv: "PELICAN_PAPER_EGG_ID",
    defaultImage: "ghcr.io/pterodactyl/yolks:java_21",
    defaults: {
      memoryMib: 4096,
      swapMib: 0,
      diskMib: 10000,
      cpuPercent: 200,
      allocations: 1,
    },
    fields: [
      {
        env: "MINECRAFT_VERSION",
        label: "Minecraft version",
        placeholder: "latest",
        hint: 'Use "latest" for the newest stable, or pin to e.g. 1.21.10, 1.20.6.',
      },
      {
        env: "BUILD_NUMBER",
        label: "Paper build number",
        placeholder: "latest",
        optional: true,
        hint: 'Leave "latest" unless you need a specific Paper build.',
      },
    ],
    surface: { kind: "tcp", defaultPort: 25565, protocol: "minecraft" },
    showConnectors: false,
    showProviders: false,
    accent: "text-[#5b9c4a]",
  },
];

export const POD_TYPE_BY_SLUG: Record<string, PodType> = Object.fromEntries(
  POD_TYPES.map((p) => [p.slug, p]),
);

export const DEFAULT_POD_TYPE: PodType = POD_TYPE_BY_SLUG.hermes;

/**
 * Reverse-map a Pelican egg id to its pod type. Reads the env at call
 * time (server-side only). Returns hermes as the fallback because every
 * pre-existing pod was Hermes.
 */
export function podTypeFromEggId(eggId: number): PodType {
  for (const t of POD_TYPES) {
    const raw = process.env[t.eggIdEnv];
    if (raw && Number(raw) === eggId) return t;
  }
  // Legacy fallback — old deploys may have come from PELICAN_HERMES_EGG_ID.
  if (
    process.env.PELICAN_HERMES_EGG_ID &&
    Number(process.env.PELICAN_HERMES_EGG_ID) === eggId
  ) {
    return POD_TYPE_BY_SLUG.hermes;
  }
  return DEFAULT_POD_TYPE;
}
