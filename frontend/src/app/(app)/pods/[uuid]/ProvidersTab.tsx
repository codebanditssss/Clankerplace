"use client";

// ProvidersTab — every provider/tool knob Hermes exposes, in one screen.
//
// Sections (all collapsible accordions, only Inference is open by default):
//   1.  Inference (main LLM)          — reuses ProviderSettings (30+ providers)
//   2.  Fallback Providers            — cross-provider failover chain
//   3.  Auxiliary Models              — per-task (vision/web_extract/...) overrides
//   4.  Speech-to-text                — local / groq / openai / mistral
//   5.  Text-to-speech                — 10 providers, ElevenLabs incl.
//   6.  Image generation              — FAL.ai model picker (9 models)
//   7.  Web search & extract          — Firecrawl/SearXNG/Tavily/Exa/Parallel
//   8.  Browser automation            — Browserbase + Camofox
//   9.  Memory provider               — Honcho/Mem0/etc plugin picker
//   10. Skills hub (GitHub)           — PAT for higher rate limits
//
// Layout reference: GitHub repo settings / Vercel project settings —
// single-column accordion list, status pill in each header, expand to
// edit, secret values redacted on read.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Brain,
  ChevronDown,
  ChevronUp,
  Code,
  Database,
  Globe,
  Image as ImageIcon,
  Layers,
  Mic,
  Plus,
  RotateCcw,
  Trash2,
  Volume2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Hint } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { POD_SETTLING_NOTICE } from "@/lib/pod-settling";
import ProviderSettings from "./ProviderSettings";

// ============================ types =====================================

type KeyInfo = { present: boolean; value?: string };

type FallbackEntry = {
  provider: string;
  model: string;
  base_url?: string;
  key_env?: string;
};

type ToolsState = {
  keys: Record<string, KeyInfo>;
  yaml: {
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
    image_gen: { provider: string; model: string; use_gateway: boolean };
    video_gen: { provider: string; model: string };
    web: { provider: string; search_provider: string; extract_provider: string };
    memory: { provider: string };
    fallback_providers: FallbackEntry[];
    auxiliary: {
      vision: { provider: string; model: string };
      web_extract: { provider: string; model: string };
      session_search: { provider: string; model: string };
      compression: { provider: string; model: string };
    };
  };
};

// ============================ catalogs ==================================
// Static catalogs of provider options. Lifted from hermes-agent docs:
//   - website/docs/user-guide/features/tts.md          (10 TTS providers)
//   - website/docs/user-guide/features/web-search.md   (5 web backends)
//   - website/docs/user-guide/features/fallback-providers.md
//   - website/docs/user-guide/features/image-generation.md (9 FAL models)
//   - website/docs/user-guide/features/memory-providers.md (8 plugins)
//   - cli-config.yaml.example (auxiliary.*.provider options)

type TtsProvider = {
  slug: string;
  label: string;
  paid: boolean;
  keyEnv?: string;
  hint?: string;
};

const TTS_PROVIDERS: TtsProvider[] = [
  { slug: "edge", label: "Microsoft Edge TTS", paid: false, hint: "Free, no key — 322 voices, 74 languages. Default." },
  { slug: "elevenlabs", label: "ElevenLabs", paid: true, keyEnv: "ELEVENLABS_API_KEY", hint: "Studio-grade voice cloning + 30+ pre-made voices." },
  { slug: "openai", label: "OpenAI TTS", paid: true, keyEnv: "VOICE_TOOLS_OPENAI_KEY", hint: "alloy, echo, fable, onyx, nova, shimmer." },
  { slug: "minimax", label: "MiniMax TTS", paid: true, keyEnv: "MINIMAX_API_KEY", hint: "Speech-2.8-HD / Turbo, English & Mandarin." },
  { slug: "mistral", label: "Voxtral (Mistral)", paid: true, keyEnv: "MISTRAL_API_KEY", hint: "Voxtral-mini-tts. Same key as Voxtral STT." },
  { slug: "gemini", label: "Google Gemini TTS", paid: false, keyEnv: "GEMINI_API_KEY", hint: "Free tier — 30 pre-built voices." },
  { slug: "xai", label: "xAI Grok TTS", paid: true, keyEnv: "XAI_API_KEY", hint: "Custom voice IDs supported." },
  { slug: "neutts", label: "NeuTTS (local)", paid: false, hint: "Runs inside the pod — no API key. ~Q4 GGUF, ~250 MB." },
  { slug: "kittentts", label: "KittenTTS (local)", paid: false, hint: "Tiny on-device models (25–80 MB). 8 voices." },
  { slug: "piper", label: "Piper (local)", paid: false, hint: "Lightweight ONNX TTS — fast on CPU." },
];

const WEB_PROVIDERS = [
  { slug: "firecrawl", label: "Firecrawl", caps: "search · extract · crawl", keyEnv: "FIRECRAWL_API_KEY", free: "500 credits/mo" },
  { slug: "searxng", label: "SearXNG", caps: "search (self-hosted)", urlEnv: "SEARXNG_URL", free: "free" },
  { slug: "tavily", label: "Tavily", caps: "search · extract · crawl", keyEnv: "TAVILY_API_KEY", free: "1000/mo" },
  { slug: "exa", label: "Exa", caps: "search · extract", keyEnv: "EXA_API_KEY", free: "1000/mo" },
  { slug: "parallel", label: "Parallel", caps: "search · extract", keyEnv: "PARALLEL_API_KEY", free: "paid" },
  { slug: "brave-free", label: "Brave Search (free)", caps: "search", keyEnv: "BRAVE_SEARCH_API_KEY", free: "2000/mo free" },
  { slug: "ddgs", label: "DuckDuckGo", caps: "search (no key)", free: "free" },
] as const;

// Per-backend image-generation model catalogs. Hermes has 4 image-gen
// plugins; each ships its own model list.
//   - fal           : 9 FAL.ai models (default backend)
//   - xai           : grok-imagine-image (XAI_API_KEY)
//   - openai        : gpt-image-2 quality tiers (OPENAI_API_KEY)
//   - openai-codex  : same gpt-image-2 via ChatGPT OAuth (no env key —
//                     credentials come from `hermes model` Codex flow)
type ImageBackend = {
  slug: string;
  label: string;
  keyEnv?: string;
  hint?: string;
  models: Array<{ slug: string; label: string; note?: string; price?: string }>;
};
const IMAGE_BACKENDS: ImageBackend[] = [
  {
    slug: "fal",
    label: "FAL.ai",
    keyEnv: "FAL_KEY",
    hint: "9 models — fast/cheap FLUX 2 Klein to studio-grade Recraft V4 Pro.",
    models: [
      { slug: "fal-ai/flux-2/klein/9b", label: "FLUX 2 Klein 9B", note: "<1s, fast crisp text", price: "$0.006/MP" },
      { slug: "fal-ai/flux-2-pro", label: "FLUX 2 Pro", note: "~6s, studio photorealism", price: "$0.03/MP" },
      { slug: "fal-ai/z-image/turbo", label: "Z-Image Turbo", note: "~2s, bilingual EN/CN", price: "$0.005/MP" },
      { slug: "fal-ai/nano-banana-pro", label: "Nano Banana Pro", note: "~8s, Gemini 3 Pro depth", price: "$0.15/img" },
      { slug: "fal-ai/gpt-image-1.5", label: "GPT Image 1.5", note: "~15s, prompt adherence", price: "$0.034/img" },
      { slug: "fal-ai/gpt-image-2", label: "GPT Image 2", note: "~20s, SOTA text + CJK", price: "$0.04–0.06" },
      { slug: "fal-ai/ideogram/v3", label: "Ideogram v3", note: "~5s, best typography", price: "$0.03–0.09" },
      { slug: "fal-ai/recraft/v4/pro/text-to-image", label: "Recraft V4 Pro", note: "~8s, design/brand", price: "$0.25/img" },
      { slug: "fal-ai/qwen-image", label: "Qwen Image", note: "~12s, complex text", price: "$0.02/MP" },
    ],
  },
  {
    slug: "xai",
    label: "xAI Grok-Imagine",
    keyEnv: "XAI_API_KEY",
    hint: "Single model. Aspect ratios beyond what FAL/OpenAI expose.",
    models: [
      { slug: "grok-imagine-image", label: "Grok Imagine Image", note: "fast, high quality" },
    ],
  },
  {
    slug: "openai",
    label: "OpenAI gpt-image-2",
    keyEnv: "OPENAI_API_KEY",
    hint: "Three quality tiers via OpenAI's Images API.",
    models: [
      { slug: "gpt-image-2-low", label: "gpt-image-2-low", note: "~15s, fastest" },
      { slug: "gpt-image-2-medium", label: "gpt-image-2-medium", note: "~40s, balanced (default)" },
      { slug: "gpt-image-2-high", label: "gpt-image-2-high", note: "~2 min, highest fidelity" },
    ],
  },
  {
    slug: "openai-codex",
    label: "OpenAI Codex (OAuth)",
    hint: "Same gpt-image-2 routed through your ChatGPT OAuth. No env key — `hermes setup` does the login.",
    models: [
      { slug: "gpt-image-2-low", label: "gpt-image-2-low" },
      { slug: "gpt-image-2-medium", label: "gpt-image-2-medium" },
      { slug: "gpt-image-2-high", label: "gpt-image-2-high" },
    ],
  },
];

