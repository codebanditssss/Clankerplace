/**
 * FuelBorn — Managed AI gateway worker.
 *
 * A single OpenAI-compatible endpoint that pods point their "managed AI"
 * provider at. It fans every request out to the right upstream based on the
 * `model` field:
 *
 *   - Cloudflare AI Gateway ("huni", keyless / unified-billing) for the
 *     Workers-AI-hosted models (Kimi K2.7 Code, GLM-5.2, GLM-4.7 Flash).
 *   - Inception Labs API for the Mercury diffusion model.
 *
 * Pods only ever see clean model IDs (kimi-k2.7-code, glm-5.2, glm-4.7-flash,
 * mercury-2); the upstream provider + real model string is resolved here so we
 * can swap routing without touching any pod.
 *
 * Secrets (wrangler secret put):
 *   CF_AIG_TOKEN      cf-aig-authorization bearer for the gateway
 *   INCEPTION_API_KEY Inception Labs API key
 *   PROXY_API_KEY     (optional) shared bearer pods must present. If unset the
 *                     worker is open — set it in production so this isn't a free
 *                     proxy to paid inference.
 *
 * Vars (wrangler.jsonc):
 *   CF_AIG_CHAT_URL    gateway compat chat/completions URL
 *   INCEPTION_CHAT_URL Inception chat/completions URL
 */

import { Buffer } from "node:buffer";

export interface Env {
  CF_AIG_TOKEN: string;
  INCEPTION_API_KEY: string;
  PROXY_API_KEY?: string;
  CF_AIG_CHAT_URL: string;
  INCEPTION_CHAT_URL: string;
  // Parallel.ai (web research / search / task APIs). Reverse-proxied under
  // /parallel/* — see proxyParallel().
  PARALLEL_API_KEY: string;
  PARALLEL_BASE_URL: string;
  // OpenCode Zen "go" endpoint (OpenAI-compatible chat).
  OPENCODE_API_KEY: string;
  OPENCODE_CHAT_URL: string;
  // Workers AI binding (this worker's own account) — powers STT (nova-3) and
  // TTS (aura-2-en) since the gateway compat endpoint is chat-only and the
  // raw workers-ai run path needs the gateway account's CF token.
  AI: Ai;
  // Azure OpenAI image generation (gpt-image-2) — OpenAI-images-compatible.
  AZURE_IMAGE_URL: string;
  AZURE_IMAGE_KEY: string;
  // ---- Pods Managed credit metering (all optional; when unset the gateway
  // behaves exactly as before: anonymous shared-key proxy, no metering) ----
  // HMAC secret shared with the frontend. Verifies per-user `pmk.<id>.<hmac>`
  // tokens so the gateway can attribute inference cost to a credit wallet.
  MANAGED_TOKEN_SECRET?: string;
  // Bearer the gateway presents to the frontend's /api/internal/managed/*
  // endpoints (balance check + usage report).
  MANAGED_USAGE_TOKEN?: string;
  // Frontend origin, e.g. https://app.FuelBorn — base for the internal calls.
  PODS_USAGE_CALLBACK_URL?: string;
}

type Upstream = "cf" | "inception" | "opencode";

interface ModelSpec {
  /** Clean ID pods use. */
  id: string;
  upstream: Upstream;
  /** The exact `model` string the upstream wants. */
  upstreamModel: string;
  label: string;
  ownedBy: string;
  contextWindow: number;
}

// The managed catalog. Add a row here to expose a new model to every pod.
const MODELS: ModelSpec[] = [
  {
    id: "kimi-k2.7-code",
    upstream: "cf",
    upstreamModel: "workers-ai/@cf/moonshotai/kimi-k2.7-code",
    label: "Kimi K2.7 Code (Moonshot)",
    ownedBy: "moonshotai",
    contextWindow: 256000,
  },
  {
    id: "glm-5.2",
    upstream: "cf",
    upstreamModel: "workers-ai/@cf/zai-org/glm-5.2",
    label: "GLM-5.2 (Z.ai)",
    ownedBy: "zai-org",
    contextWindow: 200000,
  },
  {
    id: "gemma-4-26b",
    upstream: "cf",
    upstreamModel: "workers-ai/@cf/google/gemma-4-26b-a4b-it",
    label: "Gemma 4 26B A4B (Google)",
    ownedBy: "google",
    contextWindow: 128000,
  },
  {
    id: "mimo-v2.5",
    upstream: "opencode",
    upstreamModel: "mimo-v2.5",
    label: "MiMo V2.5 (Xiaomi, via OpenCode Go)",
    ownedBy: "xiaomi",
    contextWindow: 128000,
  },
  {
    id: "deepseek-v4-flash",
    upstream: "opencode",
    upstreamModel: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash (via OpenCode Go)",
    ownedBy: "deepseek",
    contextWindow: 128000,
  },
  {
    id: "qwen3.7-plus",
    upstream: "opencode",
    upstreamModel: "qwen3.7-plus",
    label: "Qwen 3.7 Plus (via OpenCode Go)",
    ownedBy: "qwen",
    contextWindow: 256000,
  },
  {
    id: "mercury-2",
    upstream: "inception",
    upstreamModel: "mercury-2",
    label: "Mercury 2 (Inception Labs)",
    ownedBy: "inceptionlabs",
    contextWindow: 128000,
  },
];

