// GET / POST /api/pods/<uuid>/tools
//
// Catch-all for every non-main-LLM provider/tool config on the pod —
// the surface the Providers tab exposes besides the main inference picker.
// Hermes splits configuration across two files:
//   - ~/.hermes/.env       flat KEY=VALUE secrets and a few overrides
//   - ~/.hermes/config.yaml structured per-tool config (tts.*, stt.*,
//                          image_gen.*, web.*, memory.provider,
//                          fallback_providers[], auxiliary.*, etc.)
//
// We round-trip both: GET returns redacted env presence + relevant yaml
// slices, POST applies a sparse update + restarts the gateway so the
// new values take effect immediately.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { describePodExecError } from "@/lib/node-exec";
import {
  readEnv,
  writeEnv,
  readConfigYaml,
  patchConfigYaml,
  restartGateway,
} from "@/lib/pod-config";

// Whitelist of env vars the Providers tab is allowed to read/write.
// Anything not in this list is ignored on POST (defense against malicious
// or bug-driven payloads mass-clearing the .env).
const ALLOWED_KEYS = [
  // --- STT / TTS (voice) ---
  "GROQ_API_KEY",
  "VOICE_TOOLS_OPENAI_KEY",
  "MISTRAL_API_KEY",
  "ELEVENLABS_API_KEY",
  "MINIMAX_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "XAI_BASE_URL",
  "STT_GROQ_MODEL",
  "STT_OPENAI_MODEL",
  "STT_OPENAI_BASE_URL",
  "GROQ_BASE_URL",
  // --- Image / video generation ---
  "FAL_KEY",
  "OPENAI_API_KEY",
  // (XAI_API_KEY already declared above for STT/TTS — reused here for
  //  xAI image + video.)
  // --- Web search / extract ---
  "FIRECRAWL_API_KEY",
  "EXA_API_KEY",
  "PARALLEL_API_KEY",
  "TAVILY_API_KEY",
  "SEARXNG_URL",
  "BRAVE_SEARCH_API_KEY",
  // --- Observability (Langfuse tracing) ---
  "HERMES_LANGFUSE_PUBLIC_KEY",
  "HERMES_LANGFUSE_SECRET_KEY",
  "HERMES_LANGFUSE_HOST",
  // --- Browser automation ---
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
  "BROWSERBASE_PROXIES",
  "BROWSERBASE_ADVANCED_STEALTH",
  "CAMOFOX_URL",
  "CAMOFOX_SESSION_KEY",
  // --- Memory plugins ---
  "HONCHO_API_KEY",
  "MEM0_API_KEY",
  "BYTEROVER_API_KEY",
  "SUPERMEMORY_API_KEY",
  // --- Skills hub / GitHub ---
  "GITHUB_TOKEN",
  // --- Fallback inference providers (these env vars are shared with
  //     the main-LLM picker; setting them here exposes them as fallback
  //     candidates). Storing the key here is enough — fallback_providers
  //     in config.yaml then references them.
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "AI_GATEWAY_API_KEY",
  "NVIDIA_API_KEY",
  "GLM_API_KEY",
  "KIMI_API_KEY",
  "ARCEEAI_API_KEY",
  "OPENCODE_ZEN_API_KEY",
  "OPENCODE_GO_API_KEY",
  "HF_TOKEN",
  "NOVITA_API_KEY",
  "OLLAMA_API_KEY",
  "DASHSCOPE_API_KEY",
  "KILOCODE_API_KEY",
  "XIAOMI_API_KEY",
  "TOKENHUB_API_KEY",
  "GMI_API_KEY",
  "STEPFUN_API_KEY",
] as const;
const ALLOWED_SET = new Set<string>(ALLOWED_KEYS);

