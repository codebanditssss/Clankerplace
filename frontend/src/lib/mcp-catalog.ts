// Curated catalog of the highest-value Model Context Protocol servers.
//
// Sources: registry.modelcontextprotocol.io and the official
// modelcontextprotocol/servers reference repo. We hardcode the install
// templates here (instead of querying the registry at request time) so
// the install UI works offline and we can lock in tested versions.
//
// Each entry's install config is what's written under `mcp_servers.<id>`
// in the pod's ~/.hermes/config.yaml. Hermes auto-discovers tools from
// these on gateway restart (tools/mcp_tool.py).

export type McpField = {
  env: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
  hint?: string;
};

export type McpServer = {
  id: string;
  label: string;
  blurb: string;
  category:
    | "search"
    | "code"
    | "data"
    | "comm"
    | "files"
    | "agent"
    | "browser"
    | "memory"
    | "infra";
  /** Brand colour for the card icon. */
  accent?: string;
  /** Per-user fields the install form will collect (typically API tokens). */
  fields?: McpField[];
  /**
   * Hermes mcp_servers.<id> config template. `${ENV}` placeholders are
   * substituted from the fields the user filled in. Leave out fields
   * we have sane defaults for.
   */
  config: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    transport?: "stdio" | "sse" | "streamable_http";
    timeout?: number;
  };
  docs?: string;
};

