// GET / POST /api/pods/<uuid>/whatsapp
//
// Reads & writes everything the WhatsApp connector card lets a user tweak:
//
//   .env keys (Hermes Agent docs)
//     WHATSAPP_ENABLED          true|false (default false)
//     WHATSAPP_MODE             bot|self-chat
//     WHATSAPP_ALLOWED_USERS    comma-separated phone numbers, or "*"
//     WHATSAPP_ALLOW_ALL_USERS  true|false (equivalent to ALLOWED_USERS=*)
//     WHATSAPP_DEBUG            true|false — turns on raw bridge.log events
//
//   config.yaml keys
//     whatsapp.unauthorized_dm_behavior  pair|ignore
//                                        (global key with same name is the
//                                        fallback for every platform)
//     whatsapp.reply_prefix              string — custom header on outgoing
//                                        messages. NEVER written as "": the
//                                        prefix doubles as the bridge's
//                                        self-chat echo-filter marker, so an
//                                        empty value causes reply loops.
//                                        Empty/null → key deleted → hermes
//                                        built-in default prefix.
//
// POST always restarts the gateway through `pod-gateway restart`. That's
// non-blocking and the supervisor respawns hermes within ~5s with the new
// env, so the user sees the new behavior immediately on the next message.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import {
  readEnv,
  writeEnv,
  readConfigYaml,
  patchConfigYaml,
  restartGateway,
  whatsappPaired,
} from "@/lib/pod-config";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export type WhatsAppSettings = {
  paired: boolean;
  enabled: boolean;
  mode: "bot" | "self-chat";
  allowAll: boolean;
  allowedUsers: string[];
  debug: boolean;
  unauthorizedDmBehavior: "pair" | "ignore";
  replyPrefix: string | null; // null = use Hermes default; "" = no header
};

