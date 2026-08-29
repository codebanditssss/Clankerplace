import { NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { execInPod } from "@/lib/node-exec";
import { CONNECTORS } from "@/lib/connectors";
import { whatsappPaired } from "@/lib/pod-config";

type ConnectorStatus = {
  id: string;
  configured: boolean;
  running: boolean;
};

async function getServerForUser(uuidShort: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuidShort)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

async function dockerExec(uuid: string, cmd: string[]): Promise<string> {
  // node-exec routes to the pod's actual Wings node over the tailnet.
  const { stdout } = await execInPod(uuid, ["exec", uuid, ...cmd], {
    timeoutMs: 8000,
    maxBuffer: 1024 * 256,
  });
  return stdout;
}

async function readEnvFile(uuid: string): Promise<Record<string, string>> {
  try {
    const text = await dockerExec(uuid, [
      "bash",
      "-lc",
      "cat /home/container/.hermes/.env 2>/dev/null || true",
    ]);
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      out[t.slice(0, eq)] = t.slice(eq + 1);
    }
    return out;
  } catch {
    return {};
  }
}

async function isGatewayRunning(uuid: string): Promise<boolean> {
  try {
    const out = await dockerExec(uuid, [
      "bash",
      "-lc",
      "pgrep -af 'venv/bin/hermes gateway run' | head -1 || true",
    ]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServerForUser(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1) {
    return NextResponse.json({
      connectors: [],
      gatewayRunning: false,
      note: "pod still installing",
    });
  }

  const [env, gatewayRunning, waPaired] = await Promise.all([
    readEnvFile(srv.uuid),
    isGatewayRunning(srv.uuid),
    whatsappPaired(srv.uuid),
  ]);
  const connectors: ConnectorStatus[] = CONNECTORS.filter(
    (c) => c.kind === "token" || c.kind === "oauth",
  ).map((c) => {
    // WhatsApp doesn't gate on an env var — it stores its Baileys session on
    // disk. Check the actual session directory instead so the "paired" badge
    // is accurate.
    const configured = c.slug === "whatsapp" ? waPaired : !!env[c.primaryEnv];
    return {
      id: c.slug,
      configured,
      running: gatewayRunning && configured,
    };
  });
  return NextResponse.json({ connectors, gatewayRunning });
}
