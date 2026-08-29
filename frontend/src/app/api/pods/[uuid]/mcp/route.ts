// GET    /api/pods/<uuid>/mcp        — list installed MCP servers in the pod
// POST   /api/pods/<uuid>/mcp        — install one (body: { id, fields })
// DELETE /api/pods/<uuid>/mcp?id=…   — uninstall by id
//
// Persists into the pod's ~/.hermes/config.yaml under the `mcp_servers`
// map, then restarts the gateway. YAML read/parse/serialize happens in
// Node via lib/pod-config (the `yaml` npm lib) — we deliberately do NOT
// shell python3 + PyYAML inside the pod, because the pod's *system*
// python3 has no `yaml` module (PyYAML lives in Hermes' venv), which
// made every MCP install fail with `ModuleNotFoundError: No module
// named 'yaml'`.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import {
  readConfigYaml,
  patchConfigYaml,
  restartGateway,
} from "@/lib/pod-config";
import { MCP_BY_ID, substituteTemplate } from "@/lib/mcp-catalog";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

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
  try {
    const cfg = await readConfigYaml(srv.uuid);
    const mcp = (cfg.mcp_servers as Record<string, unknown>) ?? {};
    const installed = Object.entries(mcp).map(([id, conf]) => ({
      id,
      // Only return the structure, never the secrets — those stay in
      // the pod's config.yaml.
      kind: (conf as { url?: string }).url ? "remote" : "stdio",
    }));
    return NextResponse.json({ installed });
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
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1) {
    return NextResponse.json({ error: "pod still installing" }, { status: 409 });
  }

  let body: {
    id?: string;
    fields?: Record<string, string>;
    custom?: {
      id?: string;
      kind?: "stdio" | "remote";
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
      transport?: string;
      timeout?: number;
      auth?: string;
    };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Coerce an arbitrary map to a clean Record<string,string> (drops blanks).
  const strMap = (m: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (m && typeof m === "object") {
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        const key = String(k).trim();
        if (key && v != null && String(v).length > 0) out[key] = String(v);
      }
    }
    return out;
  };

  let installId: string;
  let inst: Record<string, unknown>;

  if (body.custom) {
    // ---- user-defined custom MCP server ----
    const c = body.custom;
    const id = (c.id ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(id)) {
      return NextResponse.json(
        { error: "id must be lowercase letters, digits, - or _ (max 41 chars)" },
        { status: 400 },
      );
    }
    inst = {};
    if (c.kind === "remote") {
      const url = (c.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) {
        return NextResponse.json(
          { error: "remote MCP needs an http(s) URL" },
          { status: 400 },
        );
      }
      inst.url = url;
      const headers = strMap(c.headers);
      if (Object.keys(headers).length) inst.headers = headers;
      inst.transport =
        c.transport === "sse" || c.transport === "streamable_http"
          ? c.transport
          : "streamable_http";
      if (typeof c.timeout === "number" && c.timeout > 0) inst.timeout = c.timeout;
      // OAuth 2.1 (PKCE): Hermes runs metadata discovery + dynamic client
      // registration + token exchange/refresh. The user completes the browser
      // authorization step inside the pod on first connect.
      if (c.auth === "oauth") inst.auth = "oauth";
    } else {
      const command = (c.command ?? "").trim();
      if (!command) {
        return NextResponse.json(
          { error: "stdio MCP needs a command (e.g. npx, uvx, node)" },
          { status: 400 },
        );
      }
      inst.command = command;
      const args = Array.isArray(c.args)
        ? c.args.map((a) => String(a)).filter((a) => a.length > 0)
        : [];
      if (args.length) inst.args = args;
      const env = strMap(c.env);
      if (Object.keys(env).length) inst.env = env;
      inst.transport = "stdio";
    }
    installId = id;
  } else {
    // ---- catalog server ----
    const spec = body.id ? MCP_BY_ID[body.id] : null;
    if (!spec) {
      return NextResponse.json({ error: "unknown mcp server id" }, { status: 400 });
    }
    const fields = body.fields ?? {};
    const missing = (spec.fields ?? [])
      .filter((f) => !f.optional)
      .filter((f) => !(fields[f.env]?.trim()))
      .map((f) => f.env);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `missing required fields: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    // Substitute the field placeholders into the install template.
    inst = {};
    if (spec.config.command) inst.command = spec.config.command;
    if (spec.config.args)
      inst.args = spec.config.args.map((a) => substituteTemplate(a, fields));
    if (spec.config.env) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(spec.config.env)) {
        env[k] = substituteTemplate(v, fields);
      }
      inst.env = env;
    }
    if (spec.config.url) inst.url = substituteTemplate(spec.config.url, fields);
    if (spec.config.headers) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(spec.config.headers)) {
        headers[k] = substituteTemplate(v, fields);
      }
      inst.headers = headers;
    }
    if (spec.config.transport) inst.transport = spec.config.transport;
    if (spec.config.timeout) inst.timeout = spec.config.timeout;
    installId = spec.id;
  }

  try {
    await patchConfigYaml(srv.uuid, (cfg) => {
      const mcp = (cfg.mcp_servers as Record<string, unknown>) ?? {};
      mcp[installId] = inst;
      cfg.mcp_servers = mcp;
    });
    await restartGateway(srv.uuid);
    return NextResponse.json({ ok: true, id: installId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const cfg = await readConfigYaml(srv.uuid);
    const mcp = (cfg.mcp_servers as Record<string, unknown>) ?? {};
    if (!(id in mcp)) return NextResponse.json({ ok: true });
    await patchConfigYaml(srv.uuid, (draft) => {
      const m = (draft.mcp_servers as Record<string, unknown>) ?? {};
      delete m[id];
      draft.mcp_servers = m;
    });
    await restartGateway(srv.uuid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
