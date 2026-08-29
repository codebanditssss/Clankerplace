import { NextRequest, NextResponse } from "next/server";
import { PROVIDER_BY_SLUG } from "@/lib/providers";

type Model = { id: string; name?: string };

async function fetchModels(
  provider: string,
  apiKey?: string,
): Promise<Model[]> {
  const p = PROVIDER_BY_SLUG[provider];
  if (!p) throw new Error(`unknown provider: ${provider}`);
  const ep = p.modelsEndpoint;
  if (!ep) throw new Error("provider does not expose a model list endpoint");

  const headers: Record<string, string> = {};
  if (ep.auth === "bearer") {
    if (!apiKey) throw new Error("apiKey required");
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (ep.auth === "x-api-key") {
    if (!apiKey) throw new Error("apiKey required");
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }

  const res = await fetch(ep.url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`${provider} ${res.status}`);
  const data = (await res.json()) as {
    data?: Array<{ id: string; name?: string; display_name?: string }>;
    models?: Array<{ id: string; name?: string; display_name?: string }>;
  };
  const arr = data.data ?? data.models ?? [];
  return arr.map((m) => ({
    id: m.id,
    name: m.name ?? m.display_name,
  }));
}

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") ?? "";
  try {
    const models = await fetchModels(provider);
    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") ?? "";
  let body: { apiKey?: string };
  try {
    body = (await req.json()) as { apiKey?: string };
  } catch {
    body = {};
  }
  try {
    const models = await fetchModels(provider, body.apiKey);
    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
