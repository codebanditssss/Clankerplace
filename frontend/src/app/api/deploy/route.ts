// /api/deploy — provision a new pod of any registered pod-type.
//
// Dispatches on `pod_type` (defaults to "hermes" for back-compat). Each
// type maps to a Pelican egg + resource preset declared in
// lib/pod-types.ts. Hermes is the most complex because its provider
// system pre-fills 30+ env vars and 7+ webhook port pins; the other
// types pass through the user's fields unchanged.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { PROVIDER_BY_SLUG } from "@/lib/providers";
import {
  isManagedProvider,
  managedDeployEnv,
  applyManagedConfig,
  managedGatewayV1,
} from "@/lib/managed-ai";
import { POD_TYPE_BY_SLUG, DEFAULT_POD_TYPE, type PodType } from "@/lib/pod-types";
import { createDomainForPod } from "../domains/route";
import { fullDomain } from "@/lib/domains";
import { upsertMeterStateFromPelican } from "@/lib/billing/meter";
import { canCreatePod } from "@/lib/billing/subscriptions";
import {
  getPlanResourceLimits,
  isWithinPlanResourceLimits,
  PLANS,
  type PlanId,
} from "@/lib/billing/plans";
import { withLock } from "@/lib/billing/locks";
import {
  DEFAULT_DEPLOY_SIZE_ID,
  canSelectDeploySizeForPodType,
  deploySizeById,
  deploySizeFromRequest,
} from "@/lib/deploy-sizes";
import { generatePodName } from "@/lib/pod-names";
import { randomBytes } from "node:crypto";

// PELICAN_NODE_IDS is a comma-separated list of node IDs the panel
// can place new pods on; we round-robin by picking the one with the
// MOST free memory at the time of deploy. Falls back to PELICAN_NODE_ID
// (single value) for back-compat with the old env.
const NODE_IDS: number[] = (
  process.env.PELICAN_NODE_IDS ??
  process.env.PELICAN_NODE_ID ??
  "1"
)
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

type DeployRequest = {
  pod_type?: string;
  /** Hermes-specific: provider slug. */
  provider?: string;
  /** map of env-var name -> value */
  fields?: Record<string, string>;
  /** Hermes-specific: model id */
  model?: string;
  name?: string;
  size?: unknown;
};

