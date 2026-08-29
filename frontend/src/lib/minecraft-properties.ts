// Catalog of Minecraft server.properties keys we expose in the UI.
//
// Vanilla docs: https://minecraft.wiki/w/Server.properties
// We pick the highest-value knobs (gameplay, network, security,
// performance) and group them so the form is scannable. Unknown keys
// stay in the raw editor.

export type PropField = {
  key: string;
  label: string;
  kind: "text" | "number" | "bool" | "enum";
  enum?: string[];
  /** Sensible default if the file is missing the key. */
  default?: string;
  help?: string;
  group: "core" | "gameplay" | "world" | "network" | "security" | "perf";
};

export const SERVER_PROPS_GROUPS: Record<PropField["group"], string> = {
  core: "Core",
  gameplay: "Gameplay",
  world: "World",
  network: "Network",
  security: "Security",
  perf: "Performance",
};

export const SERVER_PROPS: PropField[] = [
  // ---- core ----
  {
    key: "motd",
    label: "Message of the day",
    kind: "text",
    default: "A Minecraft Server",
    help: "Shown in the multiplayer server list. Supports section-sign colour codes (§4Red).",
    group: "core",
  },
  {
    key: "max-players",
    label: "Max players",
    kind: "number",
    default: "20",
    help: "Hard cap on concurrent players. Bump cautiously — RAM use scales.",
    group: "core",
  },

  // ---- gameplay ----
  {
    key: "gamemode",
    label: "Default game mode",
    kind: "enum",
    enum: ["survival", "creative", "adventure", "spectator"],
    default: "survival",
    group: "gameplay",
  },
  {
    key: "force-gamemode",
    label: "Force default gamemode on join",
    kind: "bool",
    default: "false",
    help: "Re-applies the default on every join, overriding whatever the player was last in.",
    group: "gameplay",
  },
  {
    key: "difficulty",
    label: "Difficulty",
    kind: "enum",
    enum: ["peaceful", "easy", "normal", "hard"],
    default: "easy",
    group: "gameplay",
  },
  {
    key: "hardcore",
    label: "Hardcore mode",
    kind: "bool",
    default: "false",
    help: "Death bans the player from the world.",
    group: "gameplay",
  },
  {
    key: "pvp",
    label: "PvP enabled",
    kind: "bool",
    default: "true",
    group: "gameplay",
  },
  {
    key: "spawn-monsters",
    label: "Spawn monsters",
    kind: "bool",
    default: "true",
    group: "gameplay",
  },
  {
    key: "spawn-animals",
    label: "Spawn animals",
    kind: "bool",
    default: "true",
    group: "gameplay",
  },
  {
    key: "spawn-npcs",
    label: "Spawn villagers (NPCs)",
    kind: "bool",
    default: "true",
    group: "gameplay",
  },
  {
    key: "allow-flight",
    label: "Allow flight",
    kind: "bool",
    default: "false",
    help: "Lets plugins/clients use flight. Turn on if you run a creative-style server.",
    group: "gameplay",
  },
  {
    key: "allow-nether",
    label: "Allow Nether",
    kind: "bool",
    default: "true",
    group: "gameplay",
  },

  // ---- world ----
  {
    key: "level-name",
    label: "World name",
    kind: "text",
    default: "world",
    help: "Folder name under /home/container for the world data.",
    group: "world",
  },
  {
    key: "level-seed",
    label: "World seed",
    kind: "text",
    default: "",
    help: "Empty = random on first generate. Set before first start to lock the world.",
    group: "world",
  },
  {
    key: "level-type",
    label: "World type",
    kind: "enum",
    enum: ["minecraft:normal", "minecraft:flat", "minecraft:large_biomes", "minecraft:amplified", "minecraft:single_biome_surface"],
    default: "minecraft:normal",
    group: "world",
  },
  {
    key: "view-distance",
    label: "View distance (chunks)",
    kind: "number",
    default: "10",
    help: "How far each player sees. RAM + bandwidth scale linearly. 6-10 is typical.",
    group: "world",
  },
  {
    key: "simulation-distance",
    label: "Simulation distance (chunks)",
    kind: "number",
    default: "10",
    help: "How far entities/redstone tick. ≤ view-distance.",
    group: "world",
  },
  {
    key: "spawn-protection",
    label: "Spawn protection radius",
    kind: "number",
    default: "16",
    help: "Blocks around spawn no-one but ops can edit. 0 disables.",
    group: "world",
  },

  // ---- network ----
  {
    key: "server-port",
    label: "Server port",
    kind: "number",
    default: "25565",
    help: "Leave unless you know why you're changing it — Pelican's allocation overrides this anyway.",
    group: "network",
  },
  {
    key: "network-compression-threshold",
    label: "Network compression threshold",
    kind: "number",
    default: "256",
    help: "Packet size (bytes) before compression kicks in. -1 disables, 0 always compresses.",
    group: "network",
  },
  {
    key: "enable-status",
    label: "Show in server list (advertise)",
    kind: "bool",
    default: "true",
    group: "network",
  },

  // ---- security ----
  {
    key: "online-mode",
    label: "Online-mode (verify Mojang accounts)",
    kind: "bool",
    default: "true",
    help: "Off lets cracked clients connect — typically bad. Only disable for offline LANs or auth-via-proxy.",
    group: "security",
  },
  {
    key: "white-list",
    label: "Enable whitelist",
    kind: "bool",
    default: "false",
    help: "When on, only players in whitelist.json may connect.",
    group: "security",
  },
  {
    key: "enforce-whitelist",
    label: "Kick non-whitelisted on enable",
    kind: "bool",
    default: "false",
    group: "security",
  },
  {
    key: "prevent-proxy-connections",
    label: "Block known proxies/VPNs",
    kind: "bool",
    default: "false",
    group: "security",
  },
  {
    key: "op-permission-level",
    label: "Default op permission level",
    kind: "enum",
    enum: ["1", "2", "3", "4"],
    default: "4",
    help: "4 = full ops (vanilla commands + bypass spawn protection).",
    group: "security",
  },

  // ---- perf ----
  {
    key: "max-tick-time",
    label: "Max tick time (ms) before watchdog kicks",
    kind: "number",
    default: "60000",
    help: "How long the server waits before declaring a tick stuck. -1 disables.",
    group: "perf",
  },
  {
    key: "entity-broadcast-range-percentage",
    label: "Entity broadcast range %",
    kind: "number",
    default: "100",
    help: "Lower (e.g. 80) reduces network traffic for distant mobs.",
    group: "perf",
  },
  {
    key: "sync-chunk-writes",
    label: "fsync chunk writes",
    kind: "bool",
    default: "true",
    help: "Off improves I/O on SSDs at small data-loss risk on crash.",
    group: "perf",
  },
];