// Resolve a requested model string to a spec. Accepts the clean public id,
// and as a convenience the raw upstream id too (so a caller pasting
// `workers-ai/@cf/...` still works).
const BY_ID = new Map<string, ModelSpec>();
for (const m of MODELS) {
  BY_ID.set(m.id, m);
  BY_ID.set(m.upstreamModel, m);
  BY_ID.set(m.upstreamModel.replace(/^workers-ai\//, ""), m); // @cf/... form
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });
}

function oaiError(message: string, status: number, type = "invalid_request_error"): Response {
  return json({ error: { message, type, code: status } }, status);
}

// Extract the presented bearer token, if any.
function bearer(req: Request): string {
  const h = req.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

// Constant-time string compare.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify a per-user gateway token `pmk.<userId>.<hmacHex>`. Returns the user
 * id when the HMAC (over the userId string, keyed by MANAGED_TOKEN_SECRET)
 * matches what the frontend minted; null otherwise. Mirrors
 * frontend/src/lib/managed-ai.ts::mintManagedToken.
 */
async function verifyManagedToken(token: string, env: Env): Promise<number | null> {
  if (!env.MANAGED_TOKEN_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "pmk") return null;
  const userId = Number(parts[1]);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const expected = await hmacHex(env.MANAGED_TOKEN_SECRET, String(userId));
  if (!timingSafeEqual(expected, parts[2])) return null;
  return userId;
}

type Auth = { ok: boolean; userId: number | null };

/**
 * Resolve the caller. Accepts EITHER a valid per-user `pmk.` token (metered)
 * OR the shared PROXY_API_KEY (legacy/anonymous). If PROXY_API_KEY is unset
 * and no token secret is configured, the worker is open (back-compat).
 */
async function resolveAuth(req: Request, env: Env): Promise<Auth> {
  const token = bearer(req);
  // Per-user signed token → metered identity.
  if (token.startsWith("pmk.")) {
    const userId = await verifyManagedToken(token, env);
    if (userId != null) return { ok: true, userId };
    // A pmk-shaped token that fails verification is rejected outright.
    return { ok: false, userId: null };
  }
  // Shared key (or open mode).
  if (!env.PROXY_API_KEY) return { ok: true, userId: null };
  return { ok: timingSafeEqual(token, env.PROXY_API_KEY), userId: null };
}

function meteringActive(env: Env): boolean {
  return Boolean(
    env.MANAGED_TOKEN_SECRET && env.MANAGED_USAGE_TOKEN && env.PODS_USAGE_CALLBACK_URL,
  );
}

function callbackBase(env: Env): string {
  return (env.PODS_USAGE_CALLBACK_URL || "").replace(/\/+$/, "");
}

// Short-lived per-isolate balance cache. Hard-block correctness tolerates a
// few seconds of staleness; this bounds frontend calls to ~1/user/15s.
const balanceCache = new Map<number, { allowed: boolean; ts: number }>();
const BALANCE_TTL_MS = 15_000;

/**
 * Ask the frontend whether this user may still run managed inference.
 * Fails OPEN on any error (frontend blip must not brick every agent); only an
 * explicit { allowed: false } blocks.
 */
async function balanceAllowed(userId: number, env: Env): Promise<boolean> {
  const cached = balanceCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.ts < BALANCE_TTL_MS) return cached.allowed;
  try {
    const res = await fetch(`${callbackBase(env)}/api/internal/managed/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": env.MANAGED_USAGE_TOKEN || "",
      },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) return true; // fail open
    const data = (await res.json()) as { allowed?: boolean };
    const allowed = data.allowed !== false;
    balanceCache.set(userId, { allowed, ts: now });
    return allowed;
  } catch {
    return true; // fail open
  }
}

interface ParsedUsage {
  requestId: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  upstreamCostUsd: number;
}

function pickUsageFromObject(obj: Record<string, unknown>): ParsedUsage | null {
  const usage = obj.usage as Record<string, unknown> | undefined;
  if (!usage) return null;
  const costDetails = usage.cost_details as Record<string, unknown> | undefined;
  const upstreamCost =
    (typeof costDetails?.upstream_inference_cost === "number"
      ? costDetails.upstream_inference_cost
      : undefined) ??
    (typeof usage.cost === "number" ? (usage.cost as number) : undefined) ??
    (typeof obj.cost === "number" ? (obj.cost as number) : undefined) ??
    0;
  return {
    requestId: typeof obj.id === "string" ? obj.id : null,
    model: typeof obj.model === "string" ? obj.model : null,
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens:
      typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    upstreamCostUsd: upstreamCost,
  };
}

// Extract usage from either a buffered JSON completion or an SSE stream.
function extractUsage(text: string): ParsedUsage | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Non-streaming JSON.
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      return pickUsageFromObject(obj);
    } catch {
      /* fall through to SSE parse */
    }
  }
  // SSE: scan data: lines; take id from the first, usage from whichever has it.
  let found: ParsedUsage | null = null;
  let firstId: string | null = null;
  let firstModel: string | null = null;
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l.startsWith("data:")) continue;
    const payload = l.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      if (firstId == null && typeof obj.id === "string") firstId = obj.id;
      if (firstModel == null && typeof obj.model === "string") firstModel = obj.model;
      const u = pickUsageFromObject(obj);
      if (u) found = u;
    } catch {
      /* skip non-JSON keepalives */
    }
  }
  if (found) {
    return {
      ...found,
      requestId: found.requestId ?? firstId,
      model: found.model ?? firstModel,
    };
  }
  return null;
}

/**
 * Read the tee'd response branch, extract usage, and report it to the
 * frontend for wallet debit. Best-effort; never throws into the request path.
 */
async function captureAndReport(
  stream: ReadableStream,
  userId: number,
  cleanModel: string,
  env: Env,
): Promise<void> {
  try {
    const text = await new Response(stream).text();
    const usage = extractUsage(text);
    if (!usage) return;
    const requestId = `${userId}:${usage.requestId ?? crypto.randomUUID()}`;
    await fetch(`${callbackBase(env)}/api/internal/managed/usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": env.MANAGED_USAGE_TOKEN || "",
      },
      body: JSON.stringify({
        user_id: userId,
        request_id: requestId,
        model: usage.model ?? cleanModel,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        upstream_cost_usd: usage.upstreamCostUsd,
      }),
    });
  } catch (err) {
    console.warn(`[metering] capture failed: ${err instanceof Error ? err.message : err}`);
  }
}

