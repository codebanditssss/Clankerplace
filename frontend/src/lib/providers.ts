// Authoritative catalog of LLM providers Hermes Agent supports.
//
// Source: hermes-agent .env.example + docs/reference/environment-variables.
// `HERMES_INFERENCE_PROVIDER` accepts the `slug` values below; `apiKeyEnv`
// is the env-var Hermes reads for that provider's credentials. `baseUrlEnv`
// is the optional override env-var (left undefined for providers that
// don't expose one or for which Hermes hardcodes the URL).
//
// Anything not deployable from a static form (browser-OAuth, CLI-OAuth,
// AWS credential chain, Vercel AI Gateway with team-scoped keys, etc.) is
// marked `mode: "oauth"` or `mode: "cli"` so the UI surfaces a "open the
// terminal" handoff instead of a credential field. `mode: "key"` is the
// boring case the form can fully handle.
//
// `modelsEndpoint` is the OpenAI-compatible /v1/models URL used by the
// /api/models route to populate the model dropdown — null means "we don't
// know how to list models, fall back to free text".

export type ProviderMode = "key" | "oauth" | "cli" | "cloud";

export type ProviderField = {
  /** env-var name written into ~/.hermes/.env */
  env: string;
  label: string;
  placeholder?: string;
  /** non-secret fields render as text, secrets as password */
  secret?: boolean;
  /** advanced fields are only shown in the Advanced tab */
  advanced?: boolean;
  /** optional default seeded into the form */
  default?: string;
  /** when set, renders as a radio-group of these options instead of a
   * text input. The user picks one; the value stored is the option's
   * `value` field. */
  options?: ReadonlyArray<{
    value: string;
    label: string;
    hint?: string;
  }>;
  /** longer explanatory text shown under the label/options */
  help?: string;
};

export type Provider = {
  /** value passed to `HERMES_INFERENCE_PROVIDER` */
  slug: string;
  label: string;
  blurb: string;
  /** display group in the picker */
  group:
    | "recommended"
    | "popular"
    | "regional"
    | "local"
    | "enterprise"
    | "experimental"
    | "custom";
  mode: ProviderMode;
  /** primary credential field, if mode === "key" */
  fields?: ProviderField[];
  /** OpenAI-compatible /v1/models URL — null if not listable */
  modelsEndpoint?: { url: string; auth: "bearer" | "x-api-key" | "none" } | null;
  /** human-readable instructions for OAuth/cli/cloud modes */
  oauthHint?: string;
  /** suggested default model id (free-text fallback) */
  defaultModel?: string;
  /** signup / docs URL */
  homepage?: string;
  /** pods.ml-managed: no user key, fully configured by the backend */
  managed?: boolean;
};