// Video generation backends. New in Hermes — entirely missing from the
// previous Providers tab.
//   - fal (Veo 3.1 / Kling / Pixverse)
//   - xai (Grok-Imagine video — text2video + img2video + extend)
type VideoBackend = {
  slug: string;
  label: string;
  keyEnv: string;
  hint: string;
  models: Array<{ slug: string; label: string; note?: string }>;
};
const VIDEO_BACKENDS: VideoBackend[] = [
  {
    slug: "fal",
    label: "FAL.ai",
    keyEnv: "FAL_KEY",
    hint: "Multi-model: Veo 3.1, Kling, Pixverse — text-to-video + image-to-video.",
    models: [
      { slug: "fal-ai/veo-3.1", label: "Veo 3.1", note: "Google's flagship; cinematic" },
      { slug: "fal-ai/kling-video/v2.0/pro/text-to-video", label: "Kling 2 Pro (T2V)" },
      { slug: "fal-ai/kling-video/v2.0/pro/image-to-video", label: "Kling 2 Pro (I2V)" },
      { slug: "fal-ai/pixverse/v4/text-to-video", label: "Pixverse v4 (T2V)" },
      { slug: "fal-ai/pixverse/v4/image-to-video", label: "Pixverse v4 (I2V)" },
    ],
  },
  {
    slug: "xai",
    label: "xAI Grok-Imagine",
    keyEnv: "XAI_API_KEY",
    hint: "T2V + I2V + reference-image-guided + edit + extend.",
    models: [
      { slug: "grok-imagine-video", label: "Grok Imagine Video" },
    ],
  },
];

type MemoryProvider = {
  slug: string;
  label: string;
  keyEnv?: string;
  hint: string;
};
const MEMORY_PROVIDERS: MemoryProvider[] = [
  { slug: "", label: "Disabled (built-in MEMORY.md only)", hint: "No external memory plugin." },
  { slug: "honcho", label: "Honcho", keyEnv: "HONCHO_API_KEY", hint: "Dialectic user modeling + session context injection." },
  { slug: "mem0", label: "Mem0", keyEnv: "MEM0_API_KEY", hint: "Semantic memory with auto-extraction." },
  { slug: "openviking", label: "OpenViking", hint: "Hermes-native ranked recall (local)." },
  { slug: "byterover", label: "Byterover", keyEnv: "BYTEROVER_API_KEY", hint: "Hosted memory layer." },
  { slug: "supermemory", label: "Supermemory", keyEnv: "SUPERMEMORY_API_KEY", hint: "Hosted long-term memory." },
  { slug: "hindsight", label: "Hindsight", hint: "Local memory with conversation chunking." },
  { slug: "holographic", label: "Holographic", hint: "Embedding-based local memory." },
  { slug: "retaindb", label: "RetainDB", hint: "Local vector retention store." },
];