function listModels(): Response {
  const now = Math.floor(Date.now() / 1000);
  const chat = MODELS.map((m) => ({
    id: m.id,
    object: "model",
    created: now,
    owned_by: m.ownedBy,
    label: m.label,
    context_window: m.contextWindow,
    type: "chat",
    endpoint: "/v1/chat/completions",
  }));
  // Non-chat capabilities (speech + image) exposed by this worker.
  const aux = [
    { id: "whisper-large-v3-turbo", owned_by: "openai", label: "Whisper Large v3 Turbo (STT)", type: "transcription", endpoint: "/v1/audio/transcriptions" },
    { id: "aura-2-en", owned_by: "deepgram", label: "Aura-2 EN (Deepgram TTS)", type: "speech", endpoint: "/v1/audio/speech" },
    { id: "gpt-image-2", owned_by: "azure-openai", label: "GPT-Image-2 (Azure)", type: "image", endpoint: "/v1/images/generations" },
  ].map((m) => ({ id: m.id, object: "model", created: now, owned_by: m.owned_by, label: m.label, type: m.type, endpoint: m.endpoint }));
  return json({ object: "list", data: [...chat, ...aux] });
}

// ---- Text-to-speech (Deepgram Aura via Workers AI) ----
const TTS_MODELS: Record<string, string> = {
  "aura-2-en": "@cf/deepgram/aura-2-en",
  "aura-2-es": "@cf/deepgram/aura-2-es",
};

