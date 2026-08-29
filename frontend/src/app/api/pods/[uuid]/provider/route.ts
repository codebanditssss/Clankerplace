// POST /api/pods/<uuid>/provider — switch the active inference provider.
//
// Body: { provider: slug, fields: { [env]: value }, model?: string }
//
// Effects:
//   - Patches ~/.hermes/.env with HERMES_INFERENCE_PROVIDER + the
//     provider's declared field env vars.
//   - For provider=custom, ALSO writes model.base_url + model.provider to
//     config.yaml — Hermes resolves the custom endpoint from config.yaml,
//     not just the OPENAI_BASE_URL env (the env is only a fallback when
//     the YAML doesn't say otherwise). Same for model.default if supplied.
//   - Ensures auxiliary.compression.provider has a usable default ("main")
//     so context compression doesn't drop turns with a warning when the
//     user picks a custom endpoint and has no OpenRouter key.
//   - Restarts the gateway via pod-gateway so the new config takes effect
//     IMMEDIATELY (without this the running gateway keeps the stale
//     provider in memory until somebody bounces it manually).
//
// This route uses patchConfigYaml so it MERGES into the existing YAML
// rather than overwriting — earlier versions of this file did a full
// rewrite of config.yaml that clobbered whatsapp / stt / tts / etc.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { describePodExecError } from "@/lib/node-exec";
import { PROVIDER_BY_SLUG } from "@/lib/providers";
import {
  writeEnv,
  patchConfigYaml,
  restartGateway,
} from "@/lib/pod-config";
import {
  installSanitizer,
  SANITIZER_PROXY_BASE,
  stopSanitizer,
} from "@/lib/sanitizer";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1) {
    return NextResponse.json({ error: "pod still installing" }, { status: 409 });
  }

  let body: { provider?: string; fields?: Record<string, string>; model?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const slug = (body.provider ?? "").trim();
  const provider = PROVIDER_BY_SLUG[slug];
  if (!provider) {
    return NextResponse.json({ error: `unknown provider: ${slug}` }, { status: 400 });
  }
  if (provider.mode !== "key") {
    return NextResponse.json(
      {
        error: `provider ${provider.label} requires terminal setup — open the Console tab and run \`hermes setup\``,
      },
      { status: 400 },
    );
  }

  const fields = body.fields ?? {};
  const missing = (provider.fields ?? [])
    .filter((f) => !f.advanced)
    .filter((f) => !(fields[f.env]?.trim()))
    .map((f) => f.env);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `missing required fields: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  const envUpdates: Record<string, string | null> = {
    HERMES_INFERENCE_PROVIDER: provider.slug,
  };
  for (const f of provider.fields ?? []) {
    const v = fields[f.env]?.trim() ?? "";
    envUpdates[f.env] = v.length > 0 ? v : null;
  }

  // For custom endpoints, capture base_url + api_key from the form so we
  // can also mirror them into model.base_url / model.api_key in
  // config.yaml. Hermes reads YAML-side values first; without these, the
  // gateway falls back to whatever provider was previously configured.
  const customBaseUrl =
    provider.slug === "custom" ? fields["OPENAI_BASE_URL"]?.trim() : undefined;
  const customApiKey =
    provider.slug === "custom" ? fields["OPENAI_API_KEY"]?.trim() : undefined;
  const customApiMode =
    provider.slug === "custom"
      ? (fields["HERMES_API_MODE"]?.trim() || "openai")
      : undefined;

  // For Anthropic-mode custom endpoints, Hermes' transport reads
  // ANTHROPIC_API_KEY at process start; alias it. That mode already
  // sanitizes empty content natively so no proxy needed.
  //
  // For OpenAI-mode custom endpoints, we set up the localhost
  // sanitizer proxy at 127.0.0.1:8765 and point Hermes there — the
  // proxy pads empty content blocks that would otherwise 400 the
  // Claude-relay providers.
  if (customApiMode === "anthropic" && customApiKey) {
    envUpdates["ANTHROPIC_API_KEY"] = customApiKey;
    if (customBaseUrl) {
      envUpdates["ANTHROPIC_BASE_URL"] = customBaseUrl.replace(/\/v1\/?$/, "");
    }
  } else if (provider.slug === "custom") {
    // chat_completions path or non-custom — clear the alias.
    envUpdates["ANTHROPIC_API_KEY"] = null;
    envUpdates["ANTHROPIC_BASE_URL"] = null;
  }

  try {
    // For OpenAI-mode custom: install + start the sanitizer proxy,
    // then point Hermes at it. Do this BEFORE writeEnv so the user
    // never has a window where Hermes restart sees a half-applied
    // config.
    if (
      provider.slug === "custom" &&
      customApiMode !== "anthropic" &&
      customBaseUrl
    ) {
      try {
        await installSanitizer(srv.uuid, customBaseUrl);
      } catch (err) {
        const info = describePodExecError(err);
        if (info.code !== "exec_failed") {
          return NextResponse.json(
            { error: info.message, code: info.code },
            { status: info.status },
          );
        }
        return NextResponse.json(
          {
            error: `failed to start in-pod sanitizer: ${info.raw}`,
          },
          { status: 502 },
        );
      }
    } else {
      // Mode is anthropic or we're leaving custom — tear down any
      // running sanitizer.
      try {
        await stopSanitizer(srv.uuid);
      } catch {
        /* best-effort */
      }
    }

    await writeEnv(srv.uuid, envUpdates);

    await patchConfigYaml(srv.uuid, (cfg) => {
      // ---- model.{default,provider,base_url,api_mode} ----
      const model = ((cfg.model as Record<string, unknown>) ?? {}) as Record<
        string,
        unknown
      >;
      if (body.model && body.model.trim()) {
        model.default = body.model.trim();
      }
      model.provider = provider.slug;
      if (provider.slug === "custom") {
        if (customApiMode === "anthropic") {
          // Direct to upstream — anthropic transport sanitizes natively.
          if (customBaseUrl) {
            model.base_url = customBaseUrl;
          }
          model.api_mode = "anthropic_messages";
        } else {
          // Route through localhost sanitizer proxy. Append /v1 so
          // Hermes' chat_completions URL builder constructs
          // http://127.0.0.1:8765/v1/chat/completions.
          model.base_url = `${SANITIZER_PROXY_BASE}/v1`;
          model.api_mode = "chat_completions";
        }
      } else {
        // Switching away from custom — clear the saved base_url + api_mode.
        delete model.base_url;
        delete model.api_mode;
      }
      cfg.model = model;

      // ---- auxiliary.compression default ----
      // Hermes warns at startup if context compression has no auxiliary
      // model AND no OpenRouter / Nous credentials. Forcing the
      // compression auxiliary to "main" makes it reuse the user's chosen
      // inference provider — guaranteed to work whenever the main model
      // works. The user can still override per-task in the Providers tab.
      const aux = ((cfg.auxiliary as Record<string, unknown>) ?? {}) as Record<
        string,
        unknown
      >;
      const compression = ((aux.compression as Record<string, unknown>) ??
        {}) as Record<string, unknown>;
      if (typeof compression.provider !== "string" || compression.provider === "auto") {
        compression.provider = "main";
      }
      aux.compression = compression;
      cfg.auxiliary = aux;
    });

    await restartGateway(srv.uuid);
  } catch (err) {
    const info = describePodExecError(err);
    return NextResponse.json(
      { error: info.message, code: info.code },
      { status: info.status },
    );
  }

  // Keep Pelican's stored container environment in sync with the live config.
  // The pod page header, the Settings-tab cards and the pods list are all
  // server-rendered from `container.environment` (HERMES_INFERENCE_PROVIDER /
  // _MODEL) — NOT from the live config.yaml. Without this sync those displays
  // stay stale after a provider switch until... never (they read Pelican env,
  // which the filesystem writes above never touch). Best-effort: the pod's
  // actual provider is already applied + gateway restarted above, so a Pelican
  // hiccup here only delays the SSR displays, it doesn't lose the change.
  try {
    const newEnv: Record<string, string> = { ...srv.container.environment };
    newEnv.HERMES_INFERENCE_PROVIDER = provider.slug;
    if (body.model && body.model.trim()) {
      newEnv.HERMES_INFERENCE_MODEL = body.model.trim();
    }
    await applicationApi(`/servers/${srv.id}/startup`, {
      method: "PATCH",
      body: {
        startup: srv.container.startup_command,
        environment: newEnv,
        egg: srv.egg,
        image: srv.container.image,
        skip_scripts: true,
      },
    });
  } catch (err) {
    console.warn(
      `[provider] Pelican env sync failed for ${srv.identifier} — SSR displays may lag until the env is re-synced:`,
      err instanceof Error ? err.message : err,
    );
  }

  return NextResponse.json({
    ok: true,
    provider: provider.slug,
    model: body.model?.trim() || undefined,
  });
}
