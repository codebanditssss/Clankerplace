// GET /api/pods/<uuid>/dashboard
//
// Aggregator endpoint for the Dashboard tab. Bundles everything we can
// discover about a pod's runtime state in a single request: pod meta +
// gateway/bridge state + active platforms + log tails + counts of
// sessions / skills / cron jobs / connectors / providers / fallbacks /
// auxiliary overrides. Built as one round-trip so the Dashboard panel
// can render the whole shape immediately instead of fan-out spinners.
//
// Everything that requires docker exec is gathered in one big bash -lc
// call so we don't pay docker's ~150 ms cold-start overhead 8 times.
import { NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import {
  dockerExec,
  readEnv,
  readConfigYaml,
} from "@/lib/pod-config";

export const dynamic = "force-dynamic";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

type GatewayState = {
  pid?: number;
  start_time?: number;
  gateway_state?: string;
  active_agents?: number;
  platforms?: Record<
    string,
    { state?: string; error_code?: string | null; error_message?: string | null; updated_at?: string }
  >;
  exit_reason?: string | null;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1) {
    return NextResponse.json({ installing: true });
  }

  // One mega-shell-call gathers everything from the pod in ~1 docker
  // exec. Each section emits a sentinel header so we can split the
  // output back into named blocks below.
  const SCRIPT = `
echo "---PROCS---"
pgrep -af "venv/bin/hermes gateway run" | head -1
pgrep -af "whatsapp-bridge/bridge.js" | head -1
echo "---COUNTS---"
echo "sessions=$(ls /home/container/.hermes/sessions 2>/dev/null | grep -c '\\.json$')"
echo "skills=$(ls /home/container/.hermes/skills 2>/dev/null | wc -l)"
echo "cron=$(ls /home/container/.hermes/cron 2>/dev/null | wc -l)"
echo "memories=$(ls /home/container/.hermes/memories 2>/dev/null | wc -l)"
echo "---GATEWAY_STATE---"
cat /home/container/.hermes/gateway_state.json 2>/dev/null
echo
echo "---CHANNEL_DIR---"
cat /home/container/.hermes/channel_directory.json 2>/dev/null
echo
echo "---GATEWAY_LOG---"
tail -n 50 /home/container/.hermes/logs/gateway.log 2>/dev/null
echo "---AGENT_LOG---"
tail -n 30 /home/container/.hermes/logs/agent.log 2>/dev/null
echo "---ERROR_LOG---"
tail -n 30 /home/container/.hermes/logs/errors.log 2>/dev/null
echo "---END---"
`;

  let raw = "";
  try {
    raw = await dockerExec(srv.uuid, ["bash", "-lc", SCRIPT], 8000);
  } catch (err) {
    // The shell call may fail if the pod was just stopped, etc. Return
    // a partial response — dashboard still renders Pelican-side info.
    raw = "";
    console.warn(
      `[dashboard] ${uuid}: docker exec failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  // Slice the output by sentinel headers.
  const sections: Record<string, string> = {};
  let current: string | null = null;
  for (const line of raw.split("\n")) {
    const m = line.match(/^---([A-Z_]+)---$/);
    if (m) {
      current = m[1];
      sections[current] = "";
      continue;
    }
    if (current && current !== "END") {
      sections[current] = (sections[current] ?? "") + line + "\n";
    }
  }

  const procsTxt = (sections.PROCS ?? "").trim();
  const gatewayRunning = procsTxt.includes("venv/bin/hermes gateway run");
  const bridgeRunning = procsTxt.includes("whatsapp-bridge/bridge.js");

  // counts block — KEY=VAL lines
  const counts: Record<string, number> = {};
  for (const line of (sections.COUNTS ?? "").trim().split("\n")) {
    const m = line.match(/^([a-z_]+)=(\d+)$/);
    if (m) counts[m[1]] = Number(m[2]);
  }

  let gatewayState: GatewayState = {};
  try {
    const txt = (sections.GATEWAY_STATE ?? "").trim();
    if (txt) gatewayState = JSON.parse(txt) as GatewayState;
  } catch {}

  let channelDir: Record<string, Array<{ id: string; name: string }>> = {};
  try {
    const txt = (sections.CHANNEL_DIR ?? "").trim();
    if (txt) {
      const parsed = JSON.parse(txt) as {
        platforms?: Record<string, Array<{ id: string; name: string }>>;
      };
      channelDir = parsed.platforms ?? {};
    }
  } catch {}

  // Also pull env + yaml so we can show provider/fallback/aux counts.
  // These are cheap reads, run after the big script so they parallelise
  // with the inevitable React work above.
  let providerSummary: {
    provider: string;
    model: string;
    fallback_count: number;
    aux_overrides: number;
    memory_provider: string;
    tts_provider: string;
    web_provider: string;
    image_provider: string;
    keys_set: number;
  } = {
    provider: "—",
    model: "—",
    fallback_count: 0,
    aux_overrides: 0,
    memory_provider: "",
    tts_provider: "",
    web_provider: "",
    image_provider: "",
    keys_set: 0,
  };
  try {
    const [env, cfg] = await Promise.all([
      readEnv(srv.uuid),
      readConfigYaml(srv.uuid),
    ]);
    const model = (cfg.model as Record<string, unknown> | undefined) ?? {};
    const aux = (cfg.auxiliary as Record<string, unknown> | undefined) ?? {};
    const tts = (cfg.tts as Record<string, unknown> | undefined) ?? {};
    const web = (cfg.web as Record<string, unknown> | undefined) ?? {};
    const imgGen = (cfg.image_gen as Record<string, unknown> | undefined) ?? {};
    const mem = (cfg.memory as Record<string, unknown> | undefined) ?? {};
    const fbs = Array.isArray(cfg.fallback_providers)
      ? (cfg.fallback_providers as unknown[]).length
      : 0;
    let auxOverrides = 0;
    for (const key of ["vision", "web_extract", "session_search", "compression"]) {
      const sub = aux[key] as Record<string, unknown> | undefined;
      if (sub && typeof sub.provider === "string" && sub.provider !== "auto" && sub.provider !== "main") {
        auxOverrides++;
      }
    }
    // Count non-empty env keys that look like API keys / tokens
    let keysSet = 0;
    for (const [k, v] of Object.entries(env)) {
      if (!v) continue;
      if (k.endsWith("_API_KEY") || k.endsWith("_TOKEN") || k.endsWith("_KEY") || k === "FAL_KEY") {
        keysSet++;
      }
    }
    providerSummary = {
      provider:
        (env.HERMES_INFERENCE_PROVIDER as string) ??
        (typeof model.provider === "string" ? model.provider : "—"),
      model:
        (env.HERMES_INFERENCE_MODEL as string) ??
        (typeof model.default === "string" ? model.default : "—"),
      fallback_count: fbs,
      aux_overrides: auxOverrides,
      memory_provider: typeof mem.provider === "string" ? mem.provider : "",
      tts_provider: typeof tts.provider === "string" ? tts.provider : "",
      web_provider: typeof web.provider === "string" ? web.provider : "",
      image_provider: typeof imgGen.provider === "string" ? imgGen.provider : "",
      keys_set: keysSet,
    };
  } catch {}

  return NextResponse.json({
    installing: false,
    pod: {
      name: srv.name,
      identifier: srv.identifier,
      uuid: srv.uuid,
      image: srv.container.image,
      memory_mb: srv.limits.memory,
      cpu_pct: srv.limits.cpu,
      disk_mb: srv.limits.disk,
      suspended: srv.suspended,
    },
    gateway: {
      running: gatewayRunning,
      bridge_running: bridgeRunning,
      state: gatewayState.gateway_state ?? null,
      pid: gatewayState.pid ?? null,
      active_agents: gatewayState.active_agents ?? 0,
      platforms: gatewayState.platforms ?? {},
      exit_reason: gatewayState.exit_reason ?? null,
    },
    channels: channelDir,
    counts,
    providers: providerSummary,
    logs: {
      gateway: (sections.GATEWAY_LOG ?? "").trimEnd(),
      agent: (sections.AGENT_LOG ?? "").trimEnd(),
      errors: (sections.ERROR_LOG ?? "").trimEnd(),
    },
  });
}