export const SERVER_PROPS_BY_KEY: Record<string, PropField> = Object.fromEntries(
  SERVER_PROPS.map((p) => [p.key, p]),
);

/** Parse a server.properties file body into a plain object. */
export function parseProps(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimStart();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1);
    out[k] = v;
  }
  return out;
}

/**
 * Serialise an object back to server.properties syntax, preserving the
 * order from the original body where possible and appending net-new
 * keys at the end with a header.
 */
export function serialiseProps(
  next: Record<string, string>,
  prev?: string,
): string {
  const lines: string[] = [];
  const written = new Set<string>();
  if (prev) {
    for (const raw of prev.split(/\r?\n/)) {
      const t = raw.trimStart();
      if (!t || t.startsWith("#") || t.startsWith("!")) {
        lines.push(raw);
        continue;
      }
      const eq = t.indexOf("=");
      if (eq < 0) {
        lines.push(raw);
        continue;
      }
      const k = t.slice(0, eq).trim();
      if (k in next) {
        lines.push(`${k}=${next[k]}`);
        written.add(k);
      } else {
        lines.push(raw);
      }
    }
  }
  const newKeys = Object.keys(next).filter((k) => !written.has(k));
  if (newKeys.length > 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("# Added by pods.ml settings UI");
    for (const k of newKeys) lines.push(`${k}=${next[k]}`);
  }
  return lines.join("\n") + (lines[lines.length - 1] === "" ? "" : "\n");
}
