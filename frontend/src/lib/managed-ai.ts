// Managed AI ("Pods Managed") configuration.
//
// When a user picks "Pods Managed" instead of bringing their own LLM key,
// every model + tool on the pod is wired to the FuelBorn managed-ai gateway
// (the Cloudflare worker in /managed-ai-gateway) — one OpenAI-compatible
// endpoint that fans out to GLM / MiMo / Gemma / Mercury / Deepgram / Azure /
// Parallel. The user gets a fully-configured agent with zero keys to manage.
//
// This module is the single source of truth for the managed model→task map.
// Change a model here and every newly-deployed managed pod picks it up.
//
// Routing rationale:
//   - main      glm-5.2        strong general model
//   - fallback  mimo-v2.5      cheap, fast failover
//   - vision    gemma-4-26b    multimodal image analysis
//   - web_extract gemma-4-26b  summarization fits gemma
//   - session_search mercury-2 diffusion model, optimized for speed
//   - compression  main        MUST have context >= main model, so we keep it
//                              on the main model (mercury/gemma are 128k <
//                              glm-5.2's 200k and would fail compaction)
//   - stt       whisper-large-v3-turbo   STT via the gateway
//   - tts       aura-2-en      Deepgram TTS via the gateway
//   - image     gpt-image-2    Azure image gen via the gateway
//   - web       parallel       Parallel.ai search + extract
import { writeEnv, patchConfigYaml } from "@/lib/pod-config";
import { getConfig } from "@/lib/billing/config";
import { createHmac } from "node:crypto";

export const MANAGED_SLUG = "pods-ml";

export function isManagedProvider(slug: string | undefined | null): boolean {
  return slug === MANAGED_SLUG;
}

// Gateway base + auth. The base URL is not secret (it's a public worker);
// the proxy key and the Parallel key are. All come from env so prod can
// rotate them without a code change.
function gatewayBase(): string {
  return (
    process.env.MANAGED_AI_BASE_URL ??
    "https://pods-managed-ai.nighthost-team.workers.dev"
  ).replace(/\/+$/, "");
}
function gatewayV1(): string {
  return `${gatewayBase()}/v1`;
}
/** Public gateway /v1 URL — used as the sanitizer upstream for managed pods. */
export function managedGatewayV1(): string {
  return gatewayV1();
}
function managedKey(): string {
  return process.env.MANAGED_AI_KEY ?? "";
}
function parallelKey(): string {
  return process.env.MANAGED_PARALLEL_KEY ?? "";
}

// HMAC secret shared with the gateway worker. When set (and managed billing
// is enabled), each managed pod is deployed with a per-user signed token
// instead of the shared key, so the gateway can attribute inference cost to
// the right credit wallet.
function managedTokenSecret(): string {
  return process.env.MANAGED_TOKEN_SECRET ?? "";
}

/**
 * Mint a per-user gateway token: `pmk.<userId>.<hmacHex>`. The gateway worker
 * recomputes the HMAC with the same MANAGED_TOKEN_SECRET to verify the token
 * and extract the user id it should bill. The user id is not secret; the HMAC
 * is what prevents a pod from forging a different user's identity.
 */
export function mintManagedToken(userId: number): string {
  const mac = createHmac("sha256", managedTokenSecret())
    .update(String(userId))
    .digest("hex");
  return `pmk.${userId}.${mac}`;
}

/** True when per-user metering should be wired into newly deployed pods. */
export function managedBillingActive(): boolean {
  return (
    managedTokenSecret().length > 0 &&
    getConfig("feature.managed_billing_enabled") === true
  );
}

/**
 * The API key baked into a managed pod's gateway calls. When metering is
 * active this is a per-user signed token (so the gateway bills the right
 * wallet and can hard-block at the floor); otherwise it's the shared
 * MANAGED_AI_KEY — the legacy anonymous behavior, unchanged.
 */
function managedKeyForUser(userId: number | undefined): string {
  if (userId != null && managedBillingActive()) {
    return mintManagedToken(userId);
  }
  return managedKey();
}

// The managed model map (clean IDs as exposed by the gateway's /v1/models).
export const MANAGED_MODELS = {
  main: "glm-5.2",
  vision: "gemma-4-26b",
  webExtract: "gemma-4-26b",
  sessionSearch: "mercury-2",
  stt: "whisper-large-v3-turbo",
  tts: "aura-2-en",
  image: "gpt-image-2",
} as const;

// Fallback chain tried in order when the main model (glm-5.2) errors out.
// Ordered performance → speed so quality degrades gracefully: flagship-tier
// backups first, ultra-fast diffusion (mercury) as the last-resort "just
// respond". Every entry routes through the managed gateway.
export const MANAGED_FALLBACK_CHAIN = [
  "mimo-v2.5", // solid general primary fallback
  "kimi-k2.7-code", // flagship-tier, agentic/coding, 256k
  "qwen3.7-plus", // flagship-tier, 256k context
  "deepseek-v4-flash", // fast reasoning, capable
  // glm-4.7-flash removed 2026-07-06: upstream hangs indefinitely (>60s even
  // for tiny prompts), stalling every fallback traversal that reached it.
  "gemma-4-26b", // lightweight + fast
  "mercury-2", // ultra-fast diffusion, last resort
] as const;