// Provider slugs accepted by the fallback chain (subset of the LLM picker).
// See website/docs/user-guide/features/fallback-providers.md
const FALLBACK_PROVIDERS = [
  { slug: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY" },
  { slug: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY" },
  { slug: "ai-gateway", label: "Vercel AI Gateway", keyEnv: "AI_GATEWAY_API_KEY" },
  { slug: "gemini", label: "Google AI Studio", keyEnv: "GEMINI_API_KEY" },
  { slug: "xai", label: "xAI Grok", keyEnv: "XAI_API_KEY" },
  { slug: "deepseek", label: "DeepSeek", keyEnv: "DEEPSEEK_API_KEY" },
  { slug: "zai", label: "z.ai / GLM", keyEnv: "GLM_API_KEY" },
  { slug: "kimi-coding", label: "Kimi / Moonshot", keyEnv: "KIMI_API_KEY" },
  { slug: "minimax", label: "MiniMax", keyEnv: "MINIMAX_API_KEY" },
  { slug: "nvidia", label: "NVIDIA NIM", keyEnv: "NVIDIA_API_KEY" },
  { slug: "gmi", label: "GMI Cloud", keyEnv: "GMI_API_KEY" },
  { slug: "ollama-cloud", label: "Ollama Cloud", keyEnv: "OLLAMA_API_KEY" },
  { slug: "huggingface", label: "Hugging Face", keyEnv: "HF_TOKEN" },
  { slug: "xiaomi", label: "Xiaomi MiMo", keyEnv: "XIAOMI_API_KEY" },
  { slug: "arcee", label: "Arcee AI", keyEnv: "ARCEEAI_API_KEY" },
  { slug: "novita", label: "NovitaAI", keyEnv: "NOVITA_API_KEY" },
  { slug: "alibaba", label: "Alibaba / DashScope", keyEnv: "DASHSCOPE_API_KEY" },
  { slug: "kilocode", label: "Kilo Code", keyEnv: "KILOCODE_API_KEY" },
  { slug: "tencent-tokenhub", label: "Tencent TokenHub", keyEnv: "TOKENHUB_API_KEY" },
  { slug: "stepfun", label: "StepFun", keyEnv: "STEPFUN_API_KEY" },
  { slug: "opencode-zen", label: "OpenCode Zen", keyEnv: "OPENCODE_ZEN_API_KEY" },
  { slug: "opencode-go", label: "OpenCode Go", keyEnv: "OPENCODE_GO_API_KEY" },
  { slug: "custom", label: "Custom OpenAI-compatible endpoint", keyEnv: "(any)" },
];

// Provider slugs accepted by auxiliary tasks. Smaller list — auxiliary
// docs explicitly call this experimental, only OpenRouter / Nous /
// Gemini / Codex / main are tested.
const AUX_PROVIDERS = [
  { slug: "auto", label: "auto (use main model)" },
  { slug: "openrouter", label: "OpenRouter" },
  { slug: "nous", label: "Nous Portal" },
  { slug: "gemini", label: "Google AI Studio" },
  { slug: "ollama-cloud", label: "Ollama Cloud" },
  { slug: "codex", label: "OpenAI Codex (OAuth)" },
  { slug: "main", label: "Custom endpoint (main)" },
];

// ============================ main =====================================

export default function ProvidersTab({
  identifier,
  installed,
  currentProvider,
  currentModel,
}: {
  identifier: string;
  installed: boolean;
  currentProvider: string;
  currentModel: string;
}) {
  const [state, setState] = useState<ToolsState | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/pods/${identifier}/tools`, {
        cache: "no-store",
      });
      const d = (await r.json()) as ToolsState & { error?: string };
      if (!r.ok) {
        setLoadErr(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setLoadErr(null);
      setState(d);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [identifier]);

  useEffect(() => {
    if (!installed) return;
    refresh();
  }, [installed, refresh]);

  const save = useCallback(
    async (
      section: string,
      body: {
        env?: Record<string, string | null>;
        yaml?: Partial<ToolsState["yaml"]>;
      },
    ): Promise<boolean> => {
      setSavingSection(section);
      try {
        const r = await fetch(`/api/pods/${identifier}/tools`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = (await r.json().catch(() => ({}))) as {
          ok?: true;
          error?: string;
        };
        if (!r.ok || !d.ok) {
          toast.error(d.error ?? `Save failed: HTTP ${r.status}`);
          return false;
        }
        toast.success("Saved — gateway restarting", {
          description: POD_SETTLING_NOTICE,
          duration: 8000,
        });
        await refresh();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setSavingSection(null);
      }
    },
    [identifier, refresh],
  );

  if (!installed) {
    return (
      <p className="text-[12px] text-neutral-400">
        Provider configuration unlocks once the pod finishes installing.
      </p>
    );
  }

  if (loadErr) {
    return (
      <div className="border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">
        {loadErr}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-neutral-400">
        Everything Hermes can call out to: main LLM, fallbacks, auxiliary
        side-models, voice, images, web, browser, memory, skills. Saves
        write to{" "}
        <code className="bg-neutral-900 px-1 py-0.5 text-[11px]">
          ~/.hermes/.env
        </code>{" "}
        +{" "}
        <code className="bg-neutral-900 px-1 py-0.5 text-[11px]">
          ~/.hermes/config.yaml
        </code>{" "}
        and bounce the gateway.
      </p>

      <Section
        id="inference"
        icon={<Brain className="h-3.5 w-3.5" />}
        title="Inference (main LLM)"
        description="The brain. Powers the agent's reasoning, tool calls, and responses."
        badge={
          <Badge tone="blue">
            <StatusDot tone="blue" />
            {currentProvider || "unset"}
          </Badge>
        }
        defaultOpen
      >
        <ProviderSettings
          identifier={identifier}
          currentProvider={currentProvider}
          currentModel={currentModel}
        />
      </Section>

      <Section
        id="fallback"
        icon={<Workflow className="h-3.5 w-3.5" />}
        title="Fallback Providers"
        description="Auto-failover chain when the main model rate-limits or errors. Tried in order."
        badge={
          <Badge tone={state && state.yaml.fallback_providers.length > 0 ? "green" : "neutral"}>
            <StatusDot tone={state && state.yaml.fallback_providers.length > 0 ? "green" : "neutral"} />
            {state?.yaml.fallback_providers.length ?? 0} configured
          </Badge>
        }
      >
        <FallbackForm
          state={state}
          saving={savingSection === "fallback"}
          onSave={(list, env) =>
            save("fallback", {
              env,
              yaml: { fallback_providers: list },
            })
          }
        />
      </Section>

      <Section
        id="auxiliary"
        icon={<Layers className="h-3.5 w-3.5" />}
        title="Auxiliary Models"
        description="Side-task models for image analysis, web summarization, session search, and context compression. Default routes to main — override here to cut cost."
        badge={<AuxBadge state={state} />}
      >
        <AuxForm
          state={state}
          saving={savingSection === "auxiliary"}
          onSave={(aux) => save("auxiliary", { yaml: { auxiliary: aux } })}
        />
      </Section>

      <Section
        id="stt"
        icon={<Mic className="h-3.5 w-3.5" />}
        title="Speech-to-text"
        description="Transcribes voice messages on connected platforms."
        badge={<SttBadge state={state} />}
      >
        <SttForm state={state} saving={savingSection === "stt"} onSave={(payload) => save("stt", payload)} />
      </Section>

      <Section
        id="tts"
        icon={<Volume2 className="h-3.5 w-3.5" />}
        title="Text-to-speech"
        description="Voice replies on messaging platforms — 10 providers, from free local engines to studio-grade ElevenLabs."
        badge={
          <Badge tone="green">
            <StatusDot tone="green" /> {state?.yaml.tts.provider ?? "—"}
          </Badge>
        }
      >
        <TtsForm state={state} saving={savingSection === "tts"} onSave={(payload) => save("tts", payload)} />
      </Section>

      <Section
        id="image"
        icon={<ImageIcon className="h-3.5 w-3.5" />}
        title="Image generation"
        description="4 backends — FAL.ai (9 models), xAI Grok-Imagine, OpenAI gpt-image-2, Codex OAuth."
        badge={
          <Badge tone={state ? "green" : "neutral"}>
            <StatusDot tone={state ? "green" : "neutral"} />
            {state?.yaml.image_gen.provider ?? "—"} ·{" "}
            {state?.yaml.image_gen.model?.replace(/^fal-ai\//, "") ?? "—"}
          </Badge>
        }
      >
        <ImageGenForm
          state={state}
          saving={savingSection === "image"}
          onSave={(payload) => save("image", payload)}
        />
      </Section>

      <Section
        id="video"
        icon={<Activity className="h-3.5 w-3.5" />}
        title="Video generation"
        description="FAL (Veo 3.1 / Kling / Pixverse) or xAI Grok-Imagine. Text-to-video + image-to-video."
        badge={
          <Badge tone="neutral">
            <StatusDot tone="neutral" /> {state?.yaml.video_gen.provider ?? "—"}
          </Badge>
        }
      >
        <VideoGenForm
          state={state}
          saving={savingSection === "video"}
          onSave={(payload) => save("video", payload)}
        />
      </Section>

      <Section
        id="web"
        icon={<Globe className="h-3.5 w-3.5" />}
        title="Web search & extract"
        description="5 backends. Pick one — or split search vs extract (e.g. free SearXNG for search, Firecrawl for extract)."
        badge={<WebBadge state={state} />}
      >
        <WebForm state={state} saving={savingSection === "web"} onSave={(payload) => save("web", payload)} />
      </Section>

      <Section
        id="browser"
        icon={<Bot className="h-3.5 w-3.5" />}
        title="Browser automation"
        description="Browserbase (cloud) or Camofox (anti-detection local Firefox)."
        badge={<BrowserBadge state={state} />}
      >
        <BrowserForm
          state={state}
          saving={savingSection === "browser"}
          onSave={(env) => save("browser", { env })}
        />
      </Section>

      <Section
        id="memory"
        icon={<Database className="h-3.5 w-3.5" />}
        title="Memory provider"
        description="8 external memory plugins. Built-in MEMORY.md is always active alongside."
        badge={
          <Badge tone={state?.yaml.memory.provider ? "green" : "neutral"}>
            <StatusDot tone={state?.yaml.memory.provider ? "green" : "neutral"} />
            {state?.yaml.memory.provider || "built-in only"}
          </Badge>
        }
      >
        <MemoryForm
          state={state}
          saving={savingSection === "memory"}
          onSave={(payload) => save("memory", payload)}
        />
      </Section>

      <Section
        id="observability"
        icon={<Activity className="h-3.5 w-3.5" />}
        title="Observability (Langfuse)"
        description="Optional tracing — captures every LLM call, tool call, and turn for debugging / replay."
        badge={
          <PresenceBadge
            present={
              !!state?.keys.HERMES_LANGFUSE_PUBLIC_KEY?.present &&
              !!state?.keys.HERMES_LANGFUSE_SECRET_KEY?.present
            }
          />
        }
      >
        <ObservabilityForm
          state={state}
          saving={savingSection === "observability"}
          onSave={(env) => save("observability", { env })}
        />
      </Section>

      <Section
        id="github"
        icon={<Code className="h-3.5 w-3.5" />}
        title="GitHub (skills hub)"
        description="Personal Access Token — bumps the rate limit when the agent searches or installs community skills."
        badge={<PresenceBadge present={!!state?.keys.GITHUB_TOKEN?.present} />}
      >
        <SingleKeyForm
          envKey="GITHUB_TOKEN"
          label="GitHub personal access token"
          placeholder="ghp_…"
          hint={
            <>
              Fine-grained tokens recommended —{" "}
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                github.com/settings/tokens
              </a>
              .
            </>
          }
          state={state}
          saving={savingSection === "github"}
          onSave={(value) => save("github", { env: { GITHUB_TOKEN: value } })}
        />
      </Section>
    </div>
  );
}

// ============================ accordion ================================

function Section({
  id,
  icon,
  title,
  description,
  badge,
  defaultOpen,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Card id={`provider-${id}`} className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors",
          "hover:bg-neutral-900",
          open && "border-b border-hairline",
        )}
      >
        <div className="flex h-8 w-8 flex-none items-center justify-center border border-hairline bg-neutral-900 text-neutral-300">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
              {title}
            </div>
            {badge}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-neutral-400">
            {description}
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 flex-none text-neutral-400" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-none text-neutral-400" />
        )}
      </button>
      {open && <div className="px-5 py-4">{children}</div>}
    </Card>
  );
}

function PresenceBadge({ present }: { present: boolean }) {
  return present ? (
    <Badge tone="green">
      <StatusDot tone="green" /> configured
    </Badge>
  ) : (
    <Badge tone="neutral">
      <StatusDot tone="neutral" /> not set
    </Badge>
  );
}

function SttBadge({ state }: { state: ToolsState | null }) {
  if (!state) return <Badge tone="neutral">…</Badge>;
  const prov = state.yaml.stt.provider;
  const enabled = state.yaml.stt.enabled;
  if (!enabled) {
    return (
      <Badge tone="neutral">
        <StatusDot tone="neutral" /> disabled
      </Badge>
    );
  }
  if (prov === "local" || prov === "auto") {
    return (
      <Badge tone="green">
        <StatusDot tone="green" /> {prov}
      </Badge>
    );
  }
  const reqKey =
    prov === "groq"
      ? "GROQ_API_KEY"
      : prov === "openai"
        ? "VOICE_TOOLS_OPENAI_KEY"
        : prov === "mistral"
          ? "MISTRAL_API_KEY"
          : "";
  if (reqKey && !state.keys[reqKey]?.present) {
    return (
      <Badge tone="amber">
        <StatusDot tone="amber" /> {prov} · missing key
      </Badge>
    );
  }
  return (
    <Badge tone="green">
      <StatusDot tone="green" /> {prov}
    </Badge>
  );
}

function AuxBadge({ state }: { state: ToolsState | null }) {
  if (!state) return <Badge tone="neutral">…</Badge>;
  const overrides = (
    ["vision", "web_extract", "session_search", "compression"] as const
  ).filter((k) => state.yaml.auxiliary[k].provider !== "auto").length;
  if (overrides === 0)
    return (
      <Badge tone="neutral">
        <StatusDot tone="neutral" /> all auto
      </Badge>
    );
  return (
    <Badge tone="blue">
      <StatusDot tone="blue" /> {overrides} override{overrides > 1 ? "s" : ""}
    </Badge>
  );
}

function WebBadge({ state }: { state: ToolsState | null }) {
  if (!state) return <Badge tone="neutral">…</Badge>;
  const p = state.yaml.web.provider || "firecrawl";
  const w = WEB_PROVIDERS.find((x) => x.slug === p);
  const reqKey = w && "keyEnv" in w ? w.keyEnv : undefined;
  const reqUrl = w && "urlEnv" in w ? w.urlEnv : undefined;
  const ok =
    (!reqKey || state.keys[reqKey]?.present) &&
    (!reqUrl || state.keys[reqUrl]?.present);
  return (
    <Badge tone={ok ? "green" : "amber"}>
      <StatusDot tone={ok ? "green" : "amber"} />
      {p}{!ok && " · missing key"}
    </Badge>
  );
}

function BrowserBadge({ state }: { state: ToolsState | null }) {
  if (!state) return <Badge tone="neutral">…</Badge>;
  const bb = state.keys.BROWSERBASE_API_KEY?.present;
  const cf = state.keys.CAMOFOX_URL?.present;
  if (bb && cf) return (
    <Badge tone="green"><StatusDot tone="green" /> Browserbase + Camofox</Badge>
  );
  if (bb) return (
    <Badge tone="green"><StatusDot tone="green" /> Browserbase</Badge>
  );
  if (cf) return (
    <Badge tone="green"><StatusDot tone="green" /> Camofox</Badge>
  );
  return (
    <Badge tone="neutral"><StatusDot tone="neutral" /> default local</Badge>
  );
}

// ============================ forms ===================================

function SingleKeyForm({
  envKey,
  label,
  placeholder,
  hint,
  state,
  saving,
  onSave,
}: {
  envKey: string;
  label: string;
  placeholder?: string;
  hint?: React.ReactNode;
  state: ToolsState | null;
  saving: boolean;
  onSave: (value: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const present = !!state?.keys[envKey]?.present;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    const ok = await onSave(draft.trim());
    if (ok) setDraft("");
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={label}>
        <Input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={present ? "•••••••• (set — paste new to replace)" : placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {hint && <Hint>{hint}</Hint>}
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!draft.trim() || saving} loading={saving}>
          {present ? "Replace" : "Save"}
        </Button>
        {present && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onSave(null)} disabled={saving}>
            <RotateCcw className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>
    </form>
  );
}

// ----- STT -----
function SttForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  onSave: (p: { env?: Record<string, string | null>; yaml?: Partial<ToolsState["yaml"]> }) => Promise<boolean>;
}) {
  const [draftKey, setDraftKey] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<string>(state?.yaml.stt.provider ?? "auto");
  const [localModel, setLocalModel] = useState<string>(state?.yaml.stt.local_model ?? "base");
  const [language, setLanguage] = useState<string>(state?.yaml.stt.language ?? "");
  const [enabled, setEnabled] = useState<boolean>(state?.yaml.stt.enabled ?? true);

  useEffect(() => {
    if (!state) return;
    setProvider(state.yaml.stt.provider);
    setLocalModel(state.yaml.stt.local_model);
    setLanguage(state.yaml.stt.language);
    setEnabled(state.yaml.stt.enabled);
  }, [state]);

  if (!state) return <Hint>loading…</Hint>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const env: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(draftKey)) {
      if (v?.trim()) env[k] = v.trim();
    }
    const ok = await onSave({
      env,
      yaml: {
        stt: { enabled, provider, local_model: localModel, language, openai_model: state!.yaml.stt.openai_model, mistral_model: state!.yaml.stt.mistral_model },
      },
    });
    if (ok) setDraftKey({});
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ToggleRow
        label="Enable STT"
        hint="Off = voice messages dropped, not transcribed."
        value={enabled}
        onChange={setEnabled}
      />
      <Field label="Provider" hint='"local" runs faster-whisper inside the pod (no API key). "auto" picks the first available.'>
        <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="auto">auto — best available</option>
          <option value="local">local — faster-whisper (free)</option>
          <option value="groq">groq — Whisper Large v3 Turbo</option>
          <option value="openai">openai — Whisper API</option>
          <option value="mistral">mistral — Voxtral Transcribe</option>
        </Select>
      </Field>
      {provider === "local" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Local model">
            <Select value={localModel} onChange={(e) => setLocalModel(e.target.value)}>
              {["tiny", "base", "small", "medium", "large-v3", "turbo"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Language" hint="empty = auto-detect">
            <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="auto" maxLength={6} />
          </Field>
        </div>
      )}
      {provider === "groq" && (
        <KeyInput
          envKey="GROQ_API_KEY"
          label="Groq API key"
          placeholder="gsk_…"
          state={state}
          draft={draftKey}
          setDraft={setDraftKey}
        />
      )}
      {provider === "openai" && (
        <KeyInput
          envKey="VOICE_TOOLS_OPENAI_KEY"
          label="OpenAI API key"
          placeholder="sk-…"
          state={state}
          draft={draftKey}
          setDraft={setDraftKey}
        />
      )}
      {provider === "mistral" && (
        <KeyInput
          envKey="MISTRAL_API_KEY"
          label="Mistral API key"
          placeholder="mistral-…"
          state={state}
          draft={draftKey}
          setDraft={setDraftKey}
        />
      )}
      <SaveRow saving={saving} />
    </form>
  );
}

// ----- TTS -----
function TtsForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  onSave: (p: { env?: Record<string, string | null>; yaml?: Partial<ToolsState["yaml"]> }) => Promise<boolean>;
}) {
  const [provider, setProvider] = useState<string>(state?.yaml.tts.provider ?? "edge");
  const [speed, setSpeed] = useState<number>(state?.yaml.tts.speed ?? 1.0);
  const [draftKey, setDraftKey] = useState<Record<string, string>>({});
  // Per-provider sub-state — we keep a single object the user can edit live.
  const [sub, setSub] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    if (!state) return;
    setProvider(state.yaml.tts.provider);
    setSpeed(state.yaml.tts.speed);
    const init: Record<string, Record<string, string>> = {};
    for (const p of ["elevenlabs", "openai", "minimax", "mistral", "gemini", "xai", "edge", "piper", "kittentts"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      init[p] = { ...(state.yaml.tts as any)[p] };
    }
    setSub(init);
  }, [state]);

  if (!state) return <Hint>loading…</Hint>;

  const meta = TTS_PROVIDERS.find((p) => p.slug === provider);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const env: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(draftKey)) {
      if (v?.trim()) env[k] = v.trim();
    }
    const ttsYaml: Record<string, unknown> = { provider, speed };
    if (sub[provider]) ttsYaml[provider] = sub[provider];
    const ok = await onSave({
      env,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      yaml: { tts: ttsYaml as any },
    });
    if (ok) setDraftKey({});
  }

  function patchSub(k: string, v: string) {
    setSub((p) => ({ ...p, [provider]: { ...(p[provider] ?? {}), [k]: v } }));
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Provider">
        <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {TTS_PROVIDERS.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.label} {p.paid ? "(paid)" : "(free)"}
            </option>
          ))}
        </Select>
        {meta?.hint && <Hint>{meta.hint}</Hint>}
      </Field>

      <Field label="Speed" hint="0.5–2.0 typical. Provider-specific speed can override.">
        <Input
          type="number"
          step="0.05"
          min="0.25"
          max="4"
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value) || 1.0)}
        />
      </Field>

      {provider === "edge" && (
        <Field label="Voice" hint="322 voices — try en-US-AriaNeural, en-GB-RyanNeural, hi-IN-MadhurNeural, ja-JP-NanamiNeural, …">
          <Input
            value={sub.edge?.voice ?? ""}
            onChange={(e) => patchSub("voice", e.target.value)}
            placeholder="en-US-AriaNeural"
          />
        </Field>
      )}

      {provider === "elevenlabs" && (
        <>
          <KeyInput envKey="ELEVENLABS_API_KEY" label="ElevenLabs API key" placeholder="el_…" state={state} draft={draftKey} setDraft={setDraftKey} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Voice ID">
              <Input value={sub.elevenlabs?.voice_id ?? ""} onChange={(e) => patchSub("voice_id", e.target.value)} placeholder="pNInz6obpgDQGcFmaJgB" />
            </Field>
            <Field label="Model ID">
              <Select value={sub.elevenlabs?.model_id ?? "eleven_multilingual_v2"} onChange={(e) => patchSub("model_id", e.target.value)}>
                {["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5", "eleven_v3"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </Field>
          </div>
        </>
      )}

      {provider === "openai" && (
        <>
          <KeyInput envKey="VOICE_TOOLS_OPENAI_KEY" label="OpenAI API key" placeholder="sk-…" state={state} draft={draftKey} setDraft={setDraftKey} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Model">
              <Select value={sub.openai?.model ?? "gpt-4o-mini-tts"} onChange={(e) => patchSub("model", e.target.value)}>
                {["gpt-4o-mini-tts", "tts-1", "tts-1-hd"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Voice">
              <Select value={sub.openai?.voice ?? "alloy"} onChange={(e) => patchSub("voice", e.target.value)}>
                {["alloy", "echo", "fable", "onyx", "nova", "shimmer"].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </Select>
            </Field>
          </div>
        </>
      )}

      {provider === "minimax" && (
        <>
          <KeyInput envKey="MINIMAX_API_KEY" label="MiniMax API key" placeholder="minimax-…" state={state} draft={draftKey} setDraft={setDraftKey} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Model">
              <Select value={sub.minimax?.model ?? "speech-2.8-hd"} onChange={(e) => patchSub("model", e.target.value)}>
                {["speech-2.8-hd", "speech-2.8-turbo"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Voice ID" hint="see platform.minimax.io/faq/system-voice-id">
              <Input value={sub.minimax?.voice_id ?? ""} onChange={(e) => patchSub("voice_id", e.target.value)} />
            </Field>
          </div>
        </>
      )}

      {provider === "mistral" && (
        <>
          <KeyInput envKey="MISTRAL_API_KEY" label="Mistral API key" placeholder="mistral-…" state={state} draft={draftKey} setDraft={setDraftKey} />
          <Field label="Voice ID" hint="Default = Paul (Neutral)">
            <Input value={sub.mistral?.voice_id ?? ""} onChange={(e) => patchSub("voice_id", e.target.value)} placeholder="c69964a6-ab8b-4f8a-9465-ec0925096ec8" />
          </Field>
        </>
      )}

      {provider === "gemini" && (
        <>
          <KeyInput envKey="GEMINI_API_KEY" label="Gemini API key" placeholder="AI…" state={state} draft={draftKey} setDraft={setDraftKey} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Model">
              <Select value={sub.gemini?.model ?? "gemini-2.5-flash-preview-tts"} onChange={(e) => patchSub("model", e.target.value)}>
                {["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Voice" hint="30 voices: Zephyr, Puck, Kore, Enceladus, Gacrux, …">
              <Input value={sub.gemini?.voice ?? "Kore"} onChange={(e) => patchSub("voice", e.target.value)} />
            </Field>
          </div>
        </>
      )}

      {provider === "xai" && (
        <>
          <KeyInput envKey="XAI_API_KEY" label="xAI API key" placeholder="xai-…" state={state} draft={draftKey} setDraft={setDraftKey} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Voice ID">
              <Input value={sub.xai?.voice_id ?? "eve"} onChange={(e) => patchSub("voice_id", e.target.value)} />
            </Field>
            <Field label="Language" hint="ISO 639-1, e.g. en">
              <Input value={sub.xai?.language ?? "en"} onChange={(e) => patchSub("language", e.target.value)} maxLength={6} />
            </Field>
          </div>
        </>
      )}

      {(provider === "neutts" || provider === "kittentts" || provider === "piper") && (
        <div className="border border-hairline bg-neutral-950 px-3 py-2 text-[11px] text-neutral-400">
          Runs entirely inside the pod — no API key needed. First use downloads the voice
          model (~25–250 MB). Configure via{" "}
          <code className="bg-neutral-900 px-1 py-0.5">hermes tools</code> in the console for fine-grained voice/model overrides.
        </div>
      )}

      <SaveRow saving={saving} />
    </form>
  );
}

// ----- Image gen -----
function ImageGenForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  onSave: (p: { env?: Record<string, string | null>; yaml?: Partial<ToolsState["yaml"]> }) => Promise<boolean>;
}) {
  const [provider, setProvider] = useState<string>(state?.yaml.image_gen.provider ?? "fal");
  const [model, setModel] = useState<string>(state?.yaml.image_gen.model ?? IMAGE_BACKENDS[0].models[0].slug);
  const [useGateway, setUseGateway] = useState<boolean>(state?.yaml.image_gen.use_gateway ?? false);
  const [draftKey, setDraftKey] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!state) return;
    setProvider(state.yaml.image_gen.provider);
    setModel(state.yaml.image_gen.model);
    setUseGateway(state.yaml.image_gen.use_gateway);
  }, [state]);

  if (!state) return <Hint>loading…</Hint>;

  const backend = IMAGE_BACKENDS.find((b) => b.slug === provider) ?? IMAGE_BACKENDS[0];

  // When the user switches backend, snap the model to the new backend's
  // default (current selection is unlikely to exist in the new catalog).
  function onBackendChange(next: string) {
    setProvider(next);
    const b = IMAGE_BACKENDS.find((x) => x.slug === next);
    if (b) setModel(b.models[0].slug);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const env: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(draftKey)) {
      if (v?.trim()) env[k] = v.trim();
    }
    await onSave({
      env,
      yaml: { image_gen: { provider, model, use_gateway: useGateway } },
    });
    setDraftKey({});
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Backend">
        <Select value={provider} onChange={(e) => onBackendChange(e.target.value)}>
          {IMAGE_BACKENDS.map((b) => (
            <option key={b.slug} value={b.slug}>
              {b.label}
            </option>
          ))}
        </Select>
        {backend.hint && <Hint>{backend.hint}</Hint>}
      </Field>

      <Field label="Model">
        <Select value={model} onChange={(e) => setModel(e.target.value)}>
          {backend.models.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.label}
              {m.note ? ` — ${m.note}` : ""}
              {m.price ? ` (${m.price})` : ""}
            </option>
          ))}
        </Select>
      </Field>

      {/* Tool Gateway only applies when the backend is FAL. */}
      {provider === "fal" && (
        <ToggleRow
          label="Use Nous Portal Tool Gateway"
          hint="Paid Nous subscribers can route FAL image gen through the gateway without a FAL key."
          value={useGateway}
          onChange={setUseGateway}
        />
      )}

      {backend.keyEnv && !(provider === "fal" && useGateway) && (
        <KeyInput
          envKey={backend.keyEnv}
          label={`${backend.label} API key`}
          placeholder={backend.keyEnv}
          state={state}
          draft={draftKey}
          setDraft={setDraftKey}
        />
      )}
      {provider === "openai-codex" && (
        <div className="border border-hairline bg-neutral-950 px-3 py-2 text-[11px] text-neutral-400">
          No env key — open the pod terminal and run{" "}
          <code className="bg-neutral-900 px-1 py-0.5">hermes setup</code>{" "}
          → pick OpenAI Codex to authenticate via ChatGPT OAuth.
        </div>
      )}
      <SaveRow saving={saving} />
    </form>
  );
}

// ----- Video gen -----
function VideoGenForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  onSave: (p: { env?: Record<string, string | null>; yaml?: Partial<ToolsState["yaml"]> }) => Promise<boolean>;
}) {
  const [provider, setProvider] = useState<string>(state?.yaml.video_gen.provider ?? "fal");
  const [model, setModel] = useState<string>(state?.yaml.video_gen.model ?? "");
  const [draftKey, setDraftKey] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!state) return;
    setProvider(state.yaml.video_gen.provider);
    setModel(state.yaml.video_gen.model);
  }, [state]);

  if (!state) return <Hint>loading…</Hint>;

  const backend = VIDEO_BACKENDS.find((b) => b.slug === provider) ?? VIDEO_BACKENDS[0];

  function onBackendChange(next: string) {
    setProvider(next);
    const b = VIDEO_BACKENDS.find((x) => x.slug === next);
    if (b && b.models.length > 0) setModel(b.models[0].slug);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const env: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(draftKey)) {
      if (v?.trim()) env[k] = v.trim();
    }
    await onSave({ env, yaml: { video_gen: { provider, model } } });
    setDraftKey({});
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Backend">
        <Select value={provider} onChange={(e) => onBackendChange(e.target.value)}>
          {VIDEO_BACKENDS.map((b) => (
            <option key={b.slug} value={b.slug}>{b.label}</option>
          ))}
        </Select>
        {backend.hint && <Hint>{backend.hint}</Hint>}
      </Field>
      <Field label="Default model" hint="Empty = backend default. Agent may still pick any model from the backend's catalog at call time.">
        <Select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">(backend default)</option>
          {backend.models.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.label}{m.note ? ` — ${m.note}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <KeyInput
        envKey={backend.keyEnv}
        label={`${backend.label} API key`}
        placeholder={backend.keyEnv}
        state={state}
        draft={draftKey}
        setDraft={setDraftKey}
      />
      <SaveRow saving={saving} />
    </form>
  );
}

// ----- Observability (Langfuse) -----
function ObservabilityForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  onSave: (env: Record<string, string | null>) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (!state) return <Hint>loading…</Hint>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(drafts)) {
      if (v?.trim()) payload[k] = v.trim();
    }
    if (Object.keys(payload).length === 0) return;
    const ok = await onSave(payload);
    if (ok) setDrafts({});
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Hint>
        Optional Langfuse tracing — captures every LLM call, tool call, and turn
        for debugging / replay. Sign up at{" "}
        <a href="https://langfuse.com" target="_blank" rel="noreferrer" className="underline">
          langfuse.com
        </a>{" "}
        and grab a project public + secret key.
      </Hint>
      <KeyInput envKey="HERMES_LANGFUSE_PUBLIC_KEY" label="Langfuse public key" placeholder="pk-lf-…" state={state} draft={drafts} setDraft={setDrafts} />
      <KeyInput envKey="HERMES_LANGFUSE_SECRET_KEY" label="Langfuse secret key" placeholder="sk-lf-…" state={state} draft={drafts} setDraft={setDrafts} />
      <Field label="Host (optional)" hint="Defaults to https://cloud.langfuse.com — only set this for self-hosted Langfuse.">
        <Input
          value={drafts.HERMES_LANGFUSE_HOST ?? state.keys.HERMES_LANGFUSE_HOST?.value ?? ""}
          onChange={(e) => setDrafts((p) => ({ ...p, HERMES_LANGFUSE_HOST: e.target.value }))}
          placeholder="https://cloud.langfuse.com"
          autoComplete="off"
        />
      </Field>
      <SaveRow saving={saving} />
    </form>
  );
}