function eggId(type: PodType): number | null {
  // Fall back to legacy PELICAN_HERMES_EGG_ID for the hermes type so we
  // don't break existing deploys mid-rollout.
  const fromEnv = process.env[type.eggIdEnv];
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  if (type.slug === "hermes" && process.env.PELICAN_HERMES_EGG_ID) {
    return Number(process.env.PELICAN_HERMES_EGG_ID);
  }
  return null;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

// Patches /usr/local/bin/pods-ml-pod-init.sh inside the pod (the script
// is baked into the docker image; until we rebuild it, every freshly
// deployed pod still ships the old version that leaks
// HERMES_INFERENCE_* into the runtime gateway env). Optionally installs
// the in-pod content-sanitizer proxy when the user picked OpenAI Chat
// Completions mode against a custom provider — pads empty content
// blocks that Claude-relays would otherwise reject as HTTP 400. Then
// restarts the container so PID 1 re-execs with the new script + env.
//
// Fire-and-forget from the deploy route — runs in the background so we
// don't extend the response deadline. Best-effort: failures are logged
// but don't fail the deploy.
async function wireHermesProxy(
  podShort: string,
  fullUuid: string,
  apiMode: string,
  baseUrl: string,
): Promise<void> {
  try {
    const { installSanitizer, patchPodInit, restartPod, stopSanitizer } =
      await import("@/lib/sanitizer");
    // Always patch pod-init.sh + restart — unsetting HERMES_INFERENCE_*
    // benefits every custom-provider mode, not just openai.
    await patchPodInit(fullUuid);
    if (apiMode === "openai" || apiMode === "" || apiMode === "chat_completions") {
      if (!baseUrl) {
        console.warn(`[deploy:proxy] ${podShort}: no base_url, skipping sanitizer`);
      } else {
        await installSanitizer(fullUuid, baseUrl);
      }
    } else {
      // Anthropic mode — no sanitizer needed. Make sure any prior
      // sanitizer process is down (covers re-deploy edge cases).
      await stopSanitizer(fullUuid);
    }
    await restartPod(fullUuid);
  } catch (err) {
    console.warn(
      `[deploy:proxy] wireHermesProxy failed for ${podShort}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

// Pods Managed post-deploy wiring: write the full managed config (fallback,
// auxiliary, STT/TTS, image, web) then run the same sanitizer/pod-init path
// custom pods use, pointing the sanitizer upstream at the managed gateway.
// Best-effort — never fails the deploy.
async function wireManagedHermes(
  podShort: string,
  fullUuid: string,
  userId?: number,
): Promise<void> {
  try {
    await applyManagedConfig(fullUuid, userId);
  } catch (err) {
    console.warn(
      `[deploy:managed] applyManagedConfig failed for ${podShort}: ${err instanceof Error ? err.message : err}`,
    );
  }
  await wireHermesProxy(podShort, fullUuid, "openai", managedGatewayV1());
}

// Idempotent: writes POD_EMAIL_TOKEN to pod_domains and EMAIL_* into ~/.hermes/.env via docker exec, retrying for Wings' container-spawn lag.
async function wireHermesEmail(
  podShort: string,
  fullUuid: string,
  slug: string,
): Promise<void> {
  const podEmailToken = randomBytes(24).toString("base64url");
  const publicHost =
    process.env.PODS_PUBLIC_HOST ??
    new URL(process.env.PELICAN_URL ?? "https://localhost").hostname;
  const address = `${slug}@${process.env.EMAIL_DOMAIN ?? "inbox.bigcat.pw"}`;
  const outboundProxy = `https://${publicHost}/api/pods/${podShort}/email/send`;

  try {
    const { default: db } = await import("@/lib/db");
    db.prepare("UPDATE pod_domains SET pod_email_token = ? WHERE slug = ?").run(
      podEmailToken,
      slug,
    );
  } catch (err) {
    console.warn(
      `[deploy] failed to persist POD_EMAIL_TOKEN for ${slug}: ${err instanceof Error ? err.message : err}`,
    );
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const cmd = `
mkdir -p /home/container/.hermes
ENVF=/home/container/.hermes/.env
touch "$ENVF"
chmod 600 "$ENVF"
sed -i -E '/^(EMAIL_ADDRESS|EMAIL_OUTBOUND_PROXY|EMAIL_INBOUND_VIA_WEBHOOK|POD_EMAIL_TOKEN)=/d' "$ENVF"
cat >> "$ENVF" <<EOF
EMAIL_ADDRESS=${address}
EMAIL_OUTBOUND_PROXY=${outboundProxy}
EMAIL_INBOUND_VIA_WEBHOOK=1
POD_EMAIL_TOKEN=${podEmailToken}
EOF
`;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const { execInPod } = await import("@/lib/node-exec");
      await execInPod(
        fullUuid,
        ["exec", fullUuid, "bash", "-lc", cmd],
        { timeoutMs: 8000 },
      );
      // Once the env is in place: (1) write AGENTS.md so the agent
      // sees the actual outbound curl recipe, (2) disable the bundled
      // himalaya skill, and (3) wipe any IMAP/SMTP client binaries a
      // previous session might have left behind via `curl | sh` — the
      // agent ran `which himalaya` after the skill disable kicked in
      // and tried to use the stale binary anyway.
      try {
        const {
          buildAgentsMd,
          disableBuiltinSkills,
          installEnvAutoSource,
          writeAgentsMd,
        } = await import("@/lib/persona");
        await writeAgentsMd(fullUuid, buildAgentsMd(address));
        await disableBuiltinSkills(fullUuid, ["himalaya"]);
        await installEnvAutoSource(fullUuid);
        await execInPod(
          fullUuid,
          [
            "exec",
            fullUuid,
            "bash",
            "-lc",
            "rm -f /home/container/.local/bin/himalaya /home/container/.local/bin/mutt /home/container/.local/bin/msmtp; rm -rf /home/container/.config/himalaya /home/container/.mutt /home/container/.msmtprc",
          ],
          { timeoutMs: 4000 },
        );
      } catch (err) {
        console.warn(
          `[deploy] post-email-wiring step failed for ${podShort}: ${err instanceof Error ? err.message : err}`,
        );
      }
      return;
    } catch (err) {
      if (attempt === 9) {
        console.warn(
          `[deploy] EMAIL_* env-write failed on ${podShort} after 10 retries: ${err instanceof Error ? err.message : err}`,
        );
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// Restart a pod through Pelican's Client API using the owning user's
// stored client token (power lives under /api/client, not /application).
// Best-effort: logs and swallows on failure.
async function restartPodViaClient(
  userId: number,
  identifier: string,
): Promise<void> {
  try {
    const { default: db } = await import("@/lib/db");
    const row = db
      .prepare<[number], { pelican_client_token: string | null }>(
        "SELECT pelican_client_token FROM users WHERE id = ?",
      )
      .get(userId);
    if (!row?.pelican_client_token) {
      console.warn(`[wire] no client token for user ${userId}; skip restart`);
      return;
    }
    const res = await fetch(
      `${process.env.PELICAN_URL}/api/client/servers/${encodeURIComponent(identifier)}/power`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${row.pelican_client_token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ signal: "restart" }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.warn(`[wire] restart ${identifier} failed: Pelican ${res.status}`);
    }
  } catch (err) {
    console.warn(
      `[wire] restart ${identifier} errored: ${err instanceof Error ? err.message : err}`,
    );
  }
}

// Wire an n8n pod to its public auto-domain. Modern n8n uses built-in
// user management (the owner-account setup + login screen — the "IdP"),
// which needs to know its own public URL to build absolute links, run
// login/OAuth redirects, and print correct webhook URLs behind Caddy.
//
// The slug isn't known until the auto-domain is created post-install, so
// like wireHermesEmail we write a proxy-env file inside the container and
// (idempotently) make the start script source it, then restart n8n.
async function wireN8n(
  podShort: string,
  fullUuid: string,
  slug: string,
  userId: number,
): Promise<void> {
  const url = `https://${fullDomain(slug)}`;
  const host = fullDomain(slug);
  // Written into the container; sourced by .n8n-start.sh before `n8n start`.
  // N8N_PROTOCOL stays http internally (Caddy terminates TLS); the public
  // https URLs are supplied via *_BASE_URL / WEBHOOK_URL, and N8N_PROXY_HOPS
  // tells n8n to trust Caddy's X-Forwarded-* so secure cookies / redirects
  // work. Editor is served at the subdomain root.
  const proxyEnv = [
    `export N8N_HOST=${host}`,
    `export N8N_EDITOR_BASE_URL=${url}/`,
    `export WEBHOOK_URL=${url}/`,
    `export N8N_PROXY_HOPS=1`,
    `export N8N_SECURE_COOKIE=true`,
    "",
  ].join("\n");
  const cmd = `
set -e
mkdir -p /home/container/.n8n
cat > /home/container/.n8n/proxy.env <<'EOF'
${proxyEnv}EOF
chmod 600 /home/container/.n8n/proxy.env
# Back-compat: older start scripts (baked before proxy.env existed) don't
# source it. Inject a sourcing line right before the exec so existing pods
# pick up the override too. Idempotent.
START=/home/container/.n8n-start.sh
if [ -f "$START" ] && ! grep -q 'proxy.env' "$START"; then
  sed -i 's#^exec #[ -f /home/container/.n8n/proxy.env ] \\&\\& . /home/container/.n8n/proxy.env\\nexec #' "$START"
fi
`;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const { execInPod } = await import("@/lib/node-exec");
      await execInPod(fullUuid, ["exec", fullUuid, "bash", "-lc", cmd], {
        timeoutMs: 8000,
      });
      // Restart so n8n boots with the public URL in its environment.
      await restartPodViaClient(userId, podShort);
      console.log(`[deploy] n8n wired to ${url} for ${podShort}`);
      return;
    } catch (err) {
      if (attempt === 9) {
        console.warn(
          `[deploy] n8n wiring failed on ${podShort} after 10 retries: ${err instanceof Error ? err.message : err}`,
        );
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// Build the env-var payload Pelican should inject into the pod. Per-type
// logic — Hermes is the busy one because of the provider system.
function buildEnvironment(
  type: PodType,
  fields: Record<string, string>,
  body: DeployRequest,
  userId?: number,
): { env: Record<string, string>; error?: string; name?: string } {
  const env: Record<string, string> = {};

  if (type.slug === "hermes") {
    const providerSlug = (body.provider ?? "openrouter").trim();
    const provider = PROVIDER_BY_SLUG[providerSlug];
    if (!provider) return { env: {}, error: `unknown provider: ${providerSlug}` };
    // Pods Managed: no user key, the backend wires the whole stack to the
    // managed-ai gateway. The egg's custom+openai path handles the main
    // model; applyManagedConfig() (post-deploy) does the rest.
    if (isManagedProvider(providerSlug)) {
      try {
        Object.assign(env, managedDeployEnv(userId));
      } catch (err) {
        return { env: {}, error: err instanceof Error ? err.message : String(err) };
      }
      return { env };
    }
    if (provider.mode !== "key") {
      return {
        env: {},
        error: `provider ${provider.label} requires interactive setup; deploy with provider="custom" or "openrouter" first and switch via the pod's Settings tab`,
      };
    }
    const missing = (provider.fields ?? [])
      .filter((f) => !f.advanced)
      .filter((f) => !(fields[f.env]?.trim()))
      .map((f) => f.env);
    if (missing.length > 0) {
      return { env: {}, error: `missing required fields: ${missing.join(", ")}` };
    }
    // Important: use `||` not `??` here — the wizard sends model: "" when
    // the user accepts the provider default, and `??` would treat that
    // empty string as "specified". We want any falsy value (undefined,
    // null, empty string) to fall through to the provider's default.
    const model =
      (body.model && body.model.trim()) ||
      provider.defaultModel ||
      "claude-sonnet-4-5";
    Object.assign(env, {
      HERMES_INFERENCE_PROVIDER: provider.slug,
      HERMES_INFERENCE_MODEL: model,
      API_SERVER_HOST: "0.0.0.0",
      API_SERVER_PORT: "8642",
      SMS_WEBHOOK_PORT: "8643",
      SMS_WEBHOOK_HOST: "0.0.0.0",
      BLUEBUBBLES_WEBHOOK_PORT: "8649",
      BLUEBUBBLES_WEBHOOK_HOST: "0.0.0.0",
      TELEGRAM_WEBHOOK_PORT: "8443",
      FEISHU_WEBHOOK_PORT: "8765",
    });
    for (const f of provider.fields ?? []) {
      const v = fields[f.env];
      if (v && v.trim().length > 0) env[`PODS_KEY_${f.env}`] = v.trim();
    }
    return { env };
  }

  // Generic types validate against their own declared fields.
  for (const f of type.fields ?? []) {
    const v = fields[f.env]?.trim() ?? "";
    if (!f.optional && !f.flavors && v.length === 0) {
      return { env: {}, error: `missing required field: ${f.env}` };
    }
    if (f.flavors) {
      const allowed = f.flavors.map((x) => x.id);
      const flavorId = v || allowed[0];
      if (!allowed.includes(flavorId)) {
        return {
          env: {},
          error: `invalid value for ${f.env}: ${flavorId}; allowed: ${allowed.join(",")}`,
        };
      }
      env[f.env] = flavorId;
      const flavor = f.flavors.find((x) => x.id === flavorId);
      if (flavor?.env) Object.assign(env, flavor.env);
    } else if (v.length > 0) {
      env[f.env] = v;
    }
  }

  // Type-specific extras.
  if (type.slug === "n8n") {
    // Allocate a per-pod encryption key so workflows + credentials are
    // recoverable on backup restore. Stored in the .env on the pod;
    // never logged here.
    if (!env.N8N_ENCRYPTION_KEY) env.N8N_ENCRYPTION_KEY = randomHex(32);
  }
  if (type.slug === "code-sandbox" && env.SANDBOX_FLAVOR === "code-server") {
    if (!env.SANDBOX_PASSWORD || env.SANDBOX_PASSWORD.length < 8) {
      return {
        env: {},
        error:
          "code-server flavor requires SANDBOX_PASSWORD (min 8 chars). Pick something strong.",
      };
    }
  }
  return { env };
}

async function rollbackCreatedServer(serverId: number): Promise<void> {
  try {
    await applicationApi(`/servers/${serverId}?force=true`, { method: "DELETE" });
    return;
  } catch (err) {
    console.warn(
      `[deploy] rollback delete failed for server ${serverId}: ${err instanceof Error ? err.message : err}`,
    );
  }
  try {
    await applicationApi(`/servers/${serverId}/force`, { method: "DELETE" });
  } catch (err) {
    console.error(
      `[deploy] rollback force-delete failed for server ${serverId}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: DeployRequest;
  try {
    body = (await req.json()) as DeployRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Pelican allocation assignment and our local pod-count gate are not atomic
  // from our point of view. Keep the critical section limited to the gate,
  // allocation pick, server create, and local persist; slow post-create wiring
  // happens after the lock is released.
  const deployResult = await withLock("deploy:create", async () => {
    const subscriptionGate = canCreatePod(user.id);
    if (!subscriptionGate.ok) {
      return NextResponse.json(
        {
          error: subscriptionGate.reason,
          message: subscriptionGate.message,
          status: subscriptionGate.status,
          plan: subscriptionGate.plan,
          active_pod_count: subscriptionGate.active_pod_count,
          active_pod_limit: subscriptionGate.active_pod_limit,
        },
        { status: 402 },
      );
    }

  const typeSlug = (body.pod_type ?? "hermes").trim().toLowerCase();
  const type = POD_TYPE_BY_SLUG[typeSlug] ?? DEFAULT_POD_TYPE;
  if (!POD_TYPE_BY_SLUG[typeSlug] && typeSlug !== "hermes") {
    return NextResponse.json(
      { error: `unknown pod_type: ${typeSlug}` },
      { status: 400 },
    );
  }

  if (body.size !== undefined && !canSelectDeploySizeForPodType(type.slug)) {
    return NextResponse.json(
      {
        error: "size_not_supported",
        message: "Size selection is only available for Hermes pods right now.",
      },
      { status: 400 },
    );
  }

  let requestedSize: ReturnType<typeof deploySizeFromRequest> = null;
  if (body.size !== undefined) {
    requestedSize = deploySizeFromRequest(body.size);
    if (!requestedSize) {
      return NextResponse.json(
        { error: "invalid_size", message: "Choose a valid pod size." },
        { status: 400 },
      );
    }
  } else if (canSelectDeploySizeForPodType(type.slug)) {
    requestedSize = deploySizeById(DEFAULT_DEPLOY_SIZE_ID);
  }
  const resourcePreset = requestedSize
    ? {
        memoryMib: requestedSize.memoryMib,
        swapMib: 0,
        diskMib: requestedSize.diskMib,
        cpuPercent: requestedSize.cpuPercent,
        allocations: type.defaults.allocations,
      }
    : type.defaults;

  if (
    !isWithinPlanResourceLimits(subscriptionGate.subscription.plan, {
      memoryMib: resourcePreset.memoryMib,
      cpuPercent: resourcePreset.cpuPercent,
    })
  ) {
    const plan = PLANS[subscriptionGate.subscription.plan as PlanId];
    const limits = getPlanResourceLimits(subscriptionGate.subscription.plan);
    return NextResponse.json(
      {
        error: "resource_limit_exceeded",
        message: `Your ${plan?.name ?? "current"} plan supports up to ${
          limits?.ramGb ?? "unlimited"
        } GB RAM and ${limits?.cpu ?? "unlimited"} vCPU. Choose a smaller size or upgrade.`,
        plan: subscriptionGate.subscription.plan,
        requested: {
          ram_mib: resourcePreset.memoryMib,
          cpu_percent: resourcePreset.cpuPercent,
        },
        allowed: limits
          ? {
              ram_mib: limits.ramMib,
              cpu_percent: limits.cpuPercent,
            }
          : null,
      },
      { status: 402 },
    );
  }

  const egg = eggId(type);
  if (!egg) {
    return NextResponse.json(
      {
        error: `pod type "${type.slug}" not provisioned on this panel — set ${type.eggIdEnv} in the frontend env to the imported egg ID.`,
      },
      { status: 503 },
    );
  }

  const fields = body.fields ?? {};
  const { env: environment, error } = buildEnvironment(type, fields, body, user.id);
  if (error) return NextResponse.json({ error }, { status: 400 });

  // Pelican wants EVERY egg-declared variable in the deploy environment;
  // unfilled ones don't auto-default. Fetch the egg's variable list and
  // seed each one with its default unless the buildEnvironment step
  // already provided a value. Most matter for community eggs (Paper has
  // SERVER_JARFILE, BUILD_NUMBER, etc.); custom eggs we author tend to
  // already include them.
  try {
    const eggMeta = await applicationApi<{
      attributes: {
        relationships?: {
          variables?: {
            data?: Array<{
              attributes: { env_variable: string; default_value: string };
            }>;
          };
        };
      };
    }>(`/eggs/${egg}?include=variables`);
    const vars = eggMeta.attributes.relationships?.variables?.data ?? [];
    for (const v of vars) {
      const k = v.attributes.env_variable;
      if (!(k in environment) && v.attributes.default_value !== undefined) {
        environment[k] = v.attributes.default_value;
      }
    }
  } catch (err) {
    console.warn(
      `[deploy] could not enumerate egg ${egg} variables: ${err instanceof Error ? err.message : err}`,
    );
  }

  const name = (body.name?.trim() || generatePodName()).slice(0, 40);

  // Pick the node with the most free RAM (= memory_limit - allocated.memory).
  // Falls through to whatever node has at least one free allocation if the
  // "best" one is full.
  let allocationId: number;
  let nodeId: number = NODE_IDS[0];
  try {
    type NodeAttrs = {
      id: number;
      memory: number;
      memory_overallocate?: number;
      disk?: number;
      disk_overallocate?: number;
      allocated_resources: { memory: number; disk?: number };
    };
    const nodeStats: Array<
      NodeAttrs & { freeMemory: number; freeDisk: number | null }
    > = [];
    for (const id of NODE_IDS) {
      try {
        const n = await applicationApi<{ attributes: NodeAttrs }>(
          `/nodes/${id}`,
        );
        const a = n.attributes;
        // Mirror Pelican's own capacity check: bookable = max * (1 +
        // overallocate/100), where overallocate = -1 disables the check.
        // Ignoring this rejects deploys the panel would happily accept.
        const memCapacity =
          a.memory_overallocate === -1
            ? Number.POSITIVE_INFINITY
            : a.memory * (1 + (a.memory_overallocate ?? 0) / 100);
        const diskCapacity =
          typeof a.disk === "number"
            ? a.disk_overallocate === -1
              ? Number.POSITIVE_INFINITY
              : a.disk * (1 + (a.disk_overallocate ?? 0) / 100)
            : null;
        nodeStats.push({
          ...a,
          freeMemory: memCapacity - a.allocated_resources.memory,
          freeDisk:
            diskCapacity == null
              ? null
              : diskCapacity - (a.allocated_resources.disk ?? 0),
        });
      } catch (err) {
        console.warn(
          `[deploy] node ${id} probe failed, skipping: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    nodeStats.sort((x, y) => y.freeMemory - x.freeMemory);

    let pickedFreeAllocId: number | null = null;
    for (const candidate of nodeStats) {
      if (candidate.freeMemory < resourcePreset.memoryMib) continue;
      if (
        candidate.freeDisk != null &&
        candidate.freeDisk < resourcePreset.diskMib
      ) {
        continue;
      }
      const alloc = await applicationApi<{
        data: Array<{ attributes: { id: number; assigned: boolean } }>;
      }>(`/nodes/${candidate.id}/allocations?per_page=200`);
      const free = alloc.data.find((a) => !a.attributes.assigned);
      if (free) {
        pickedFreeAllocId = free.attributes.id;
        nodeId = candidate.id;
        break;
      }
    }
    if (pickedFreeAllocId === null) {
      return NextResponse.json(
        {
          error: "no_capacity",
          message: `No registered node has a free allocation with ${resourcePreset.memoryMib} MB RAM and ${resourcePreset.diskMib} MB disk available.`,
        },
        { status: 503 },
      );
    }
    allocationId = pickedFreeAllocId;
    console.log(
      `[deploy] picked node ${nodeId} (free RAM = ${nodeStats.find((s) => s.id === nodeId)?.freeMemory ?? "?"} MB)`,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `allocation lookup failed: ${err instanceof Error ? err.message : err}`,
      },
      { status: 502 },
    );
  }

  // lxcfs mounts apply universally so `free` etc. see cgroup limits.
  // Game-server eggs especially care about this (Java heap sizing).
  const LXCFS_MOUNT_IDS = (process.env.PODS_LXCFS_MOUNT_IDS ?? "1,2,3,4,5,6,7")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  const image = type.defaultImage ?? "pods-ml/sandbox-ubuntu:1.0";

  let created: { object: string; attributes: ServerAttributes };
  try {
    created = await applicationApi<{
      object: string;
      attributes: ServerAttributes;
    }>("/servers", {
      method: "POST",
      body: {
        name,
        user: user.pelicanUserId,
        egg,
        docker_image: image,
        environment,
        limits: {
          memory: resourcePreset.memoryMib,
          swap: resourcePreset.swapMib,
          disk: resourcePreset.diskMib,
          io: 500,
          cpu: resourcePreset.cpuPercent,
        },
        feature_limits: {
          databases: 0,
          allocations: resourcePreset.allocations,
          backups: 0,
        },
        allocation: { default: allocationId },
        start_on_completion: true,
        skip_scripts: false,
        oom_killer: true,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const serverId = created.attributes.id;

  // Persist the local pod row before returning success. The subscription gate
  // counts this row, so a local DB failure must roll back the Pelican server.
  // Start in 'provisioning' state; it flips to 'running' on power=start or the
  // reconciliation sync.
  try {
    upsertMeterStateFromPelican({
      pod_uuid_short: created.attributes.identifier,
      pod_full_uuid: created.attributes.uuid,
      user_id: user.id,
      ramMib: resourcePreset.memoryMib,
      diskMib: resourcePreset.diskMib,
      cpuPercent: resourcePreset.cpuPercent,
      initialState: "provisioning",
    });
  } catch (err) {
    await rollbackCreatedServer(serverId);
    return NextResponse.json(
      {
        error: "local_pod_persist_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  return { created, type, serverId, lxcfsMountIds: LXCFS_MOUNT_IDS };
  });
  if (deployResult instanceof NextResponse) return deployResult;
  const { created, type, serverId, lxcfsMountIds } = deployResult;

  for (const mountId of lxcfsMountIds) {
    try {
      await applicationApi(`/mounts/${mountId}/servers`, {
        method: "POST",
        body: { servers: [serverId] },
      });
    } catch (err) {
      console.warn(
        `[deploy] failed to attach lxcfs mount ${mountId} to ${serverId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // The Paper egg's install script writes eula.txt=true at install
  // time (we patched the egg's script_install for that). No runtime
  // hook needed here — first start sees eula accepted, runs through.

  // Inline retry covers fast installs; slow Hermes installs fall through to the bg loop below.
  let autoDomain: { slug: string; url: string; port: number } | null = null;
  if (type.surface.kind === "http") {
    const autoSinglePort = !type.surface.multiPort;
    for (let attempt = 0; attempt < 6 && !autoDomain; attempt++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const result = await createDomainForPod({
          podShort: created.attributes.identifier,
          podFullUuid: created.attributes.uuid,
          port: type.surface.defaultPort,
          userId: user.id,
          kind: "auto",
          autoSinglePort,
        });
        autoDomain = {
          slug: result.slug,
          url: `https://${fullDomain(result.slug)}`,
          port: result.port,
        };
      } catch {
        /* keep trying in background if inline window expires */
      }
    }
    if (!autoDomain) {
      // Background backfill. Doesn't block the response. Logs on failure.
      const podShort = created.attributes.identifier;
      const podFullUuid = created.attributes.uuid;
      const userId = user.id;
      const port = type.surface.defaultPort;
      void (async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 10_000));
          try {
            const result = await createDomainForPod({
              podShort,
              podFullUuid,
              port,
              userId,
              kind: "auto",
              autoSinglePort,
            });
            if (type.slug === "hermes") {
              await wireHermesEmail(podShort, podFullUuid, result.slug);
              if (isManagedProvider(body.provider)) {
                await wireManagedHermes(podShort, podFullUuid, userId);
              } else if (body.provider === "custom") {
                const apiMode =
                  (body.fields?.HERMES_API_MODE ?? "openai").trim() || "openai";
                const baseUrl = (body.fields?.OPENAI_BASE_URL ?? "").trim();
                await wireHermesProxy(podShort, podFullUuid, apiMode, baseUrl);
              }
            } else if (type.slug === "n8n") {
              await wireN8n(podShort, podFullUuid, result.slug, userId);
            }
            console.log(
              `[deploy:bg] auto-domain ready for ${podShort}: ${result.slug}`,
            );
            return;
          } catch {
            /* retry */
          }
        }
        console.warn(
          `[deploy:bg] gave up on auto-domain for ${podShort} after 10min`,
        );
      })();
    }

    if (type.slug === "hermes" && autoDomain) {
      await wireHermesEmail(
        created.attributes.identifier,
        created.attributes.uuid,
        autoDomain.slug,
      );
      // Sanitizer / pod-init patch for custom-provider Hermes pods.
      // Decides path off the api_mode + base_url the user submitted.
      if (isManagedProvider(body.provider)) {
        void wireManagedHermes(
          created.attributes.identifier,
          created.attributes.uuid,
          user.id,
        );
      } else if (body.provider === "custom") {
        const apiMode =
          (body.fields?.HERMES_API_MODE ?? "openai").trim() || "openai";
        const baseUrl = (body.fields?.OPENAI_BASE_URL ?? "").trim();
        void wireHermesProxy(
          created.attributes.identifier,
          created.attributes.uuid,
          apiMode,
          baseUrl,
        );
      }
    } else if (type.slug === "n8n" && autoDomain) {
      // Point n8n at its public URL so login redirects, the editor's
      // absolute links, and webhook URLs all resolve behind Caddy. Then
      // restart so n8n picks the env up. Best-effort — non-blocking.
      void wireN8n(
        created.attributes.identifier,
        created.attributes.uuid,
        autoDomain.slug,
        user.id,
      );
    }
  }

  return NextResponse.json({
    uuid: created.attributes.uuid,
    identifier: created.attributes.identifier,
    name: created.attributes.name,
    pod_type: type.slug,
    panelUrl: `${process.env.PELICAN_URL}/server/${created.attributes.identifier}`,
    domain: autoDomain,
  });
}
