// Server-side helpers for the Skills tab.
//
// Two read paths:
//   - Installed:  walk /home/container/.hermes/skills/<category>/<name>/SKILL.md
//                  and parse the YAML frontmatter.
//   - Registry:   read /home/container/.hermes/skills/.hub/index-cache/*.json
//                  (pre-resolved JSON Hermes' own browse already produced).
//
// Mutations call the hermes CLI: `skills install --yes <id>` is fully
// non-interactive; `skills uninstall <name>` is not — we pipe "y\n".

import { execInPod, execInPodStdin } from "@/lib/node-exec";
// Backwards-compat shim — older code in this file calls `exec(...)`.
// New code goes through execInPod for node-awareness.
async function exec(
  _cmd: "docker",
  argv: string[],
  opts?: { timeout?: number; maxBuffer?: number },
): Promise<{ stdout: string }> {
  // argv shape is always ["exec", "<uuid>", ...rest] or ["restart", "<uuid>"]
  const podUuid = argv[1];
  const r = await execInPod(podUuid, argv, {
    timeoutMs: opts?.timeout,
    maxBuffer: opts?.maxBuffer,
  });
  return { stdout: r.stdout };
}

const HERMES_BIN = "/home/container/.local/bin/hermes";
const SKILLS_DIR = "/home/container/.hermes/skills";
const INDEX_CACHE_DIR = `${SKILLS_DIR}/.hub/index-cache`;

export type InstalledSkill = {
  name: string;
  category: string;
  description: string;
  tags: string[];
  path: string;
};

export type RegistrySkill = {
  identifier: string;
  name: string;
  description: string;
  source: string;
  trust: "official" | "trusted" | "community" | "unknown";
  installs?: number;
  detailUrl?: string;
  repoUrl?: string;
  tags?: string[];
};

export type CustomSkillInput = {
  name: string;
  description: string;
  instructions: string;
  tags?: string[];
};

export class CustomSkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomSkillValidationError";
  }
}

export class CustomSkillConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomSkillConflictError";
  }
}

const SAFE_SKILL_NAME = /^[a-z0-9][a-z0-9._-]{1,63}$/;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function yamlQuote(value: string): string {
  return JSON.stringify(value.replace(/\r\n/g, "\n"));
}

function normalizeTags(tags: string[] | undefined): string[] {
  const out = new Set<string>(["custom"]);
  for (const raw of tags ?? []) {
    const tag = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    if (tag && tag.length <= 32) out.add(tag);
  }
  return Array.from(out).slice(0, 8);
}

function customSkillMarkdown(input: CustomSkillInput): string {
  const tags = normalizeTags(input.tags);
  const description = input.description.trim();
  const instructions = input.instructions.trim();
  return `---
name: ${yamlQuote(input.name)}
description: ${yamlQuote(description)}
tags: [${tags.map(yamlQuote).join(", ")}]
---

# ${input.name}

${description || "Custom Hermes skill."}

## Instructions

${instructions}
`;
}