async function audioSpeech(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return oaiError("request body must be valid JSON", 400);
  }
  const text = typeof body.input === "string" ? body.input : typeof body.text === "string" ? body.text : "";
  if (!text) return oaiError("`input` (text to speak) is required", 400);
  const model = TTS_MODELS[String(body.model)] ?? "@cf/deepgram/aura-2-en";
  const speaker = typeof body.voice === "string" ? body.voice : typeof body.speaker === "string" ? body.speaker : "luna";

  // Aura returns an MPEG stream by default. Allow optional encoding/container
  // passthrough for callers that want wav/flac/etc.
  const input: Record<string, unknown> = { text, speaker };
  for (const k of ["encoding", "container", "sample_rate", "bit_rate"]) {
    if (body[k] !== undefined) input[k] = body[k];
  }

  try {
    const stream = (await (env.AI as unknown as { run: (m: string, i: unknown) => Promise<ReadableStream> }).run(model, input)) as ReadableStream;
    const enc = String(input.encoding ?? "mp3");
    const ct = enc === "linear16" || enc === "flac" ? "audio/wav" : enc === "opus" ? "audio/ogg" : "audio/mpeg";
    return new Response(stream, { status: 200, headers: { "Content-Type": ct, ...CORS } });
  } catch (err) {
    return oaiError(`tts failed: ${err instanceof Error ? err.message : String(err)}`, 502, "upstream_error");
  }
}

// ---- Speech-to-text (Workers AI: Deepgram nova-3 OR OpenAI whisper) ----
// Accepts OpenAI-style multipart (`file` + `model`) or a raw audio body
// (`?model=`). nova-3 and whisper have different Workers-AI I/O schemas, so we
// branch on the requested model.
const STT_MODELS: Record<string, { cf: string; family: "deepgram" | "whisper" }> = {
  "nova-3": { cf: "@cf/deepgram/nova-3", family: "deepgram" },
  "whisper-large-v3-turbo": { cf: "@cf/openai/whisper-large-v3-turbo", family: "whisper" },
  "whisper": { cf: "@cf/openai/whisper-large-v3-turbo", family: "whisper" },
};

function toBase64(buf: ArrayBuffer): string {
  // Node Buffer (nodejs_compat) — the verified path from Cloudflare's
  // whisper-large-v3-turbo docs.
  return Buffer.from(buf).toString("base64");
}

async function audioTranscriptions(req: Request, env: Env): Promise<Response> {
  const ctype = req.headers.get("Content-Type") || "";
  let audio: ArrayBuffer;
  let audioType = "audio/mpeg";
  let language: string | null = null;
  let model = "whisper-large-v3-turbo";

  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return oaiError("multipart `file` field is required", 400);
    audio = await file.arrayBuffer();
    if (file.type) audioType = file.type;
    const l = form.get("language");
    if (typeof l === "string" && l) language = l;
    const m = form.get("model");
    if (typeof m === "string" && m) model = m;
  } else {
    audio = await req.arrayBuffer();
    if (ctype) audioType = ctype;
    const u = new URL(req.url);
    language = u.searchParams.get("language");
    model = u.searchParams.get("model") || model;
  }
  if (!audio || audio.byteLength === 0) return oaiError("no audio provided", 400);

  const spec = STT_MODELS[model] ?? STT_MODELS["whisper-large-v3-turbo"];
  // Call on env.AI directly — extracting `.run` into a variable loses the
  // `this` binding (binding throws "Cannot set properties of undefined
  // (setting '#options')").
  const ai = env.AI as unknown as {
    run: (m: string, i: unknown, o?: unknown) => Promise<unknown>;
  };

  try {
    if (spec.family === "whisper") {
      const data = (await ai.run(spec.cf, {
        audio: toBase64(audio),
        ...(language ? { language } : {}),
      })) as {
        text?: string;
        transcription_info?: { language?: string };
      };
      const text = data?.text ?? "";
      return json({ text, language: data?.transcription_info?.language ?? language ?? undefined });
    }
    // Deepgram (nova-3)
    const res = (await ai.run(spec.cf, {
      audio: { body: new Response(new Uint8Array(audio)).body, contentType: audioType },
      smart_format: true,
      punctuate: true,
      ...(language ? { language } : { detect_language: true }),
    })) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }>; detected_language?: string }> };
      text?: string;
    };
    const ch = res?.results?.channels?.[0];
    return json({ text: ch?.alternatives?.[0]?.transcript ?? res?.text ?? "", language: ch?.detected_language ?? language ?? undefined });
  } catch (err) {
    return oaiError(`stt failed: ${err instanceof Error ? err.message : String(err)}`, 502, "upstream_error");
  }
}

