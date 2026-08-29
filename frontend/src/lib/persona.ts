// Hermes auto-injects three files at chat start:
//   - SOUL.md     → tone / persona — user-owned
//   - AGENTS.md   → operating instructions — pods.ml-owned
//   - MEMORY.md   → built-in memory — agent-owned
// We use the first two: the Persona tab edits SOUL.md, and the deploy
// pipeline writes AGENTS.md so the agent learns what capabilities the
// platform has provisioned for it (mailbox today, more later).

import { execInPod, execInPodStdin } from "@/lib/node-exec";

const SOUL_PATH = "/home/container/.hermes/SOUL.md";
const AGENTS_PATH = "/home/container/AGENTS.md";

const SOUL_HEADER = "# Hermes Agent Persona";
const AGENTS_BANNER =
  "<!-- managed by clankerplace — rewritten on every deploy; edits will be lost -->";

// First-install SOUL.md ships with a help comment block. Treat it as
// empty so users land in a clean textarea, not a wall of examples.
const DEFAULT_HELP_COMMENT_RE =
  /<!--[\s\S]*?This file is loaded fresh[\s\S]*?-->/;

export function parsePersona(raw: string): string {
  let body = raw;
  body = body.replace(/^\s*#\s+Hermes Agent Persona\s*\n?/, "");
  body = body.replace(DEFAULT_HELP_COMMENT_RE, "");
  return body.trim();
}

export function composePersona(persona: string): string {
  const trim = persona.trim();
  if (!trim) return `${SOUL_HEADER}\n`;
  return `${SOUL_HEADER}\n\n${trim}\n`;
}

export function composeForgePersona(identity: {
  name: string;
  mission: string;
  personality: string;
}): string {
  return [
    SOUL_HEADER,
    "",
    "## Identity",
    "",
    `You are ${identity.name.trim()}, a clankerplace autonomous agent.`,
    "",
    "## Mission",
    "",
    identity.mission.trim(),
    "",
    "## Personality",
    "",
    identity.personality.trim(),
    "",
  ].join("\n");
}

export function buildAgentsMd(emailAddress: string | null): string {
  const lines = [
    AGENTS_BANNER,
    "",
    "# Operating notes for this pod",
    "",
    "Capabilities the clankerplace platform has provisioned for you. Use these — do not reinvent them.",
    "",
    "## System environment & sudo (read before installing anything)",
    "",
    "You run as the non-root `container` user. `sudo` is configured passwordless, BUT this container runs with the kernel `no_new_privileges` flag set, so **sudo cannot escalate to root**. Every `sudo …` fails immediately with:",
    "",
    "```",
    'sudo: The "no new privileges" flag is set, which prevents sudo from running as root.',
    "```",
    "",
    "**There is no sudo password** — no password, empty password, or retry will change this. Do not ask the user for one, and do not keep retrying sudo.",
    "",
    "What this means in practice:",
    "",
    "- **Do NOT** run `sudo apt-get`/`apt`/`dpkg` or anything needing root — it will always fail.",
    "- Install into your home instead — no root needed, and it persists at `/home/container`:",
    "  - **Python:** `uv pip install <pkg>` or `uv venv` (fast), or `pip install --user`.",
    "  - **Node:** `npm i -g <pkg>` / `pnpm`. **Rust:** `cargo install`. **Go:** `go install`.",
    "  - **Anything that needs native/system libraries** (ffmpeg, opencv, postgres, image/video/ML libs, even browsers) — use **micromamba**: `micromamba install -n base -c conda-forge <pkg>`. conda-forge packages bundle their own shared libs, so they install + run without root. State lives under `$MAMBA_ROOT_PREFIX` (`~/.micromamba`).",
    "  - **Static CLI binaries:** download into `~/.local/bin` (already on `PATH`).",
    "- A headless **Chromium + its system libs are pre-installed**, so Playwright/Puppeteer browsing works out of the box — no install needed.",
    "- Only things that need *true root* (system services, `apt`, kernel modules) are unavailable. If you genuinely hit one, tell the user — don't burn turns on sudo.",
    "",
  ];
  if (emailAddress) {
    lines.push(
      "## Email mailbox (already configured — do not reinstall)",
      "",
      `Your address is **${emailAddress}**. The mailbox is real, signed via Resend, and persistent for the life of this pod.`,
      "",
      "**DO NOT** install himalaya, mutt, msmtp, mailx, sendmail, or any other email client. They will not work — there are no IMAP/SMTP credentials in this environment. Ignore any built-in skill that tells you to install one.",
      "",
      "### Sending mail",
      "",
      "Use this curl recipe — the env vars `EMAIL_OUTBOUND_PROXY` and `POD_EMAIL_TOKEN` are already set in your shell:",
      "",
      "```bash",
      'curl -X POST "$EMAIL_OUTBOUND_PROXY" \\',
      '  -H "Authorization: Bearer $POD_EMAIL_TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"to":"someone@example.com","subject":"...","text":"..."}\'',
      "```",
      "",
      `The \`from\` is pinned to ${emailAddress} server-side; you can't spoof it. Body accepts \`text\` or \`html\` (or both). Optional fields: \`in_reply_to\` (Message-ID), \`references\` (array), \`attachments\` ([{filename, content (base64), contentType}]). Response: \`{"ok":true,"id":"<resend-id>"}\` or \`{"error":"..."}\`. Rate limit: 100 sends per hour per pod.`,
      "",
      "### Receiving mail",
      "",
      "Inbound mail arrives as `email.received` webhook events at your generic webhook endpoint. Use `hermes webhook` to inspect or subscribe. Headers, text, and html are all included in the payload.",
      "",
    );
  }
  return lines.join("\n");
}

export async function readPersona(podFullUuid: string): Promise<string> {
  try {
    const { stdout } = await execInPod(
      podFullUuid,
      ["exec", podFullUuid, "cat", SOUL_PATH],
      { timeoutMs: 6000, maxBuffer: 256 * 1024 },
    );
    return parsePersona(stdout);
  } catch {
    return "";
  }
}

async function writeFile(
  podFullUuid: string,
  path: string,
  contents: string,
  mkdirParent?: string,
): Promise<void> {
  const prelude = mkdirParent ? `mkdir -p ${mkdirParent} && ` : "";
  await execInPodStdin(
    podFullUuid,
    ["exec", "-i", podFullUuid, "bash", "-lc", `${prelude}cat > ${path}`],
    contents,
  );
}

export function writePersona(
  podFullUuid: string,
  contents: string,
): Promise<void> {
  return writeFile(podFullUuid, SOUL_PATH, contents, "/home/container/.hermes");
}

export function writeAgentsMd(
  podFullUuid: string,
  contents: string,
): Promise<void> {
  return writeFile(podFullUuid, AGENTS_PATH, contents);
}

// Make ~/.hermes/.env vars available in every interactive / login bash
// shell. Hermes' terminal tool spawns `bash -l -c <cmd>` or `bash -c
// <cmd>` — login shells source .profile, interactive ones source .bashrc.
// Without this, the agent's shell sees empty $EMAIL_OUTBOUND_PROXY /
// $POD_EMAIL_TOKEN and any curl against them silently produces empty
// output, which then corrupts the next inference call as an empty
// text content block.
const HERMES_ENV_SOURCE_LINE =
  '# pods.ml: auto-export ~/.hermes/.env into every shell\nif [ -f "$HOME/.hermes/.env" ]; then set -a; . "$HOME/.hermes/.env"; set +a; fi';

export async function installEnvAutoSource(podFullUuid: string): Promise<void> {
  const script = `
for f in /home/container/.bashrc /home/container/.profile; do
  touch "$f"
  if ! grep -q 'pods.ml: auto-export' "$f"; then
    printf "\\n%s\\n" '${HERMES_ENV_SOURCE_LINE.replace(/'/g, "'\\''")}' >> "$f"
  fi
done
`;
  await execInPod(
    podFullUuid,
    ["exec", podFullUuid, "bash", "-lc", script],
    { timeoutMs: 5000 },
  );
}

// Disable the bundled `himalaya` skill (and any other names passed) by
// editing ~/.hermes/config.yaml's `skills.disabled` list. Hermes' own
// skills_config.py respects this list at runtime — no restart needed,
// it's loaded fresh per chat. Idempotent: existing entries aren't
// duplicated.
export async function disableBuiltinSkills(
  podFullUuid: string,
  names: string[],
): Promise<void> {
  if (names.length === 0) return;
  const py = `
import yaml, sys
path = "/home/container/.hermes/config.yaml"
try:
    cfg = yaml.safe_load(open(path)) or {}
except FileNotFoundError:
    cfg = {}
skills = cfg.setdefault("skills", {})
disabled = set(skills.get("disabled") or [])
disabled.update(${JSON.stringify(names)})
skills["disabled"] = sorted(disabled)
with open(path, "w") as f:
    yaml.safe_dump(cfg, f, default_flow_style=False, sort_keys=False)
print("ok")
`;
  // System python3 in the yolks image has no PyYAML; Hermes' own venv
  // does. Fall back to system if the venv ever moves.
  const python = "/home/container/hermes-agent/venv/bin/python3";
  await execInPod(
    podFullUuid,
    ["exec", podFullUuid, python, "-c", py],
    { timeoutMs: 8000, maxBuffer: 16 * 1024 },
  );
}