export const MCP_CATALOG: McpServer[] = [
  {
    id: "filesystem",
    label: "Filesystem",
    blurb:
      "Read/write files inside the pod under an allowlisted root. Lets the agent treat /home/container as its workspace.",
    category: "files",
    accent: "text-zinc-100",
    config: {
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/home/container",
      ],
    },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "github",
    label: "GitHub",
    blurb:
      "Read repos, issues, PRs, run searches, create branches/commits/PRs. Reaches anywhere your PAT can.",
    category: "code",
    accent: "text-zinc-100",
    fields: [
      {
        env: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub PAT",
        placeholder: "ghp_…",
        secret: true,
        hint: "Classic PAT with repo + read:org scopes. Generate at github.com/settings/tokens.",
      },
    ],
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" },
    },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
  },
  {
    id: "brave-search",
    label: "Brave Search",
    blurb:
      "Web + local search via Brave's API. Free tier is 2000 queries/month.",
    category: "search",
    accent: "text-[#fb542b]",
    fields: [
      {
        env: "BRAVE_API_KEY",
        label: "Brave Search API key",
        secret: true,
        hint: "Sign up at api.search.brave.com for a free key.",
      },
    ],
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "${BRAVE_API_KEY}" },
    },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
  },
  {
    id: "exa",
    label: "Exa Search",
    blurb:
      "Neural search built for AI agents. High-recall results with full-page content extraction.",
    category: "search",
    accent: "text-[#0e7490]",
    fields: [
      {
        env: "EXA_API_KEY",
        label: "Exa API key",
        secret: true,
        hint: "Get one at dashboard.exa.ai.",
      },
    ],
    config: {
      command: "npx",
      args: ["-y", "exa-mcp-server"],
      env: { EXA_API_KEY: "${EXA_API_KEY}" },
    },
    docs: "https://github.com/exa-labs/exa-mcp-server",
  },
  {
    id: "tavily",
    label: "Tavily",
    blurb:
      "AI-first search API with extract + crawl primitives. Free 1000 queries/month.",
    category: "search",
    accent: "text-[#7c3aed]",
    fields: [
      {
        env: "TAVILY_API_KEY",
        label: "Tavily API key",
        secret: true,
        hint: "tavily.com/dashboard",
      },
    ],
    config: {
      command: "npx",
      args: ["-y", "tavily-mcp"],
      env: { TAVILY_API_KEY: "${TAVILY_API_KEY}" },
    },
    docs: "https://github.com/tavily-ai/tavily-mcp",
  },
  {
    id: "puppeteer",
    label: "Puppeteer (browser)",
    blurb:
      "Headless Chromium control — navigate pages, click, fill forms, screenshot, evaluate JS.",
    category: "browser",
    accent: "text-[#40b5a4]",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
  },
  {
    id: "playwright",
    label: "Playwright (browser)",
    blurb:
      "Cross-browser automation. Heavier than Puppeteer but supports Chromium + Firefox + WebKit.",
    category: "browser",
    accent: "text-[#2EAD33]",
    config: {
      command: "npx",
      args: ["-y", "@playwright/mcp"],
    },
    docs: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "postgres",
    label: "Postgres",
    blurb:
      "Read-only query interface against any reachable Postgres database. Schema introspection included.",
    category: "data",
    accent: "text-[#336791]",
    fields: [
      {
        env: "POSTGRES_URL",
        label: "Postgres connection string",
        placeholder: "postgresql://user:pass@host:5432/db",
        secret: true,
      },
    ],
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", "${POSTGRES_URL}"],
    },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
  },
  {
    id: "sqlite",
    label: "SQLite",
    blurb:
      "Read + write a SQLite DB inside the pod. Schemas auto-discovered.",
    category: "data",
    accent: "text-[#003B57]",
    fields: [
      {
        env: "SQLITE_PATH",
        label: "Path inside the pod",
        placeholder: "/home/container/data.db",
      },
    ],
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sqlite", "${SQLITE_PATH}"],
    },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
  },
  {
    id: "slack",
    label: "Slack",
    blurb:
      "Post messages, list channels, search history. Uses Slack bot token.",
    category: "comm",
    accent: "text-[#ECB22E]",
    fields: [
      { env: "SLACK_BOT_TOKEN", label: "Slack bot token (xoxb-…)", secret: true },
      {
        env: "SLACK_TEAM_ID",
        label: "Slack team ID",
        placeholder: "T01ABCDEF",
      },
    ],
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}",
        SLACK_TEAM_ID: "${SLACK_TEAM_ID}",
      },
    },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
  },
  {
    id: "linear",
    label: "Linear",
    blurb:
      "Create, query, update Linear issues, projects, cycles. API key auth.",
    category: "agent",
    accent: "text-[#5e6ad2]",
    fields: [
      { env: "LINEAR_API_KEY", label: "Linear API key", secret: true },
    ],
    config: {
      command: "npx",
      args: ["-y", "mcp-linear"],
      env: { LINEAR_API_KEY: "${LINEAR_API_KEY}" },
    },
    docs: "https://github.com/jerhadf/linear-mcp-server",
  },
  {
    id: "notion",
    label: "Notion",
    blurb:
      "Read + write Notion pages, databases, and blocks. Internal integration token auth.",
    category: "agent",
    accent: "text-zinc-100",
    fields: [
      {
        env: "NOTION_API_KEY",
        label: "Notion integration secret",
        secret: true,
        hint: "notion.so/my-integrations",
      },
    ],
    config: {
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_API_KEY: "${NOTION_API_KEY}" },
    },
    docs: "https://github.com/makenotion/notion-mcp-server",
  },
  {
    id: "memory",
    label: "Memory (knowledge graph)",
    blurb:
      "Persistent knowledge graph the agent can read + write across runs.",
    category: "memory",
    accent: "text-[#a855f7]",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "fetch",
    label: "Fetch (URLs)",
    blurb:
      "Fetch and parse any HTTPS URL — converts pages to markdown for the agent.",
    category: "browser",
    accent: "text-zinc-100",
    config: {
      // The official fetch server is Python-only (`mcp-server-fetch` on
      // PyPI). "@modelcontextprotocol/server-fetch" was never published to
      // npm — the old npx form 404'd on every pod that enabled it. uv/uvx
      // is baked into the sandbox image.
      command: "uvx",
      args: ["mcp-server-fetch"],
    },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
];

export const MCP_BY_ID: Record<string, McpServer> = Object.fromEntries(
  MCP_CATALOG.map((m) => [m.id, m]),
);

export const MCP_CATEGORIES: Record<McpServer["category"], string> = {
  search: "Web search",
  browser: "Browser & fetch",
  code: "Code & dev",
  data: "Databases",
  comm: "Communication",
  files: "Files",
  agent: "Productivity",
  memory: "Memory",
  infra: "Infrastructure",
};

/**
 * Resolve any `${ENV_VAR}` placeholders in a value against the user's
 * provided field map. Returns the substituted value or undefined if a
 * required substitution is missing.
 */
export function substituteTemplate(
  value: string,
  fields: Record<string, string>,
): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => fields[key] ?? "");
}
