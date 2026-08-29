// Strip trailing slash so `${PANEL_URL}/api/application${path}` never
// double-slashes (Pelican's Laravel router 404s on `//api/...`).
const PANEL_URL = (process.env.PELICAN_URL ?? "").replace(/\/+$/, "");
const API_KEY = process.env.PELICAN_API_KEY ?? "";

if (!PANEL_URL || !API_KEY) {
  // logged once per cold start — not thrown so dev mode still runs
  console.warn("[pelican] PELICAN_URL or PELICAN_API_KEY is not set");
}

type ApplicationFetchOpts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

export class PelicanApiError extends Error {
  status: number;
  path: string;
  body: string;
  constructor(status: number, path: string, body: string) {
    super(`Pelican API ${status} ${path}: ${body.slice(0, 400)}`);
    this.name = "PelicanApiError";
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export async function applicationApi<T = unknown>(
  path: string,
  opts: ApplicationFetchOpts = {},
): Promise<T> {
  const res = await fetch(`${PANEL_URL}/api/application${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new PelicanApiError(res.status, path, text);
  }
  // Pelican's DELETE endpoints return 204 No Content (empty body); the
  // mount-attach POST returns 204 too. Calling .json() on an empty body
  // throws "Unexpected end of JSON input". Detect empty responses and
  // return undefined-as-T so callers that don't read the value don't
  // crash. Callers that DO expect a body get a real parse for non-empty
  // payloads.
  if (res.status === 204) return undefined as unknown as T;
  const text = await res.text();
  if (text.length === 0) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

type PelicanUserListResp = {
  object: "list";
  data: { object: "user"; attributes: { id: number; email: string } }[];
};

export async function findPelicanUserByEmail(
  email: string,
): Promise<number | null> {
  const resp = await applicationApi<PelicanUserListResp>(
    `/users?filter[email]=${encodeURIComponent(email)}`,
  );
  const want = email.toLowerCase();
  const match = resp.data.find((u) => u.attributes.email.toLowerCase() === want);
  return match?.attributes.id ?? null;
}

export type ServerAttributes = {
  id: number;
  uuid: string;
  identifier: string;
  name: string;
  status: string | null;
  suspended: boolean;
  limits: { memory: number; disk: number; cpu: number };
  feature_limits: { databases: number; allocations: number; backups: number };
  user: number;
  node: number;
  allocation: number;
  egg: number;
  container: {
    startup_command: string;
    image: string;
    installed: number;
    environment: Record<string, string>;
  };
};