function parseAllowedUsers(raw: string | undefined) {
  if (!raw) return [] as string[];
  if (raw.trim() === "*") return ["*"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export async function GET(
  _req: Request,
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

  try {
    const [env, cfg, paired] = await Promise.all([
      readEnv(srv.uuid),
      readConfigYaml(srv.uuid),
      whatsappPaired(srv.uuid),
    ]);

    const whatsappCfg = ((cfg.whatsapp as Record<string, unknown>) ?? {}) as {
      unauthorized_dm_behavior?: string;
      reply_prefix?: string;
    };
    const globalDmBehavior =
      typeof cfg.unauthorized_dm_behavior === "string"
        ? (cfg.unauthorized_dm_behavior as string)
        : undefined;

    const rawAllowed = parseAllowedUsers(env.WHATSAPP_ALLOWED_USERS);
    const allowAll =
      rawAllowed.includes("*") || parseBool(env.WHATSAPP_ALLOW_ALL_USERS);

    const settings: WhatsAppSettings = {
      paired,
      enabled: parseBool(env.WHATSAPP_ENABLED),
      // Hermes itself defaults to "self-chat" when WHATSAPP_MODE is unset
      // (see hermes-agent/gateway/platforms/whatsapp.py L576). Mirror that
      // so the UI never lies about what the gateway is actually doing.
      mode: env.WHATSAPP_MODE === "bot" ? "bot" : "self-chat",
      allowAll,
      allowedUsers: allowAll ? [] : rawAllowed,
      debug: parseBool(env.WHATSAPP_DEBUG),
      // FuelBorn policy: default to "ignore" so brand-new pods don't blast a
      // pairing-code reply at every stranger who happens to DM the paired
      // WhatsApp number. Hermes itself defaults to "pair" — we explicitly
      // override that. Users who want the public-bot behavior can switch
      // via the UI radio.
      unauthorizedDmBehavior:
        whatsappCfg.unauthorized_dm_behavior === "pair"
          ? "pair"
          : whatsappCfg.unauthorized_dm_behavior === "ignore"
            ? "ignore"
            : globalDmBehavior === "pair"
              ? "pair"
              : "ignore",
      replyPrefix:
        typeof whatsappCfg.reply_prefix === "string"
          ? whatsappCfg.reply_prefix
          : null,
    };
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
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

  let body: Partial<WhatsAppSettings>;
  try {
    body = (await req.json()) as Partial<WhatsAppSettings>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // ---- env-side updates ----
  const envUpdates: Record<string, string | null> = {};
  if (typeof body.enabled === "boolean") {
    envUpdates.WHATSAPP_ENABLED = body.enabled ? "true" : "false";
  }
  if (body.mode === "bot" || body.mode === "self-chat") {
    envUpdates.WHATSAPP_MODE = body.mode;
  }
  if (typeof body.debug === "boolean") {
    envUpdates.WHATSAPP_DEBUG = body.debug ? "true" : null;
  }
  if (typeof body.allowAll === "boolean" || Array.isArray(body.allowedUsers)) {
    if (body.allowAll) {
      envUpdates.WHATSAPP_ALLOWED_USERS = "*";
      // ALLOW_ALL_USERS is the equivalent flag — clear it so we don't have
      // two sources of truth.
      envUpdates.WHATSAPP_ALLOW_ALL_USERS = null;
    } else {
      const cleaned = (body.allowedUsers ?? [])
        .map((s) => String(s).trim())
        .filter((s) => s && s !== "*");
      // Phone numbers are E.164 minus the +. Strip anything else.
      for (const n of cleaned) {
        if (!/^\d{6,18}$/.test(n)) {
          return NextResponse.json(
            {
              error: `invalid phone number "${n}" — use full international format without + or spaces, e.g. 15551234567`,
            },
            { status: 400 },
          );
        }
      }
      envUpdates.WHATSAPP_ALLOWED_USERS =
        cleaned.length > 0 ? cleaned.join(",") : null;
      envUpdates.WHATSAPP_ALLOW_ALL_USERS = null;
    }
  }

  // ---- config.yaml side updates ----
  const yamlChanges: {
    unauthorizedDmBehavior?: "pair" | "ignore";
    replyPrefix?: string | null;
  } = {};
  if (
    body.unauthorizedDmBehavior === "pair" ||
    body.unauthorizedDmBehavior === "ignore"
  ) {
    yamlChanges.unauthorizedDmBehavior = body.unauthorizedDmBehavior;
  }
  if (body.replyPrefix === null || typeof body.replyPrefix === "string") {
    // An EMPTY prefix is never allowed through: in self-chat mode the ⚕
    // reply prefix is the bridge's echo-filter marker (bridge.js skips
    // fromMe messages that start with it). Writing reply_prefix: '' made
    // the adapter export WHATSAPP_REPLY_PREFIX="" which disarmed the
    // filter entirely — the agent's own status messages came back as
    // inbound user messages and fed an interrupt/self-reply loop (this is
    // what wrecked the tolo pod). Empty → delete the key so hermes falls
    // back to its built-in default prefix.
    yamlChanges.replyPrefix =
      typeof body.replyPrefix === "string" && body.replyPrefix.trim() === ""
        ? null
        : body.replyPrefix;
  }

  try {
    if (Object.keys(envUpdates).length > 0) {
      await writeEnv(srv.uuid, envUpdates);
    }
    // Always ensure config.yaml has a `whatsapp.unauthorized_dm_behavior`
    // key — even if the POST body didn't touch it. Hermes's own default
    // is "pair" (replies with a pairing code to every stranger DMing the
    // paired number), which is the wrong default for a personal pod. We
    // seed "ignore" on first save so the runtime matches what the UI
    // shows new users.
    await patchConfigYaml(srv.uuid, (cfg) => {
      const wa = ((cfg.whatsapp as Record<string, unknown>) ?? {}) as Record<
        string,
        unknown
      >;
      if (yamlChanges.unauthorizedDmBehavior !== undefined) {
        wa.unauthorized_dm_behavior = yamlChanges.unauthorizedDmBehavior;
      } else if (typeof wa.unauthorized_dm_behavior !== "string") {
        wa.unauthorized_dm_behavior = "ignore";
      }
      if (yamlChanges.replyPrefix !== undefined) {
        if (yamlChanges.replyPrefix === null) delete wa.reply_prefix;
        else wa.reply_prefix = yamlChanges.replyPrefix;
      } else if (
        typeof wa.reply_prefix === "string" &&
        wa.reply_prefix.trim() === ""
      ) {
        // Self-heal pods that already have the echo-filter-disarming empty
        // prefix on disk (see comment where yamlChanges.replyPrefix is set).
        delete wa.reply_prefix;
      }
      cfg.whatsapp = wa;
    });
    await restartGateway(srv.uuid);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