// ---- Image generation (Azure OpenAI gpt-image-2, OpenAI-images-compatible) ----
async function imageGenerations(req: Request, env: Env): Promise<Response> {
  const body = await req.arrayBuffer();
  let res: Response;
  try {
    res = await fetch(env.AZURE_IMAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": env.AZURE_IMAGE_KEY },
      body,
    });
  } catch (err) {
    return oaiError(`azure image fetch failed: ${err instanceof Error ? err.message : String(err)}`, 502, "upstream_error");
  }
  const headers = new Headers(CORS);
  const ct = res.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);
  return new Response(res.body, { status: res.status, headers });
}

async function chatCompletions(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  userId: number | null,
): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return oaiError("request body must be valid JSON", 400);
  }

  const requested = typeof payload.model === "string" ? payload.model : "";
  const spec = BY_ID.get(requested);
  if (!spec) {
    return oaiError(
      `unknown model "${requested}". available: ${MODELS.map((m) => m.id).join(", ")}`,
      404,
      "model_not_found",
    );
  }

  // Hard-block: if metering is active and we know the user, refuse once their
  // credit wallet is at/below the floor.
  const metered = meteringActive(env) && userId != null;
  if (metered) {
    const allowed = await balanceAllowed(userId as number, env);
    if (!allowed) {
      return oaiError(
        "Pods Managed credit wallet is empty. Add credits to continue.",
        402,
        "insufficient_quota",
      );
    }
  }

  // Rewrite the model to the upstream's exact string; forward everything else
  // (messages, temperature, tools, stream, max_tokens, …) untouched.
  const upstreamBody = JSON.stringify({ ...payload, model: spec.upstreamModel });

  const url =
    spec.upstream === "cf"
      ? env.CF_AIG_CHAT_URL
      : spec.upstream === "opencode"
        ? env.OPENCODE_CHAT_URL
        : env.INCEPTION_CHAT_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (spec.upstream === "cf") {
    headers["cf-aig-authorization"] = `Bearer ${env.CF_AIG_TOKEN}`;
  } else if (spec.upstream === "opencode") {
    headers["Authorization"] = `Bearer ${env.OPENCODE_API_KEY}`;
  } else {
    headers["Authorization"] = `Bearer ${env.INCEPTION_API_KEY}`;
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(url, { method: "POST", headers, body: upstreamBody });
    // Workers AI intermittently sheds load (AiError 3040 → HTTP 429) even at
    // low volume — a burst test saw 2/5 requests bounce and immediately
    // succeed on retry. Absorb transient 429/5xx here for NON-streaming
    // requests so pods never surface "⏳ Retrying…" spam to end users for
    // blips that a sub-second retry fixes. Streaming requests are not
    // retried (the client may have consumed partial output).
    if (payload.stream !== true) {
      const RETRYABLE = new Set([429, 500, 502, 503, 529]);
      for (const delayMs of [400, 900]) {
        if (!RETRYABLE.has(upstreamRes.status)) break;
        await new Promise((r) => setTimeout(r, delayMs + Math.random() * 200));
        upstreamRes = await fetch(url, { method: "POST", headers, body: upstreamBody });
      }
    }
  } catch (err) {
    return oaiError(`upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`, 502, "upstream_error");
  }

  const respHeaders = new Headers(CORS);
  const ct = upstreamRes.headers.get("Content-Type");
  if (ct) respHeaders.set("Content-Type", ct);
  const cacheStatus = upstreamRes.headers.get("cf-aig-cache-status");
  if (cacheStatus) respHeaders.set("cf-aig-cache-status", cacheStatus);

  // Non-streaming: BUFFER the body instead of passing the stream through.
  // Returning `upstreamRes.body` unread lets workerd use a raw passthrough
  // that intermittently delivered gzip bytes whose content-encoding header
  // didn't survive — pods saw httpx die with "Error -3 while decompressing
  // data: incorrect header check" (which is what pushed tolo's agent into
  // rewriting its own provider config). Reading .text() forces the runtime
  // to decode fully; the re-serialized response is always consistent.
  if (payload.stream !== true) {
    const bodyText = await upstreamRes.text();
    if (metered && upstreamRes.ok) {
      ctx.waitUntil(
        captureAndReport(
          new Response(bodyText).body!,
          userId as number,
          spec.id,
          env,
        ),
      );
    }
    return new Response(bodyText, {
      status: upstreamRes.status,
      headers: respHeaders,
    });
  }

  // Streaming (SSE): tee when metering — one branch to the pod untouched
  // (token-by-token preserved), the other drained out-of-band for usage.
  if (metered && upstreamRes.body && upstreamRes.ok) {
    const [toClient, toMeter] = upstreamRes.body.tee();
    ctx.waitUntil(captureAndReport(toMeter, userId as number, spec.id, env));
    return new Response(toClient, { status: upstreamRes.status, headers: respHeaders });
  }

  // Stream the upstream body straight back so token-by-token is preserved.
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: respHeaders });
}