// These are not actually secrets — model names, URLs, project IDs,
// booleans. GET returns their literal value so the UI can prefill the
// field on render. Everything else stays redacted.
const NON_SECRET = new Set<string>([
  "STT_GROQ_MODEL",
  "STT_OPENAI_MODEL",
  "STT_OPENAI_BASE_URL",
  "GROQ_BASE_URL",
  "XAI_BASE_URL",
  "BROWSERBASE_PROJECT_ID",
  "BROWSERBASE_PROXIES",
  "BROWSERBASE_ADVANCED_STEALTH",
  "CAMOFOX_URL",
  "SEARXNG_URL",
  "HERMES_LANGFUSE_HOST",
]);

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

// ============================ schema =====================================

// Subset of config.yaml the Providers tab reads/writes. Anything not
// listed here is preserved on write (patchConfigYaml merges).
type YamlSlice = {
  stt: {
    enabled: boolean;
    provider: string;
    local_model: string;
    openai_model: string;
    mistral_model: string;
    language: string;
  };
  tts: {
    provider: string;
    speed: number;
    elevenlabs: { voice_id: string; model_id: string };
    openai: { model: string; voice: string };
    minimax: { model: string; voice_id: string };
    mistral: { model: string; voice_id: string };
    gemini: { model: string; voice: string };
    xai: { voice_id: string; language: string };
    edge: { voice: string };
    piper: { voice: string };
    kittentts: { voice: string; model: string };
  };
  image_gen: {
    provider: string; // "fal" | "xai" | "openai" | "openai-codex"
    model: string;
    use_gateway: boolean;
  };
  video_gen: {
    provider: string; // "fal" | "xai"
    model: string;
  };
  web: {
    provider: string;
    search_provider: string;
    extract_provider: string;
  };
  memory: { provider: string };
  fallback_providers: Array<{ provider: string; model: string; base_url?: string; key_env?: string }>;
  auxiliary: {
    vision: { provider: string; model: string };
    web_extract: { provider: string; model: string };
    session_search: { provider: string; model: string };
    compression: { provider: string; model: string };
  };
};

const DEFAULTS: YamlSlice = {
  stt: {
    enabled: true,
    provider: "auto",
    local_model: "base",
    openai_model: "whisper-1",
    mistral_model: "voxtral-mini-latest",
    language: "",
  },
  tts: {
    provider: "edge",
    speed: 1.0,
    elevenlabs: {
      voice_id: "pNInz6obpgDQGcFmaJgB",
      model_id: "eleven_multilingual_v2",
    },
    openai: { model: "gpt-4o-mini-tts", voice: "alloy" },
    minimax: { model: "speech-2.8-hd", voice_id: "English_Graceful_Lady" },
    mistral: {
      model: "voxtral-mini-tts-2603",
      voice_id: "c69964a6-ab8b-4f8a-9465-ec0925096ec8",
    },
    gemini: { model: "gemini-2.5-flash-preview-tts", voice: "Kore" },
    xai: { voice_id: "eve", language: "en" },
    edge: { voice: "en-US-AriaNeural" },
    piper: { voice: "en_US-lessac-medium" },
    kittentts: { voice: "Jasper", model: "KittenML/kitten-tts-nano-0.8-int8" },
  },
  image_gen: {
    provider: "fal",
    model: "fal-ai/flux-2/klein/9b",
    use_gateway: false,
  },
  video_gen: { provider: "fal", model: "" },
  web: {
    provider: "firecrawl",
    search_provider: "",
    extract_provider: "",
  },
  memory: { provider: "" },
  fallback_providers: [],
  auxiliary: {
    vision: { provider: "auto", model: "" },
    web_extract: { provider: "auto", model: "" },
    session_search: { provider: "auto", model: "" },
    compression: { provider: "auto", model: "" },
  },
};