// Minimal YAML frontmatter parser. SKILL.md frontmatter is shallow
// (string keys, scalar or simple list values) so a regex per known
// field is sturdier than pulling in a full YAML lib for this one job.
function parseFrontmatter(raw: string): Record<string, string | string[]> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string | string[]> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Inline list: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      out[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Pelican flips container.installed=1 the moment the install.sh script
// returns, but Wings then has to bring up the runtime container against
// the persistent volume — typically ~2-5s. During that gap docker exec
// fails. Retry briefly so first-page-load on a brand-new pod doesn't
// flash "0 skills" while the container is still spinning up.
async function execInPodWithRetry(
  podFullUuid: string,
  args: string[],
  timeoutMs = 8000,
  attempts = 5,
): Promise<string> {
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await exec("docker", ["exec", podFullUuid, ...args], {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
      });
      return r.stdout;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function listInstalled(
  podFullUuid: string,
): Promise<InstalledSkill[]> {
  let stdout = "";
  try {
    stdout = await execInPodWithRetry(podFullUuid, [
      "bash",
      "-lc",
      // Cap at 500 entries — anything beyond that we're not paginating
      // in the UI anyway.
      `find ${SKILLS_DIR} -maxdepth 3 -name SKILL.md 2>/dev/null | head -500`,
    ]);
  } catch {
    return [];
  }
  const paths = stdout.trim().split("\n").filter(Boolean);
  const skills: InstalledSkill[] = [];
  for (const path of paths) {
    try {
      const { stdout: head } = await exec(
        "docker",
        ["exec", podFullUuid, "head", "-c", "2048", path],
        { timeout: 4000, maxBuffer: 8 * 1024 },
      );
      const fm = parseFrontmatter(head);
      // Path looks like /home/container/.hermes/skills/<cat>/<name>/SKILL.md
      const parts = path.split("/");
      const category = parts.at(-3) ?? "";
      const name =
        (typeof fm.name === "string" ? fm.name : undefined) ?? parts.at(-2) ?? "";
      const description =
        typeof fm.description === "string" ? fm.description : "";
      const tags = Array.isArray(fm.tags) ? fm.tags : [];
      skills.push({ name, category, description, tags, path });
    } catch {
      // Skip unreadable entries — don't fail the whole list.
    }
  }
  return skills.sort((a, b) =>
    a.category === b.category
      ? a.name.localeCompare(b.name)
      : a.category.localeCompare(b.category),
  );
}

function normalizeTrust(t: unknown): RegistrySkill["trust"] {
  if (t === "official" || t === "trusted" || t === "community") return t;
  return "unknown";
}

// Different registries cache slightly different shapes. We normalize
// them all into the RegistrySkill shape on read.
function normalizeRegistryEntry(raw: unknown): RegistrySkill | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // browse.sh / public catalog shapes often use `slug` or `id` as the
  // install identifier and `title` as the display name.
  const slug =
    typeof r.slug === "string"
      ? r.slug
      : typeof r.id === "string"
        ? r.id
        : "";
  if (slug && (typeof r.title === "string" || typeof r.task === "string")) {
    return {
      identifier: slug,
      name:
        typeof r.title === "string"
          ? r.title
          : typeof r.name === "string"
            ? r.name
            : slug,
      description: typeof r.description === "string" ? r.description : "",
      source: typeof r.source === "string" ? r.source : "browse.sh",
      trust: r.verified === true ? "trusted" : "community",
      installs:
        typeof r.installCount === "number"
          ? r.installCount
          : typeof r.installs === "number"
            ? r.installs
            : undefined,
      detailUrl: typeof r.sourceUrl === "string" ? r.sourceUrl : undefined,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : undefined,
    };
  }
  // claude_marketplace shape — a "collection" entry with `skills: []`.
  // We skip these because they're not directly installable.
  if (Array.isArray(r.skills) && typeof r.source === "string") return null;
  if (typeof r.identifier !== "string") return null;
  const extra = (r.extra ?? {}) as Record<string, unknown>;
  return {
    identifier: r.identifier,
    name: typeof r.name === "string" ? r.name : r.identifier,
    description: typeof r.description === "string" ? r.description : "",
    source: typeof r.source === "string" ? r.source : "unknown",
    trust: normalizeTrust(r.trust_level),
    installs: typeof extra.installs === "number" ? extra.installs : undefined,
    detailUrl: typeof extra.detail_url === "string" ? extra.detail_url : undefined,
    repoUrl:
      typeof extra.repo_url === "string"
        ? extra.repo_url
        : typeof r.repo === "string"
          ? `https://github.com/${r.repo}`
          : undefined,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : undefined,
  };
}

export async function readRegistry(
  podFullUuid: string,
): Promise<RegistrySkill[]> {
  let listing = "";
  try {
    listing = await execInPodWithRetry(podFullUuid, ["ls", INDEX_CACHE_DIR], 4000);
  } catch {
    return [];
  }
  const files = listing
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".json"));

  const merged = new Map<string, RegistrySkill>();
  for (const f of files) {
    try {
      // No retry on individual cache reads — the dir-listing above
      // already proved exec works.
      const { stdout } = await exec(
        "docker",
        ["exec", podFullUuid, "cat", `${INDEX_CACHE_DIR}/${f}`],
        { timeout: 6000, maxBuffer: 16 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout);
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? Array.isArray((parsed as Record<string, unknown>).items)
            ? ((parsed as Record<string, unknown>).items as unknown[])
            : Array.isArray((parsed as Record<string, unknown>).skills)
              ? ((parsed as Record<string, unknown>).skills as unknown[])
              : Array.isArray((parsed as Record<string, unknown>).results)
                ? ((parsed as Record<string, unknown>).results as unknown[])
                : []
          : [];
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        const norm = normalizeRegistryEntry(e);
        if (!norm) continue;
        // Dedupe — prefer higher-trust entries on collision.
        const prior = merged.get(norm.identifier);
        if (!prior || trustRank(norm.trust) > trustRank(prior.trust)) {
          merged.set(norm.identifier, norm);
        }
      }
    } catch {
      /* skip malformed cache file */
    }
  }
  return Array.from(merged.values());
}