/**
 * Transparent reverse proxy for Parallel.ai mounted at /parallel.
 *
 *   <worker>/parallel/v1beta/search   →  https://api.parallel.ai/v1beta/search
 *   <worker>/parallel/v1/tasks/runs   →  https://api.parallel.ai/v1/tasks/runs
 *
 * Everything after /parallel (path + query) is preserved; method and body pass
 * through untouched. We strip the caller's bearer (that's OUR PROXY_API_KEY)
 * and inject Parallel's `x-api-key` so the real key never leaves the worker.
 */
async function proxyParallel(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  const rest = path.slice("/parallel".length) || "/";
  const target = env.PARALLEL_BASE_URL.replace(/\/+$/, "") + rest + url.search;

  const headers = new Headers();
  const ct = request.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);
  const accept = request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);
  headers.set("x-api-key", env.PARALLEL_API_KEY);

  const method = request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let res: Response;
  try {
    res = await fetch(target, { method, headers, body });
  } catch (err) {
    return oaiError(`parallel upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`, 502, "upstream_error");
  }

  const respHeaders = new Headers(CORS);
  const rct = res.headers.get("Content-Type");
  if (rct) respHeaders.set("Content-Type", rct);
  return new Response(res.body, { status: res.status, headers: respHeaders });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Resolve auth/identity once (cheap; HMAC verify only for pmk tokens).
    const auth = await resolveAuth(request, env);

    // Health / info.
    if (path === "/" && request.method === "GET") {
      return json({
        service: "FuelBorn managed-AI gateway",
        openai_base_url: `${url.origin}/v1`,
        models: MODELS.map((m) => m.id),
        speech: { stt: "nova-3 @ /v1/audio/transcriptions", tts: "aura-2-en @ /v1/audio/speech" },
        image: "gpt-image-2 @ /v1/images/generations",
        mounts: { parallel: `${url.origin}/parallel/* → api.parallel.ai/*` },
        auth: env.PROXY_API_KEY ? "bearer required" : "open",
        metering: meteringActive(env),
      });
    }

    // Speech-to-text (STT).
    if ((path === "/v1/audio/transcriptions" || path === "/audio/transcriptions") && request.method === "POST") {
      if (!auth.ok) return oaiError("missing or invalid API key", 401, "authentication_error");
      return audioTranscriptions(request, env);
    }

    // Text-to-speech (TTS).
    if ((path === "/v1/audio/speech" || path === "/audio/speech") && request.method === "POST") {
      if (!auth.ok) return oaiError("missing or invalid API key", 401, "authentication_error");
      return audioSpeech(request, env);
    }

    // Image generation (Azure gpt-image-2).
    if ((path === "/v1/images/generations" || path === "/images/generations") && request.method === "POST") {
      if (!auth.ok) return oaiError("missing or invalid API key", 401, "authentication_error");
      return imageGenerations(request, env);
    }

    // Parallel.ai reverse proxy: /parallel/* → api.parallel.ai/*
    if (path === "/parallel" || path.startsWith("/parallel/")) {
      if (!auth.ok) return oaiError("missing or invalid API key", 401, "authentication_error");
      return proxyParallel(request, env, url, path);
    }

    // Models list (allow with or without /v1).
    if ((path === "/v1/models" || path === "/models") && request.method === "GET") {
      if (!auth.ok) return oaiError("missing or invalid API key", 401, "authentication_error");
      return listModels();
    }

    // Chat completions.
    if ((path === "/v1/chat/completions" || path === "/chat/completions") && request.method === "POST") {
      if (!auth.ok) return oaiError("missing or invalid API key", 401, "authentication_error");
      return chatCompletions(request, env, ctx, auth.userId);
    }

    return oaiError(`no route for ${request.method} ${path}`, 404, "not_found");
  },
} satisfies ExportedHandler<Env>;