// ----- Web search & extract -----
function WebForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  onSave: (p: { env?: Record<string, string | null>; yaml?: Partial<ToolsState["yaml"]> }) => Promise<boolean>;
}) {
  const [provider, setProvider] = useState<string>(state?.yaml.web.provider ?? "firecrawl");
  const [split, setSplit] = useState<boolean>(
    !!(state?.yaml.web.search_provider || state?.yaml.web.extract_provider),
  );
  const [searchProv, setSearchProv] = useState<string>(state?.yaml.web.search_provider ?? "");
  const [extractProv, setExtractProv] = useState<string>(state?.yaml.web.extract_provider ?? "");
  const [draftKey, setDraftKey] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!state) return;
    setProvider(state.yaml.web.provider);
    setSearchProv(state.yaml.web.search_provider);
    setExtractProv(state.yaml.web.extract_provider);
    setSplit(!!(state.yaml.web.search_provider || state.yaml.web.extract_provider));
  }, [state]);

  if (!state) return <Hint>loading…</Hint>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const env: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(draftKey)) {
      if (v?.trim()) env[k] = v.trim();
    }
    await onSave({
      env,
      yaml: {
        web: {
          provider,
          search_provider: split ? searchProv : "",
          extract_provider: split ? extractProv : "",
        },
      },
    });
    setDraftKey({});
  }

  // Render key inputs for whichever providers are touched.
  const involvedSlugs = split ? [searchProv, extractProv] : [provider];
  const involved = WEB_PROVIDERS.filter((p) => involvedSlugs.includes(p.slug));

  return (
    <form onSubmit={submit} className="space-y-4">
      <ToggleRow
        label="Use the same provider for search and extract"
        hint="Off lets you mix (e.g. SearXNG for search + Firecrawl for extract)."
        value={!split}
        onChange={(v) => setSplit(!v)}
      />
      {!split ? (
        <Field label="Provider">
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {WEB_PROVIDERS.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.label} — {p.caps} ({p.free})
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Search provider">
            <Select value={searchProv} onChange={(e) => setSearchProv(e.target.value)}>
              <option value="">(default)</option>
              {WEB_PROVIDERS.filter((p) => p.caps.includes("search")).map((p) => (
                <option key={p.slug} value={p.slug}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Extract provider">
            <Select value={extractProv} onChange={(e) => setExtractProv(e.target.value)}>
              <option value="">(default)</option>
              {WEB_PROVIDERS.filter((p) => p.caps.includes("extract")).map((p) => (
                <option key={p.slug} value={p.slug}>{p.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <div className="space-y-3">
        {involved.map((p) =>
          "keyEnv" in p && p.keyEnv ? (
            <KeyInput
              key={p.slug}
              envKey={p.keyEnv}
              label={`${p.label} API key`}
              placeholder={p.keyEnv}
              state={state}
              draft={draftKey}
              setDraft={setDraftKey}
            />
          ) : "urlEnv" in p && p.urlEnv ? (
            <Field key={p.slug} label={`${p.label} URL`}>
              <Input
                value={draftKey[p.urlEnv] ?? state.keys[p.urlEnv]?.value ?? ""}
                onChange={(e) => setDraftKey((d) => ({ ...d, [p.urlEnv!]: e.target.value }))}
                placeholder="https://searxng.example.com"
                autoComplete="off"
              />
              <Hint>self-hosted SearXNG instance, no API key needed</Hint>
            </Field>
          ) : null,
        )}
      </div>
      <SaveRow saving={saving} />
    </form>
  );
}

// ----- Browser -----
function BrowserForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  onSave: (env: Record<string, string | null>) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (!state) return <Hint>loading…</Hint>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(drafts)) {
      if (v?.trim()) payload[k] = v.trim();
    }
    if (Object.keys(payload).length === 0) return;
    const ok = await onSave(payload);
    if (ok) setDrafts({});
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        Browserbase (cloud)
      </h4>
      <KeyInput envKey="BROWSERBASE_API_KEY" label="API key" placeholder="bb_…" state={state} draft={drafts} setDraft={setDrafts} />
      <KeyInput envKey="BROWSERBASE_PROJECT_ID" label="Project ID" placeholder="proj_…" state={state} draft={drafts} setDraft={setDrafts} secret={false} />
      <h4 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        Camofox (anti-detection local browser)
      </h4>
      <Field label="Camofox URL" hint="Local Camoufox server URL. Empty = use Browserbase / default Chromium.">
        <Input
          value={drafts.CAMOFOX_URL ?? state.keys.CAMOFOX_URL?.value ?? ""}
          onChange={(e) => setDrafts((d) => ({ ...d, CAMOFOX_URL: e.target.value }))}
          placeholder="http://127.0.0.1:8123"
          autoComplete="off"
        />
      </Field>
      <KeyInput envKey="CAMOFOX_SESSION_KEY" label="Camofox session key (optional)" placeholder="optional shared profile key" state={state} draft={drafts} setDraft={setDrafts} />
      <SaveRow saving={saving} />
    </form>
  );
}

// ----- Memory -----
function MemoryForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  onSave: (p: { env?: Record<string, string | null>; yaml?: Partial<ToolsState["yaml"]> }) => Promise<boolean>;
}) {
  const [provider, setProvider] = useState<string>(state?.yaml.memory.provider ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (state) setProvider(state.yaml.memory.provider);
  }, [state]);

  if (!state) return <Hint>loading…</Hint>;

  const meta = MEMORY_PROVIDERS.find((m) => m.slug === provider);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const env: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(drafts)) {
      if (v?.trim()) env[k] = v.trim();
    }
    await onSave({ env, yaml: { memory: { provider } } });
    setDrafts({});
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Active memory provider" hint="Only one external plugin can be active at a time. Built-in MEMORY.md still runs alongside.">
        <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {MEMORY_PROVIDERS.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.label}
            </option>
          ))}
        </Select>
        {meta?.hint && <Hint>{meta.hint}</Hint>}
      </Field>
      {meta?.keyEnv && (
        <KeyInput envKey={meta.keyEnv} label={`${meta.label} API key`} placeholder={meta.keyEnv} state={state} draft={drafts} setDraft={setDrafts} />
      )}
      <SaveRow saving={saving} />
    </form>
  );
}