/**
 * Deploy-time environment for a managed pod. We reuse the egg's existing
 * "custom + openai" provider path: it points model.base_url at the in-pod
 * sanitizer (127.0.0.1:8765) whose upstream is OPENAI_BASE_URL — which we set
 * to the gateway. So the main model resolves hermes → sanitizer → gateway →
 * glm-5.2 with no post-deploy patching needed for the primary model.
 *
 * Throws if the managed key isn't configured, so a misconfigured prod fails
 * loudly at deploy instead of silently shipping a keyless pod.
 */
export function managedDeployEnv(userId?: number): Record<string, string> {
  const key = managedKeyForUser(userId);
  if (!key) {
    throw new Error(
      "MANAGED_AI_KEY is not set — cannot deploy a Pods Managed pod",
    );
  }
  return {
    HERMES_INFERENCE_PROVIDER: "custom",
    HERMES_INFERENCE_MODEL: MANAGED_MODELS.main,
    HERMES_API_MODE: "openai",
    API_SERVER_HOST: "0.0.0.0",
    API_SERVER_PORT: "8642",
    SMS_WEBHOOK_PORT: "8643",
    SMS_WEBHOOK_HOST: "0.0.0.0",
    BLUEBUBBLES_WEBHOOK_PORT: "8649",
    BLUEBUBBLES_WEBHOOK_HOST: "0.0.0.0",
    TELEGRAM_WEBHOOK_PORT: "8443",
    FEISHU_WEBHOOK_PORT: "8765",
    // Drives the egg's custom+openai branch: main model → sanitizer → gateway.
    PODS_KEY_OPENAI_BASE_URL: gatewayV1(),
    PODS_KEY_OPENAI_API_KEY: key,
  };
}

/**
 * Post-deploy: write the rest of the managed config (fallback, auxiliary
 * models, STT/TTS, image, web search) into the pod's .env + config.yaml.
 * The main model was already wired by the egg via managedDeployEnv().
 *
 * Idempotent — safe to re-run (e.g. a "reset to managed defaults" action).
 * Does NOT restart the gateway; the caller (deploy / switch) does that.
 */
export async function applyManagedConfig(uuid: string, userId?: number): Promise<void> {
  const v1 = gatewayV1();
  const key = managedKeyForUser(userId);
  const parallel = parallelKey();

  // ---- secrets / overrides into ~/.hermes/.env ----
  await writeEnv(uuid, {
    PODS_MANAGED_KEY: key, // referenced as ${PODS_MANAGED_KEY} in config.yaml
    // Voice tools (STT/TTS) speak OpenAI's audio API; point them at the gw.
    VOICE_TOOLS_OPENAI_KEY: key,
    STT_OPENAI_BASE_URL: v1,
    STT_OPENAI_MODEL: MANAGED_MODELS.stt,
    // Image gen (openai backend) + any other OpenAI-wire tool → gateway.
    OPENAI_BASE_URL: v1,
    OPENAI_API_KEY: key,
    // Web search/extract via Parallel.ai.
    PARALLEL_API_KEY: parallel,
  });

  // ---- structured config in ~/.hermes/config.yaml ----
  await patchConfigYaml(uuid, (cfg) => {
    // Fallback chain — tried in order through the gateway when glm-5.2 errors.
    cfg.fallback_providers = MANAGED_FALLBACK_CHAIN.map((model) => ({
      provider: "custom",
      model,
      base_url: v1,
      key_env: "PODS_MANAGED_KEY",
    }));

    // Auxiliary side-models. provider "main" means "use the custom endpoint"
    // (OPENAI_BASE_URL + OPENAI_API_KEY) — which we've pointed at the gateway —
    // with the given model. This is the form Hermes documents AND the one the
    // Providers tab renders correctly. compression stays on the main model
    // (empty model) because the summary model's context must be >= the main
    // model's (mercury/gemma are smaller and would silently drop turns).
    const aux = (cfg.auxiliary as Record<string, unknown>) ?? {};
    const managedAux = (model: string) => ({ provider: "main", model });
    aux.vision = managedAux(MANAGED_MODELS.vision);
    aux.web_extract = managedAux(MANAGED_MODELS.webExtract);
    aux.session_search = managedAux(MANAGED_MODELS.sessionSearch);
    aux.compression = { provider: "main", model: "" };
    cfg.auxiliary = aux;

    // Speech-to-text via gateway (Whisper large-v3-turbo, OpenAI-wire). Base URL
    // comes from STT_OPENAI_BASE_URL in .env (Hermes' transcription tool reads
    // that env var, not a config key).
    const stt = (cfg.stt as Record<string, unknown>) ?? {};
    stt.enabled = true;
    stt.provider = "openai";
    stt.openai = { model: MANAGED_MODELS.stt };
    cfg.stt = stt;

    // Text-to-speech via gateway (Deepgram aura-2-en, OpenAI-wire). CRITICAL:
    // tts.openai.base_url must be set — Hermes' OpenAI TTS client defaults to
    // api.openai.com otherwise, so our gateway key would be rejected there
    // ("invalid api key"). See tts_tool.py::_generate_openai_tts.
    const tts = (cfg.tts as Record<string, unknown>) ?? {};
    tts.provider = "openai";
    tts.openai = { model: MANAGED_MODELS.tts, voice: "luna", base_url: v1 };
    cfg.tts = tts;

    // Image generation via gateway (Azure gpt-image-2, OpenAI-wire).
    cfg.image_gen = { provider: "openai", model: MANAGED_MODELS.image };

    // Web search + extract via Parallel.ai.
    cfg.web = { provider: "parallel" };
  });
}