function readYamlSlice(cfg: Record<string, unknown>): YamlSlice {
  const out: YamlSlice = JSON.parse(JSON.stringify(DEFAULTS));
  const stt = (cfg.stt as Record<string, unknown>) ?? {};
  if (typeof stt.enabled === "boolean") out.stt.enabled = stt.enabled;
  if (typeof stt.provider === "string") out.stt.provider = stt.provider;
  const sttLocal = (stt.local as Record<string, unknown>) ?? {};
  if (typeof sttLocal.model === "string") out.stt.local_model = sttLocal.model;
  if (typeof sttLocal.language === "string")
    out.stt.language = sttLocal.language;
  const sttOpenai = (stt.openai as Record<string, unknown>) ?? {};
  if (typeof sttOpenai.model === "string") out.stt.openai_model = sttOpenai.model;
  const sttMistral = (stt.mistral as Record<string, unknown>) ?? {};
  if (typeof sttMistral.model === "string")
    out.stt.mistral_model = sttMistral.model;

  const tts = (cfg.tts as Record<string, unknown>) ?? {};
  if (typeof tts.provider === "string") out.tts.provider = tts.provider;
  if (typeof tts.speed === "number") out.tts.speed = tts.speed;
  type TtsSub = Record<string, unknown>;
  const merge = (key: keyof YamlSlice["tts"], fields: string[]) => {
    const sub = (tts[key as string] as TtsSub) ?? {};
    for (const f of fields) {
      if (typeof sub[f] === "string") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (out.tts[key] as any)[f] = sub[f] as string;
      }
    }
  };
  merge("elevenlabs", ["voice_id", "model_id"]);
  merge("openai", ["model", "voice"]);
  merge("minimax", ["model", "voice_id"]);
  merge("mistral", ["model", "voice_id"]);
  merge("gemini", ["model", "voice"]);
  merge("xai", ["voice_id", "language"]);
  merge("edge", ["voice"]);
  merge("piper", ["voice"]);
  merge("kittentts", ["voice", "model"]);

  const imageGen = (cfg.image_gen as Record<string, unknown>) ?? {};
  if (typeof imageGen.provider === "string")
    out.image_gen.provider = imageGen.provider;
  if (typeof imageGen.model === "string") out.image_gen.model = imageGen.model;
  if (typeof imageGen.use_gateway === "boolean")
    out.image_gen.use_gateway = imageGen.use_gateway;

  const videoGen = (cfg.video_gen as Record<string, unknown>) ?? {};
  if (typeof videoGen.provider === "string")
    out.video_gen.provider = videoGen.provider;
  if (typeof videoGen.model === "string") out.video_gen.model = videoGen.model;

  const web = (cfg.web as Record<string, unknown>) ?? {};
  if (typeof web.provider === "string") out.web.provider = web.provider;
  if (typeof web.search_provider === "string")
    out.web.search_provider = web.search_provider;
  if (typeof web.extract_provider === "string")
    out.web.extract_provider = web.extract_provider;

  const memory = (cfg.memory as Record<string, unknown>) ?? {};
  if (typeof memory.provider === "string") out.memory.provider = memory.provider;

  const fbs = cfg.fallback_providers;
  if (Array.isArray(fbs)) {
    out.fallback_providers = fbs
      .map((f) => {
        const r = (f as Record<string, unknown>) ?? {};
        return {
          provider: String(r.provider ?? ""),
          model: String(r.model ?? ""),
          base_url:
            typeof r.base_url === "string" ? r.base_url : undefined,
          key_env: typeof r.key_env === "string" ? r.key_env : undefined,
        };
      })
      .filter((f) => f.provider && f.model);
  } else {
    const single = cfg.fallback_model as Record<string, unknown> | undefined;
    if (single && typeof single.provider === "string" && typeof single.model === "string") {
      out.fallback_providers = [
        {
          provider: single.provider,
          model: single.model,
          base_url:
            typeof single.base_url === "string" ? single.base_url : undefined,
          key_env:
            typeof single.key_env === "string" ? single.key_env : undefined,
        },
      ];
    }
  }

  const aux = (cfg.auxiliary as Record<string, unknown>) ?? {};
  const auxMerge = (key: keyof YamlSlice["auxiliary"]) => {
    const sub = (aux[key as string] as Record<string, unknown>) ?? {};
    if (typeof sub.provider === "string") out.auxiliary[key].provider = sub.provider;
    if (typeof sub.model === "string") out.auxiliary[key].model = sub.model;
  };
  auxMerge("vision");
  auxMerge("web_extract");
  auxMerge("session_search");
  auxMerge("compression");

  return out;
}

