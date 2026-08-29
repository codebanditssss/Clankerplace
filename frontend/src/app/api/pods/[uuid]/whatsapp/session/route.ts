// DELETE /api/pods/<uuid>/whatsapp/session — full factory reset for WhatsApp.
//
// "Reset session" in the UI must leave NO trace of the previous WhatsApp
// pairing — credentials, cached identity, env config, runtime state. The
// previous version only wiped `whatsapp/session/` directories, which left:
//
//   - channel_directory.json — has the paired contact identity
//     (e.g. "DisplayName. → 139247252168906@lid") cached even after the
//     Baileys session is gone. Hermes uses this to skip re-discovery and
//     recognize the user instantly on re-pair, which makes "fresh start"
//     feel non-fresh.
//   - gateway_state.json — caches per-platform state across restarts.
//   - bridge.log — keeps the old chat ids / decrypt-error spew visible
//     in `pod-gateway logs`, confusing post-reset debugging.
//   - .env WHATSAPP_* keys + config.yaml whatsapp section — these are
//     settings, not credentials, but a user clicking "Reset" expects them
//     gone too (and reset = re-pair which lets them re-pick mode anyway).
//
// Order matters: we kill the running bridge FIRST so it can't recreate
// files mid-wipe, then delete state, then `pod-gateway restart` so the
// supervisor spins up a clean bridge + gateway against an empty .env.
import { NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import {
  dockerExec,
  writeEnv,
  patchConfigYaml,
  restartGateway,
} from "@/lib/pod-config";

const WHATSAPP_ENV_KEYS = [
  "WHATSAPP_ENABLED",
  "WHATSAPP_MODE",
  "WHATSAPP_ALLOWED_USERS",
  "WHATSAPP_ALLOW_ALL_USERS",
  "WHATSAPP_DEBUG",
  "WHATSAPP_REPLY_PREFIX",
  "WHATSAPP_REQUIRE_MENTION",
];

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export async function DELETE(
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
    // Step 1: stop the Node bridge process AND the python gateway so they
    // can't recreate session / channel_directory entries while we're
    // deleting them. pod-gateway already knows how to kill both.
    await dockerExec(
      srv.uuid,
      [
        "bash",
        "-lc",
        // Touch the supervisor-disabled file before killing so the
        // supervisor doesn't immediately respawn while we're deleting.
        // We rm -f it again in step 4 (via restartGateway → pod-gateway
        // restart which does `rm -f $DISABLED` itself).
        "touch /home/container/.hermes/.supervisor-disabled; " +
          "pod-gateway stop || true",
      ],
      12000,
    );

    // Step 2: wipe everything WhatsApp-y on disk. Both legacy and new
    // layouts. The channel_directory.json + gateway_state.json edits use
    // `python3 -c` (heredocs and our `; ` joiner don't mix); python ships
    // in every sandbox image and we already depend on it for hermes.
    const pyClearChannelDir = `
import json, pathlib
p = pathlib.Path('/home/container/.hermes/channel_directory.json')
if p.exists():
    try:
        d = json.loads(p.read_text())
        if isinstance(d.get('platforms'), dict):
            d['platforms']['whatsapp'] = []
        p.write_text(json.dumps(d, indent=2))
    except Exception:
        pass
`.trim();
    const pyClearGatewayState = `
import json, pathlib
p = pathlib.Path('/home/container/.hermes/gateway_state.json')
if p.exists():
    try:
        d = json.loads(p.read_text())
        if isinstance(d.get('platforms'), dict):
            d['platforms'].pop('whatsapp', None)
        p.write_text(json.dumps(d))
    except Exception:
        pass
`.trim();
    // Pass scripts as argv[1] to python3 -c. Single-quote and escape any
    // embedded single-quotes for safe bash inlining.
    const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    await dockerExec(
      srv.uuid,
      [
        "bash",
        "-lc",
        [
          "rm -rf /home/container/.hermes/whatsapp",
          "rm -rf /home/container/.hermes/platforms/whatsapp",
          "rm -rf /home/container/.hermes/whatsapp-session",
          `python3 -c ${sh(pyClearChannelDir)} 2>/dev/null || true`,
          `python3 -c ${sh(pyClearGatewayState)} 2>/dev/null || true`,
          "true",
        ].join("; "),
      ],
      15000,
    );

    // Step 3: clear all WhatsApp-related settings from .env and
    // config.yaml.whatsapp so the user gets a true blank slate. They'll
    // re-pick mode + allowed users when they re-pair.
    const envClear: Record<string, null> = {};
    for (const k of WHATSAPP_ENV_KEYS) envClear[k] = null;
    await writeEnv(srv.uuid, envClear);
    await patchConfigYaml(srv.uuid, (cfg) => {
      delete cfg.whatsapp;
    });

    // Step 4: lift the supervisor pause and trigger a clean restart. The
    // bridge will come back up with no session → next `hermes whatsapp`
    // will show a fresh QR; until then, paired=false in the UI.
    await restartGateway(srv.uuid);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