// ----- Fallback chain -----
function FallbackForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  // Second arg carries any new env keys captured inline (e.g. HF_TOKEN
  // typed into the Add-a-fallback panel) so the chain + the key save
  // atomically in one POST.
  onSave: (list: FallbackEntry[], env?: Record<string, string | null>) => Promise<boolean>;
}) {
  const [list, setList] = useState<FallbackEntry[]>(state?.yaml.fallback_providers ?? []);
  const [draft, setDraft] = useState<FallbackEntry>({ provider: "openrouter", model: "" });
  // Pending env-var values: provider keys typed inline in the "Add a
  // fallback" panel, NOT yet written to disk. They flush on Save.
  // For known providers we key by their declared keyEnv; for "custom"
  // we key by the user-supplied key_env name.
  const [pendingKeys, setPendingKeys] = useState<Record<string, string>>({});
  // Inline draft for the secret key the user is typing for the current
  // draft provider — gets folded into pendingKeys when Add-to-chain is
  // clicked.
  const [draftKeyValue, setDraftKeyValue] = useState<string>("");

  useEffect(() => {
    if (state) setList(state.yaml.fallback_providers);
  }, [state]);

  if (!state) return <Hint>loading…</Hint>;

  const draftMeta = FALLBACK_PROVIDERS.find((p) => p.slug === draft.provider);
  // The env var name to attach the typed key to.
  const draftKeyEnv =
    draft.provider === "custom"
      ? (draft.key_env ?? "").trim() || null
      : draftMeta?.keyEnv && draftMeta.keyEnv !== "(any)"
        ? draftMeta.keyEnv
        : null;
  const draftKeyAlreadySet =
    !!draftKeyEnv &&
    (!!state.keys[draftKeyEnv]?.present || !!pendingKeys[draftKeyEnv]);

  function add() {
    if (!draft.provider || !draft.model.trim()) {
      toast.error("Fallback needs both a provider and a model.");
      return;
    }
    if (draft.provider === "custom") {
      if (!draft.base_url?.trim() || !draft.key_env?.trim()) {
        toast.error("Custom fallback needs both base URL and a key env var name.");
        return;
      }
    }
    // Capture any inline key the user typed.
    if (draftKeyEnv && draftKeyValue.trim()) {
      setPendingKeys((p) => ({ ...p, [draftKeyEnv]: draftKeyValue.trim() }));
    }
    setList((p) => [...p, { ...draft, model: draft.model.trim() }]);
    setDraft({ provider: "openrouter", model: "" });
    setDraftKeyValue("");
  }

  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    setList(copy);
  }

  function remove(i: number) {
    setList((p) => p.filter((_, idx) => idx !== i));
  }

  async function save() {
    // Flush any in-progress key in the draft input too — saves users
    // a click when they forget to hit Add-to-chain first.
    const env: Record<string, string | null> = { ...pendingKeys };
    if (draftKeyEnv && draftKeyValue.trim()) {
      env[draftKeyEnv] = draftKeyValue.trim();
    }
    const ok = await onSave(list, Object.keys(env).length > 0 ? env : undefined);
    if (ok) {
      setPendingKeys({});
      setDraftKeyValue("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="border border-hairline bg-neutral-950 p-3 text-[11px] text-neutral-400">
        When your main model rate-limits, errors, or 401s, Hermes tries each entry below in
        order. <strong>Paste the API key right here when you add the fallback</strong> —
        Hermes will write it into{" "}
        <code className="bg-neutral-900 px-1 py-0.5 text-[10px]">~/.hermes/.env</code>{" "}
        on save. No need to bounce over to the Inference panel.
      </div>

      {list.length === 0 ? (
        <p className="text-[12px] text-neutral-500">No fallbacks configured.</p>
      ) : (
        <ol className="space-y-2">
          {list.map((entry, i) => {
            const meta = FALLBACK_PROVIDERS.find((p) => p.slug === entry.provider);
            const keyEnv =
              entry.provider === "custom"
                ? entry.key_env
                : meta?.keyEnv && meta.keyEnv !== "(any)"
                  ? meta.keyEnv
                  : undefined;
            const keyOk =
              !keyEnv || !!state.keys[keyEnv]?.present || !!pendingKeys[keyEnv];
            return (
              <li
                key={i}
                className="flex items-center gap-2 border border-hairline bg-neutral-900 px-3 py-2"
              >
                <span className="text-[11px] font-mono text-neutral-500">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-foreground">
                    <span className="font-semibold">{meta?.label ?? entry.provider}</span>
                    <span className="ml-1 text-neutral-400">→ {entry.model}</span>
                  </div>
                  {!keyOk && keyEnv && (
                    <div className="text-[11px] text-warning">
                      {keyEnv} not set — this fallback will be skipped.
                    </div>
                  )}
                  {pendingKeys[keyEnv ?? ""] && (
                    <div className="text-[11px] text-success">
                      {keyEnv} ready to save
                    </div>
                  )}
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === list.length - 1}>↓</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} title="Remove">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="border border-dashed border-hairline bg-neutral-950 p-3 space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          Add a fallback
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Field label="Provider">
            <Select
              value={draft.provider}
              onChange={(e) => {
                setDraft({ provider: e.target.value, model: "" });
                setDraftKeyValue("");
              }}
            >
              {FALLBACK_PROVIDERS.map((p) => (
                <option key={p.slug} value={p.slug}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Model" hint='Exact model ID (e.g. "anthropic/claude-sonnet-4")'>
            <Input
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder="anthropic/claude-sonnet-4"
            />
          </Field>
        </div>

        {draft.provider === "custom" && (
          <div className="grid gap-2 md:grid-cols-2">
            <Field label="Base URL">
              <Input
                value={draft.base_url ?? ""}
                onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
                placeholder="https://my-endpoint/v1"
              />
            </Field>
            <Field label="Key env var name" hint="The .env variable Hermes should read your key from (e.g. MY_LOCAL_KEY).">
              <Input
                value={draft.key_env ?? ""}
                onChange={(e) => setDraft({ ...draft, key_env: e.target.value })}
                placeholder="MY_LOCAL_KEY"
              />
            </Field>
          </div>
        )}

        {/* Inline API-key field — the whole point of this fix. Shown
            whenever the picked provider needs a key AND it isn't already
            set in .env. */}
        {draftKeyEnv && !draftKeyAlreadySet && (
          <Field label={`${draftMeta?.label ?? draft.provider} API key`}>
            <Input
              type="password"
              value={draftKeyValue}
              onChange={(e) => setDraftKeyValue(e.target.value)}
              placeholder={draftKeyEnv}
              autoComplete="off"
              spellCheck={false}
            />
            <Hint>
              Will be written to{" "}
              <code className="bg-neutral-900 px-1 py-0.5 text-[10px]">
                {draftKeyEnv}
              </code>{" "}
              in{" "}
              <code className="bg-neutral-900 px-1 py-0.5 text-[10px]">
                ~/.hermes/.env
              </code>{" "}
              when you click Save chain.
            </Hint>
          </Field>
        )}
        {draftKeyEnv && draftKeyAlreadySet && (
          <Hint>
            <code className="bg-neutral-900 px-1 py-0.5 text-[10px]">
              {draftKeyEnv}
            </code>{" "}
            is already set — this fallback will use the existing key.
          </Hint>
        )}

        <Button type="button" size="sm" variant="secondary" onClick={add}>
          <Plus className="h-3 w-3" /> Add to chain
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={save}
          loading={saving}
          disabled={saving}
        >
          Save chain
        </Button>
        {Object.keys(pendingKeys).length > 0 && (
          <span className="text-[11px] text-neutral-400">
            ({Object.keys(pendingKeys).length} key{Object.keys(pendingKeys).length > 1 ? "s" : ""} pending)
          </span>
        )}
      </div>
    </div>
  );
}

// ----- Auxiliary models -----
function AuxForm({
  state,
  saving,
  onSave,
}: {
  state: ToolsState | null;
  saving: boolean;
  onSave: (aux: ToolsState["yaml"]["auxiliary"]) => Promise<boolean>;
}) {
  const [aux, setAux] = useState<ToolsState["yaml"]["auxiliary"] | null>(
    state?.yaml.auxiliary ?? null,
  );

  useEffect(() => {
    if (state) setAux(state.yaml.auxiliary);
  }, [state]);

  if (!aux || !state) return <Hint>loading…</Hint>;

  const tasks = [
    { key: "vision" as const, label: "Vision", desc: "image_analyze tool + browser screenshots" },
    { key: "web_extract" as const, label: "Web extract", desc: "web_extract page summaries (saves a lot on Opus / GPT-5)" },
    { key: "session_search" as const, label: "Session search", desc: "Summarizes matching past sessions" },
    { key: "compression" as const, label: "Compression", desc: "Auto-shrinks long conversations" },
  ];

  return (
    <div className="space-y-4">
      <Hint>
        Defaults to <code className="bg-neutral-900 px-1 py-0.5 text-[10px]">auto</code>{" "}
        (uses your main model). Pick a cheaper/faster model per task to cut cost without changing the main brain.
      </Hint>
      {tasks.map((t) => (
        <div key={t.key} className="space-y-2 border border-hairline bg-neutral-950 p-3">
          <div>
            <div className="text-[12px] font-semibold text-foreground">{t.label}</div>
            <div className="text-[11px] text-neutral-400">{t.desc}</div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <Select
              value={aux[t.key].provider}
              onChange={(e) => setAux({ ...aux, [t.key]: { ...aux[t.key], provider: e.target.value } })}
            >
              {AUX_PROVIDERS.map((p) => (
                <option key={p.slug} value={p.slug}>{p.label}</option>
              ))}
            </Select>
            <Input
              value={aux[t.key].model}
              onChange={(e) => setAux({ ...aux, [t.key]: { ...aux[t.key], model: e.target.value } })}
              placeholder='model (empty = provider default, e.g. "google/gemini-3-flash-preview")'
            />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button type="button" variant="primary" size="sm" onClick={() => onSave(aux)} loading={saving} disabled={saving}>
          Save overrides
        </Button>
      </div>
    </div>
  );
}

// ============================ tiny helpers ============================

function KeyInput({
  envKey,
  label,
  placeholder,
  state,
  draft,
  setDraft,
  secret = true,
}: {
  envKey: string;
  label: string;
  placeholder?: string;
  state: ToolsState;
  draft: Record<string, string>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  secret?: boolean;
}) {
  const info = state.keys[envKey];
  const present = !!info?.present;
  return (
    <Field label={label}>
      <Input
        type={secret ? "password" : "text"}
        value={
          secret
            ? draft[envKey] ?? ""
            : draft[envKey] ?? info?.value ?? ""
        }
        onChange={(e) => setDraft((p) => ({ ...p, [envKey]: e.target.value }))}
        placeholder={
          present
            ? secret
              ? "•••••••• (set — paste new to replace)"
              : info?.value ?? placeholder
            : placeholder
        }
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border border-hairline bg-neutral-950 px-3 py-2">
      <div>
        <div className="text-[12px] font-medium text-foreground">{label}</div>
        {hint && <Hint>{hint}</Hint>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors",
          value
            ? "border-success/50 bg-success/30"
            : "border-hairline bg-neutral-900",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 transform rounded-full transition-transform",
            value
              ? "translate-x-4 bg-success"
              : "translate-x-0.5 bg-neutral-400",
          )}
        />
      </button>
    </div>
  );
}

function SaveRow({ saving }: { saving: boolean }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Button type="submit" size="sm" variant="primary" loading={saving} disabled={saving}>
        Save
      </Button>
    </div>
  );
}