// ============================ GET ========================================

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1) {
    return NextResponse.json({ error: "pod still installing" }, { status: 409 });
  }

  try {
    const [env, cfg] = await Promise.all([
      readEnv(srv.uuid),
      readConfigYaml(srv.uuid),
    ]);
    const keys: Record<string, { present: boolean; value?: string }> = {};
    for (const k of ALLOWED_KEYS) {
      const v = env[k];
      if (typeof v === "string" && v.length > 0) {
        keys[k] = NON_SECRET.has(k)
          ? { present: true, value: v }
          : { present: true };
      } else {
        keys[k] = { present: false };
      }
    }
    return NextResponse.json({ keys, yaml: readYamlSlice(cfg) });
  } catch (err) {
    const info = describePodExecError(err);
    return NextResponse.json(
      { error: info.message, code: info.code },
      { status: info.status },
    );
  }
}

// ============================ POST =======================================

type PostBody = {
  env?: Record<string, string | null>;
  yaml?: {
    stt?: Partial<YamlSlice["stt"]>;
    tts?: Partial<YamlSlice["tts"]> & {
      // Allow sparse subsection updates so the UI can save just one tab.
      [k: string]: unknown;
    };
    image_gen?: Partial<YamlSlice["image_gen"]>;
    video_gen?: Partial<YamlSlice["video_gen"]>;
    web?: Partial<YamlSlice["web"]>;
    memory?: Partial<YamlSlice["memory"]>;
    fallback_providers?: YamlSlice["fallback_providers"];
    auxiliary?: Partial<YamlSlice["auxiliary"]>;
  };
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1) {
    return NextResponse.json({ error: "pod still installing" }, { status: 409 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Accept any env var that's either in our explicit whitelist OR looks
  // like a standard UPPER_SNAKE_CASE env name. The looser path is needed
  // for the fallback chain's "custom" provider, where the user supplies
  // their own key_env name (e.g. MY_LOCAL_KEY). We still gate on the
  // shape regex so a malicious POST can't write arbitrary garbage like
  // path-like keys.
  const STANDARD_ENV_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
  const envUpdates: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(body.env ?? {})) {
    if (!ALLOWED_SET.has(k) && !STANDARD_ENV_RE.test(k)) continue;
    if (v === null || v === "") envUpdates[k] = null;
    else if (typeof v === "string") envUpdates[k] = v.trim();
  }

  try {
    if (Object.keys(envUpdates).length > 0) {
      await writeEnv(srv.uuid, envUpdates);
    }

    if (body.yaml) {
      const y = body.yaml;
      await patchConfigYaml(srv.uuid, (cfg) => {
        // ---- stt ----
        if (y.stt) {
          const cur = (cfg.stt as Record<string, unknown>) ?? {};
          if (typeof y.stt.enabled === "boolean") cur.enabled = y.stt.enabled;
          if (typeof y.stt.provider === "string") {
            if (y.stt.provider === "auto") delete cur.provider;
            else cur.provider = y.stt.provider;
          }
          const local = (cur.local as Record<string, unknown>) ?? {};
          if (typeof y.stt.local_model === "string") {
            if (y.stt.local_model) local.model = y.stt.local_model;
            else delete local.model;
          }
          if (typeof y.stt.language === "string") {
            if (y.stt.language) local.language = y.stt.language;
            else delete local.language;
          }
          cur.local = local;
          const openai = (cur.openai as Record<string, unknown>) ?? {};
          if (typeof y.stt.openai_model === "string") openai.model = y.stt.openai_model;
          cur.openai = openai;
          const mistral = (cur.mistral as Record<string, unknown>) ?? {};
          if (typeof y.stt.mistral_model === "string") mistral.model = y.stt.mistral_model;
          cur.mistral = mistral;
          cfg.stt = cur;
        }

        // ---- tts ----
        if (y.tts) {
          const cur = ((cfg.tts as Record<string, unknown>) ?? {}) as Record<
            string,
            unknown
          >;
          if (typeof y.tts.provider === "string") cur.provider = y.tts.provider;
          if (typeof y.tts.speed === "number") cur.speed = y.tts.speed;
          // Subsections: shallow-merge whatever was provided.
          for (const k of [
            "elevenlabs",
            "openai",
            "minimax",
            "mistral",
            "gemini",
            "xai",
            "edge",
            "piper",
            "kittentts",
            "neutts",
          ] as const) {
            const sub = (y.tts as Record<string, unknown>)[k];
            if (sub && typeof sub === "object") {
              const existing = (cur[k] as Record<string, unknown>) ?? {};
              cur[k] = { ...existing, ...(sub as Record<string, unknown>) };
            }
          }
          cfg.tts = cur;
        }

        // ---- image_gen ----
        if (y.image_gen) {
          const cur = (cfg.image_gen as Record<string, unknown>) ?? {};
          if (typeof y.image_gen.provider === "string")
            cur.provider = y.image_gen.provider;
          if (typeof y.image_gen.model === "string") cur.model = y.image_gen.model;
          if (typeof y.image_gen.use_gateway === "boolean")
            cur.use_gateway = y.image_gen.use_gateway;
          cfg.image_gen = cur;
        }

        // ---- video_gen ----
        if (y.video_gen) {
          const cur = (cfg.video_gen as Record<string, unknown>) ?? {};
          if (typeof y.video_gen.provider === "string")
            cur.provider = y.video_gen.provider;
          if (typeof y.video_gen.model === "string") {
            if (y.video_gen.model) cur.model = y.video_gen.model;
            else delete cur.model;
          }
          cfg.video_gen = cur;
        }

        // ---- web ----
        if (y.web) {
          const cur = (cfg.web as Record<string, unknown>) ?? {};
          if (typeof y.web.provider === "string") cur.provider = y.web.provider;
          if (typeof y.web.search_provider === "string") {
            if (y.web.search_provider) cur.search_provider = y.web.search_provider;
            else delete cur.search_provider;
          }
          if (typeof y.web.extract_provider === "string") {
            if (y.web.extract_provider) cur.extract_provider = y.web.extract_provider;
            else delete cur.extract_provider;
          }
          cfg.web = cur;
        }

        // ---- memory.provider ----
        if (y.memory) {
          const cur = (cfg.memory as Record<string, unknown>) ?? {};
          if (typeof y.memory.provider === "string") {
            if (y.memory.provider) cur.provider = y.memory.provider;
            else delete cur.provider;
          }
          cfg.memory = cur;
        }

        // ---- fallback_providers (list replace; clears fallback_model
        //      legacy key so the two don't drift). ----
        if (y.fallback_providers) {
          cfg.fallback_providers = y.fallback_providers;
          delete cfg.fallback_model;
        }

        // ---- auxiliary.{vision,web_extract,session_search,compression} ----
        if (y.auxiliary) {
          const cur = ((cfg.auxiliary as Record<string, unknown>) ?? {}) as Record<
            string,
            unknown
          >;
          for (const key of [
            "vision",
            "web_extract",
            "session_search",
            "compression",
          ] as const) {
            const sub = (y.auxiliary as Record<string, unknown>)[key] as
              | { provider?: string; model?: string }
              | undefined;
            if (!sub) continue;
            const existing = (cur[key] as Record<string, unknown>) ?? {};
            if (typeof sub.provider === "string") {
              if (sub.provider === "auto") delete existing.provider;
              else existing.provider = sub.provider;
            }
            if (typeof sub.model === "string") {
              if (sub.model) existing.model = sub.model;
              else delete existing.model;
            }
            cur[key] = existing;
          }
          cfg.auxiliary = cur;
        }
      });
    }
    await restartGateway(srv.uuid);
  } catch (err) {
    const info = describePodExecError(err);
    return NextResponse.json(
      { error: info.message, code: info.code },
      { status: info.status },
    );
  }
  return NextResponse.json({ ok: true });
}