function trustRank(t: RegistrySkill["trust"]): number {
  return { official: 3, trusted: 2, community: 1, unknown: 0 }[t];
}

export async function refreshRegistry(podFullUuid: string): Promise<void> {
  // `skills browse` triggers Hermes' index-refresh path across configured
  // sources. Pull more than one item so sparse caches still have useful
  // local search results.
  await exec(
    "docker",
    [
      "exec",
      podFullUuid,
      HERMES_BIN,
      "skills",
      "browse",
      "--size",
      "250",
      "--source",
      "all",
    ],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
}

export async function installSkill(
  podFullUuid: string,
  identifier: string,
): Promise<{ output: string }> {
  const r = await exec(
    "docker",
    [
      "exec",
      podFullUuid,
      HERMES_BIN,
      "skills",
      "install",
      "--yes",
      identifier,
    ],
    { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return { output: r.stdout };
}

export async function uninstallSkill(
  podFullUuid: string,
  name: string,
): Promise<{ output: string }> {
  // No --yes flag on uninstall — pipe "y\n" via stdin. node-aware
  // so node-2 pods uninstall over SSH-via-tailnet.
  await execInPodStdin(
    podFullUuid,
    ["exec", "-i", podFullUuid, HERMES_BIN, "skills", "uninstall", name],
    "y\n",
  );
  return { output: "" };
}

export async function createCustomSkill(
  podFullUuid: string,
  input: CustomSkillInput,
): Promise<void> {
  const name = input.name.trim().toLowerCase();
  const description = input.description.trim();
  const instructions = input.instructions.trim();

  if (!SAFE_SKILL_NAME.test(name)) {
    throw new CustomSkillValidationError(
      "Skill name must be 2-64 chars: lowercase letters, numbers, dot, dash, or underscore, starting with a letter or number.",
    );
  }
  if (description.length > 240) {
    throw new CustomSkillValidationError("Description must be 240 characters or less.");
  }
  if (instructions.length < 20) {
    throw new CustomSkillValidationError("Instructions must be at least 20 characters.");
  }
  if (instructions.length > 20_000) {
    throw new CustomSkillValidationError(
      "Instructions are too long; keep custom skills under 20,000 characters.",
    );
  }
  const existingSkills = await listInstalled(podFullUuid);
  if (existingSkills.some((skill) => skill.name.toLowerCase() === name)) {
    throw new CustomSkillConflictError("A skill with this name already exists.");
  }

  const dir = `${SKILLS_DIR}/custom/${name}`;
  const path = `${dir}/SKILL.md`;
  const writeScript = `
set -euo pipefail
dir=${shellQuote(dir)}
path=${shellQuote(path)}
mkdir -p "$dir"
tmp="$(mktemp "$dir/.SKILL.md.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"
chmod 644 "$tmp"
if ! ln "$tmp" "$path" 2>/dev/null; then
  echo PODS_SKILL_EXISTS >&2
  exit 17
fi
`;
  try {
    await execInPodStdin(
      podFullUuid,
      ["exec", "-i", podFullUuid, "bash", "-lc", writeScript],
      customSkillMarkdown({
        name,
        description,
        instructions,
        tags: input.tags,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("PODS_SKILL_EXISTS")) {
      throw new CustomSkillConflictError("A skill with this name already exists.");
    }
    throw err;
  }
}

export async function readInstalledSkillBody(
  podFullUuid: string,
  category: string,
  name: string,
): Promise<string | null> {
  const path = `${SKILLS_DIR}/${category}/${name}/SKILL.md`;
  try {
    const { stdout } = await exec(
      "docker",
      ["exec", podFullUuid, "cat", path],
      { timeout: 6000, maxBuffer: 256 * 1024 },
    );
    return stdout;
  } catch {
    return null;
  }
}
