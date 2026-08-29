// Helpers for the Minecraft management surface.
//
// - Modrinth API client: search Paper-compatible plugins, fetch versions,
//   resolve download URLs.
// - PaperMC API client: list every published Paper version + builds so the
//   version picker can offer a dropdown.

import "server-only";

const MODRINTH_BASE = "https://api.modrinth.com/v2";
const PAPER_API = "https://api.papermc.io/v2";

function fetchOpts() {
  return {
    headers: {
      // Modrinth requires a User-Agent identifying the app + a contact.
      // https://docs.modrinth.com/api/#user-agents
      "User-Agent": "pods.ml/1.0 (contact@pods.ml)",
      Accept: "application/json",
    },
    // 25s timeout — first cold call to a CDN can be slow; subsequent
    // ones are sub-second.
    signal: AbortSignal.timeout(25_000),
  } as const;
}

export type ModrinthSearchHit = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  versions: string[];
  downloads: number;
  follows: number;
  icon_url: string | null;
  client_side: string;
  server_side: string;
  date_modified: string;
  latest_version: string | null;
  author: string;
};

export type ModrinthVersion = {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  downloads: number;
  files: Array<{
    url: string;
    filename: string;
    primary: boolean;
    size: number;
    hashes: { sha512?: string; sha1?: string };
  }>;
};

/**
 * Search Modrinth for Paper-compatible plugins.
 * Returns the parsed hits with full project_id we can install by.
 */
export async function searchModrinthPlugins(opts: {
  query?: string;
  minecraftVersion?: string;
  limit?: number;
  offset?: number;
}): Promise<{ hits: ModrinthSearchHit[]; total_hits: number }> {
  const facets: string[][] = [
    ['project_type:"plugin"'],
    // Paper-compatible loaders. Spigot/Bukkit JARs run on Paper too,
    // so we widen the net here.
    ['categories:"paper"', 'categories:"spigot"', 'categories:"bukkit"'],
  ];
  if (opts.minecraftVersion) {
    facets.push([`versions:"${opts.minecraftVersion}"`]);
  }
  const params = new URLSearchParams({
    limit: String(Math.min(opts.limit ?? 24, 50)),
    offset: String(opts.offset ?? 0),
    facets: JSON.stringify(facets),
    index: "downloads",
  });
  if (opts.query?.trim()) params.set("query", opts.query.trim());

  const url = `${MODRINTH_BASE}/search?${params.toString()}`;
  const res = await fetch(url, fetchOpts());
  if (!res.ok) {
    throw new Error(`Modrinth search ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as {
    hits: ModrinthSearchHit[];
    total_hits: number;
  };
}

/**
 * Fetch the versions of a Modrinth project, filtered to compatible
 * Paper-stack loaders + an optional Minecraft version.
 */
export async function fetchModrinthVersions(
  projectIdOrSlug: string,
  minecraftVersion?: string,
): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams();
  // Modrinth wants loaders as a JSON array string.
  params.set("loaders", JSON.stringify(["paper", "spigot", "bukkit", "purpur", "folia"]));
  if (minecraftVersion) {
    params.set("game_versions", JSON.stringify([minecraftVersion]));
  }
  const url = `${MODRINTH_BASE}/project/${encodeURIComponent(projectIdOrSlug)}/version?${params.toString()}`;
  const res = await fetch(url, fetchOpts());
  if (!res.ok) {
    throw new Error(`Modrinth versions ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as ModrinthVersion[];
}

/**
 * Pick the best download file for a Modrinth version — the file flagged
 * `primary` if present, else the first JAR.
 */
export function pickPrimaryFile(v: ModrinthVersion) {
  if (!v.files.length) return null;
  return v.files.find((f) => f.primary) ?? v.files[0];
}

// --- PaperMC version listing -----------------------------------------

export async function listPaperVersions(): Promise<string[]> {
  const url = `${PAPER_API}/projects/paper`;
  const res = await fetch(url, fetchOpts());
  if (!res.ok) {
    throw new Error(`PaperMC list ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { versions: string[] };
  // Newest last in upstream; reverse for the UI.
  return [...(data.versions ?? [])].reverse();
}