// NOTE: order within each group is intentional — most-popular first.
export const PROVIDERS: Provider[] = [
  // ---------------------------- pods.ml -------------------------------
  {
    slug: "pods-ml",
    label: "Pods Managed",
    blurb:
      "Zero-setup AI, fully managed by clankerplace — AI provider routing, fallbacks, vision, speech (STT/TTS), web search/extract, and image generation are pre-wired. No API key required.",
    group: "recommended",
    mode: "key",
    managed: true,
    fields: [],
    modelsEndpoint: null,
    homepage: "https://github.com/codebanditssss/FuelBorn",
  },

  // ---------------------------- recommended ---------------------------
  {
    slug: "openrouter",
    label: "OpenRouter",
    blurb: "200+ models behind one key (Claude, GPT, Gemini, Llama, Hermes…).",
    group: "recommended",
    mode: "key",
    fields: [
      {
        env: "OPENROUTER_API_KEY",
        label: "OpenRouter API key",
        placeholder: "sk-or-…",
        secret: true,
      },
      {
        env: "OPENROUTER_BASE_URL",
        label: "Base URL override",
        placeholder: "https://openrouter.ai/api/v1",
        advanced: true,
      },
    ],
    modelsEndpoint: { url: "https://openrouter.ai/api/v1/models", auth: "bearer" },
    defaultModel: "nousresearch/hermes-3-llama-3.1-70b",
    homepage: "https://openrouter.ai/keys",
  },
  {
    slug: "nous",
    label: "Nous Portal",
    blurb: "Native endpoint for Nous's own Hermes models.",
    group: "recommended",
    mode: "key",
    fields: [
      {
        env: "NOUS_API_KEY",
        label: "Nous Portal API key",
        placeholder: "nous-…",
        secret: true,
      },
      {
        env: "NOUS_BASE_URL",
        label: "Base URL override",
        advanced: true,
      },
    ],
    modelsEndpoint: {
      url: "https://inference-api.nousresearch.com/v1/models",
      auth: "bearer",
    },
    defaultModel: "Hermes-3-Llama-3.1-70B",
    homepage: "https://portal.nousresearch.com",
  },
  {
    slug: "anthropic",
    label: "Anthropic (API key)",
    blurb: "Claude models via console.anthropic.com — pay-per-token.",
    group: "recommended",
    mode: "key",
    fields: [
      {
        env: "ANTHROPIC_API_KEY",
        label: "Anthropic API key",
        placeholder: "sk-ant-…",
        secret: true,
      },
    ],
    modelsEndpoint: {
      url: "https://api.anthropic.com/v1/models",
      auth: "x-api-key",
    },
    defaultModel: "claude-sonnet-4-5",
    homepage: "https://console.anthropic.com/",
  },
  {
    slug: "openai-codex",
    label: "OpenAI",
    blurb: "GPT-4o / 4.1 / o-series via api.openai.com.",
    group: "recommended",
    mode: "key",
    fields: [
      {
        env: "OPENAI_API_KEY",
        label: "OpenAI API key",
        placeholder: "sk-…",
        secret: true,
      },
      {
        env: "OPENAI_BASE_URL",
        label: "Base URL override",
        placeholder: "https://api.openai.com/v1",
        advanced: true,
      },
    ],
    modelsEndpoint: {
      url: "https://api.openai.com/v1/models",
      auth: "bearer",
    },
    defaultModel: "gpt-4o",
    homepage: "https://platform.openai.com/api-keys",
  },
  {
    slug: "gemini",
    label: "Google AI Studio (Gemini)",
    blurb: "Gemini 1.5 / 2.0 via OpenAI-compatible endpoint.",
    group: "recommended",
    mode: "key",
    fields: [
      {
        env: "GOOGLE_API_KEY",
        label: "Google AI Studio API key",
        placeholder: "AIza…",
        secret: true,
      },
      {
        env: "GEMINI_BASE_URL",
        label: "Base URL override",
        advanced: true,
      },
    ],
    modelsEndpoint: {
      url: "https://generativelanguage.googleapis.com/v1beta/openai/models",
      auth: "bearer",
    },
    defaultModel: "gemini-2.0-flash-exp",
    homepage: "https://aistudio.google.com/app/apikey",
  },

  // ---------------------------- popular -------------------------------
  {
    slug: "novita",
    label: "NovitaAI",
    blurb: "AI-native cloud with 90+ open + closed models.",
    group: "popular",
    mode: "key",
    fields: [
      { env: "NOVITA_API_KEY", label: "Novita API key", secret: true },
      { env: "NOVITA_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: {
      url: "https://api.novita.ai/openai/v1/models",
      auth: "bearer",
    },
    defaultModel: "meta-llama/llama-3.1-70b-instruct",
    homepage: "https://novita.ai/settings/key-management",
  },
  {
    slug: "deepseek",
    label: "DeepSeek",
    blurb: "DeepSeek V3 / R1 direct from platform.deepseek.com.",
    group: "popular",
    mode: "key",
    fields: [
      { env: "DEEPSEEK_API_KEY", label: "DeepSeek API key", secret: true },
      { env: "DEEPSEEK_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: {
      url: "https://api.deepseek.com/v1/models",
      auth: "bearer",
    },
    defaultModel: "deepseek-chat",
    homepage: "https://platform.deepseek.com/api_keys",
  },
  {
    slug: "xai",
    label: "xAI (Grok)",
    blurb: "Grok models from console.x.ai.",
    group: "popular",
    mode: "key",
    fields: [
      { env: "XAI_API_KEY", label: "xAI API key", secret: true },
      { env: "XAI_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: { url: "https://api.x.ai/v1/models", auth: "bearer" },
    defaultModel: "grok-2-latest",
    homepage: "https://console.x.ai/",
  },
  {
    slug: "huggingface",
    label: "Hugging Face Inference Providers",
    blurb: "20+ open models, free $0.10/mo tier.",
    group: "popular",
    mode: "key",
    fields: [
      {
        env: "HF_TOKEN",
        label: "Hugging Face token",
        placeholder: "hf_…",
        secret: true,
      },
      { env: "HF_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: {
      url: "https://router.huggingface.co/v1/models",
      auth: "bearer",
    },
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    homepage: "https://huggingface.co/settings/tokens",
  },
  {
    slug: "nvidia",
    label: "NVIDIA NIM",
    blurb: "Nemotron + open models, free credits via build.nvidia.com.",
    group: "popular",
    mode: "key",
    fields: [
      { env: "NVIDIA_API_KEY", label: "NVIDIA API key", secret: true },
      {
        env: "NVIDIA_BASE_URL",
        label: "Base URL override",
        placeholder: "https://integrate.api.nvidia.com/v1",
        advanced: true,
      },
    ],
    modelsEndpoint: {
      url: "https://integrate.api.nvidia.com/v1/models",
      auth: "bearer",
    },
    defaultModel: "nvidia/llama-3.1-nemotron-70b-instruct",
    homepage: "https://build.nvidia.com",
  },
  {
    slug: "ollama-cloud",
    label: "Ollama Cloud",
    blurb: "Hosted Ollama catalog without needing a local GPU.",
    group: "popular",
    mode: "key",
    fields: [
      { env: "OLLAMA_API_KEY", label: "Ollama Cloud API key", secret: true },
      { env: "OLLAMA_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: {
      url: "https://ollama.com/v1/models",
      auth: "bearer",
    },
    homepage: "https://ollama.com/settings/keys",
  },
  {
    slug: "ai-gateway",
    label: "Vercel AI Gateway",
    blurb: "Multi-provider routing through ai-gateway.vercel.sh.",
    group: "popular",
    mode: "key",
    fields: [
      {
        env: "AI_GATEWAY_API_KEY",
        label: "AI Gateway API key",
        secret: true,
      },
      {
        env: "AI_GATEWAY_BASE_URL",
        label: "Base URL override",
        placeholder: "https://ai-gateway.vercel.sh/v1",
        advanced: true,
      },
    ],
    modelsEndpoint: null,
    homepage: "https://ai-gateway.vercel.sh",
  },

  // ---------------------------- regional ------------------------------
  {
    slug: "zai",
    label: "z.ai / GLM",
    blurb: "ZhipuAI GLM-4 / GLM-4-Plus.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "GLM_API_KEY", label: "z.ai API key", secret: true },
      { env: "GLM_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: {
      url: "https://api.z.ai/api/paas/v4/models",
      auth: "bearer",
    },
    homepage: "https://z.ai",
  },
  {
    slug: "kimi-coding",
    label: "Kimi (Moonshot AI)",
    blurb: "Moonshot Kimi K2 / K2.5 coding models.",
    group: "regional",
    mode: "key",
    fields: [
      {
        env: "KIMI_API_KEY",
        label: "Kimi API key",
        placeholder: "sk-kimi-…",
        secret: true,
      },
      {
        env: "KIMI_BASE_URL",
        label: "Base URL override",
        placeholder: "https://api.kimi.com/coding/v1",
        advanced: true,
      },
    ],
    modelsEndpoint: null,
    homepage: "https://platform.kimi.ai",
  },
  {
    slug: "kimi-coding-cn",
    label: "Kimi China (Moonshot CN)",
    blurb: "Moonshot China endpoint (api.moonshot.cn).",
    group: "regional",
    mode: "key",
    fields: [
      { env: "KIMI_CN_API_KEY", label: "Moonshot China API key", secret: true },
    ],
    modelsEndpoint: null,
    homepage: "https://platform.moonshot.cn",
  },
  {
    slug: "minimax",
    label: "MiniMax (global)",
    blurb: "MiniMax M-series via the global Anthropic-compatible endpoint.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "MINIMAX_API_KEY", label: "MiniMax API key", secret: true },
      { env: "MINIMAX_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: null,
    homepage: "https://www.minimax.io",
  },
  {
    slug: "minimax-cn",
    label: "MiniMax China",
    blurb: "MiniMax China endpoint (api.minimaxi.com).",
    group: "regional",
    mode: "key",
    fields: [
      { env: "MINIMAX_CN_API_KEY", label: "MiniMax CN API key", secret: true },
    ],
    modelsEndpoint: null,
    homepage: "https://www.minimaxi.com",
  },
  {
    slug: "alibaba",
    label: "Alibaba DashScope (Qwen)",
    blurb: "Qwen models via Alibaba Model Studio.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "DASHSCOPE_API_KEY", label: "DashScope API key", secret: true },
      {
        env: "DASHSCOPE_BASE_URL",
        label: "Base URL override (set CN URL for mainland)",
        advanced: true,
      },
    ],
    modelsEndpoint: null,
    defaultModel: "qwen-max",
    homepage: "https://modelstudio.console.alibabacloud.com/",
  },
  {
    slug: "alibaba-coding-plan",
    label: "Alibaba Coding Plan (Qwen Coder)",
    blurb: "Same DashScope key, routed through the Coding Plan.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "DASHSCOPE_API_KEY", label: "DashScope API key", secret: true },
    ],
    modelsEndpoint: null,
    homepage: "https://modelstudio.console.alibabacloud.com/",
  },
  {
    slug: "xiaomi",
    label: "Xiaomi MiMo",
    blurb: "MiMo v2 pro / omni / flash from Xiaomi.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "XIAOMI_API_KEY", label: "Xiaomi MiMo API key", secret: true },
      { env: "XIAOMI_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: {
      url: "https://api.xiaomimimo.com/v1/models",
      auth: "bearer",
    },
    homepage: "https://platform.xiaomimimo.com",
  },
  {
    slug: "stepfun",
    label: "StepFun",
    blurb: "Step-series models.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "STEPFUN_API_KEY", label: "StepFun API key", secret: true },
      { env: "STEPFUN_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: {
      url: "https://api.stepfun.com/v1/models",
      auth: "bearer",
    },
    homepage: "https://platform.stepfun.com",
  },
  {
    slug: "tencent-tokenhub",
    label: "Tencent TokenHub",
    blurb: "Tencent's hosted model catalog.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "TOKENHUB_API_KEY", label: "TokenHub API key", secret: true },
    ],
    modelsEndpoint: null,
    homepage: "https://tokenhub.tencentmaas.com",
  },
  {
    slug: "arcee",
    label: "Arcee AI",
    blurb: "Trinity small / large models.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "ARCEEAI_API_KEY", label: "Arcee API key", secret: true },
      { env: "ARCEE_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: null,
    homepage: "https://chat.arcee.ai/",
  },
  {
    slug: "gmi",
    label: "GMI Cloud",
    blurb: "Open models on GMI's serving infra.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "GMI_API_KEY", label: "GMI Cloud API key", secret: true },
      { env: "GMI_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: {
      url: "https://api.gmi-serving.com/v1/models",
      auth: "bearer",
    },
    homepage: "https://www.gmicloud.ai/",
  },
  {
    slug: "kilocode",
    label: "Kilo Code",
    blurb: "Kilo Code gateway.",
    group: "regional",
    mode: "key",
    fields: [
      { env: "KILOCODE_API_KEY", label: "Kilo Code API key", secret: true },
      { env: "KILOCODE_BASE_URL", label: "Base URL override", advanced: true },
    ],
    modelsEndpoint: null,
    homepage: "https://kilo.ai",
  },

  // ---------------------------- enterprise / cloud --------------------
  {
    slug: "bedrock",
    label: "AWS Bedrock",
    blurb: "Bedrock-hosted Claude / Llama / Mistral. Uses AWS credential chain.",
    group: "enterprise",
    mode: "cloud",
    oauthHint:
      "Bedrock uses the AWS credential chain — open the pod terminal and either configure ~/.aws/credentials or set AWS_REGION + AWS_PROFILE before running `hermes`. Hermes will pick them up via boto3.",
    homepage: "https://aws.amazon.com/bedrock/",
  },
  {
    slug: "azure-foundry",
    label: "Azure AI Foundry",
    blurb: "Azure-hosted OpenAI / Claude deployments.",
    group: "enterprise",
    mode: "key",
    fields: [
      {
        env: "AZURE_FOUNDRY_API_KEY",
        label: "Azure Foundry API key",
        secret: true,
      },
      {
        env: "AZURE_FOUNDRY_BASE_URL",
        label: "Foundry endpoint URL",
        placeholder: "https://<resource>.openai.azure.com/openai/v1",
      },
      {
        env: "AZURE_ANTHROPIC_KEY",
        label: "Azure Anthropic key (if using Claude on Foundry)",
        secret: true,
        advanced: true,
      },
    ],
    modelsEndpoint: null,
    homepage: "https://ai.azure.com/",
  },
  {
    slug: "copilot",
    label: "GitHub Copilot",
    blurb: "Copilot REST endpoint — uses your GitHub OAuth or fine-grained PAT.",
    group: "enterprise",
    mode: "key",
    fields: [
      {
        env: "COPILOT_GITHUB_TOKEN",
        label: "GitHub Copilot OAuth token (gho_… or github_pat_…)",
        secret: true,
      },
    ],
    modelsEndpoint: null,
    oauthHint:
      "Classic ghp_* tokens are NOT supported by Hermes — use a fine-grained PAT or `gh auth login` to mint a `gho_*` OAuth token.",
    homepage: "https://github.com/settings/personal-access-tokens",
  },
  {
    slug: "copilot-acp",
    label: "GitHub Copilot (ACP CLI)",
    blurb: "Drives the local `copilot` CLI binary over ACP.",
    group: "enterprise",
    mode: "cli",
    oauthHint:
      "Open the pod terminal, install the GitHub Copilot CLI (`npm i -g @github/copilot`), run `copilot auth login`, then come back here.",
    homepage: "https://github.com/github/copilot-cli",
  },
  {
    slug: "opencode-zen",
    label: "OpenCode Zen",
    blurb: "Pay-as-you-go curated model gateway from opencode.ai.",
    group: "enterprise",
    mode: "key",
    fields: [
      {
        env: "OPENCODE_ZEN_API_KEY",
        label: "OpenCode Zen API key",
        secret: true,
      },
      {
        env: "OPENCODE_ZEN_BASE_URL",
        label: "Base URL override",
        advanced: true,
      },
    ],
    modelsEndpoint: null,
    homepage: "https://opencode.ai/auth",
  },
  {
    slug: "opencode-go",
    label: "OpenCode Go",
    blurb: "$10/mo subscription for open models (GLM-5, Kimi K2.5, MiniMax M2.5).",
    group: "enterprise",
    mode: "key",
    fields: [
      {
        env: "OPENCODE_GO_API_KEY",
        label: "OpenCode Go API key",
        secret: true,
      },
    ],
    modelsEndpoint: null,
    homepage: "https://opencode.ai/auth",
  },

  // ---------------------------- OAuth / CLI ---------------------------
  {
    slug: "anthropic-oauth",
    label: "Anthropic OAuth (Claude Max plan)",
    blurb:
      "Sign in with your Anthropic account — uses Claude Max overage credits, NOT API billing.",
    group: "recommended",
    mode: "oauth",
    oauthHint:
      "Open the pod terminal and run `hermes setup` → Anthropic → OAuth. Requires a Claude Max plan with purchased extra usage credits (Claude Pro is not supported). Hermes routes as Claude Code.",
    homepage: "https://www.anthropic.com/pricing",
  },
  {
    slug: "minimax-oauth",
    label: "MiniMax OAuth (browser login)",
    blurb: "Sign in via browser — no API key required.",
    group: "regional",
    mode: "oauth",
    oauthHint:
      "Open the pod terminal and run `hermes setup` → MiniMax OAuth. The pod will print a URL; open it locally and approve. See https://hermes-agent.nousresearch.com/docs/guides/minimax-oauth.",
    homepage: "https://www.minimax.io",
  },
  {
    slug: "qwen-oauth",
    label: "Qwen OAuth",
    blurb: "Reuses Qwen CLI login (~/.qwen/oauth_creds.json).",
    group: "regional",
    mode: "cli",
    oauthHint:
      "Open the pod terminal, install Qwen CLI (`npm i -g @qwen-cloud/qwen-cli`), run `qwen auth qwen-oauth`, then return here.",
    homepage: "https://portal.qwen.ai/",
  },
  {
    slug: "google-gemini-cli",
    label: "Google Gemini CLI (PKCE OAuth)",
    blurb: "Free Gemini tier via Google's gemini-cli OAuth flow.",
    group: "recommended",
    mode: "oauth",
    oauthHint:
      "Open the pod terminal and run `hermes setup` → Google Gemini CLI. The pod prints a Google sign-in URL; open it on your local machine, approve, and the pod stores the refresh token.",
    homepage: "https://aistudio.google.com",
  },

  // ---------------------------- local / custom ------------------------
  {
    slug: "custom",
    label: "Custom endpoint",
    blurb:
      "Any vLLM / SGLang / TGI / LM Studio / self-hosted aggregator or OpenAI-compatible mirror speaking either OpenAI Chat Completions or Anthropic Messages.",
    group: "custom",
    mode: "key",
    fields: [
      {
        env: "OPENAI_BASE_URL",
        label: "Base URL",
        placeholder: "https://ai.example.com/v1",
        help: "The root URL of your endpoint. Include /v1 for OpenAI-style; Hermes auto-strips trailing /v1 when calling Anthropic Messages.",
      },
      {
        env: "OPENAI_API_KEY",
        label: "API key (use any non-empty string for unauthenticated endpoints)",
        secret: true,
        default: "EMPTY",
      },
      {
        env: "HERMES_API_MODE",
        label: "API format",
        default: "openai",
        options: [
          {
            value: "openai",
            label: "OpenAI Chat Completions",
            hint: "POST <base>/chat/completions — the default for most endpoints.",
          },
          {
            value: "anthropic",
            label: "Anthropic Messages",
            hint: "POST <base>/messages — pick this if your endpoint serves Claude natively. Hermes sanitizes empty tool-result content under this transport, avoiding the strict-validator 400 you'd otherwise hit on Claude.",
          },
        ],
        help: "Match this to what your endpoint actually exposes. Wrong choice = 404s on first request.",
      },
    ],
    modelsEndpoint: null,
    homepage: "https://hermes-agent.nousresearch.com/docs/user-guide/configuration",
  },
];

export const PROVIDER_BY_SLUG: Record<string, Provider> = Object.fromEntries(
  PROVIDERS.map((p) => [p.slug, p]),
);

export const PROVIDER_GROUPS: Array<{
  id: Provider["group"];
  label: string;
}> = [
  { id: "recommended", label: "Recommended" },
  { id: "popular", label: "Popular" },
  { id: "regional", label: "Regional" },
  { id: "enterprise", label: "Enterprise / cloud" },
  { id: "custom", label: "Custom / self-hosted" },
  { id: "local", label: "Local" },
  { id: "experimental", label: "Experimental" },
];
