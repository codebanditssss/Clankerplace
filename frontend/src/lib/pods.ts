import "server-only";
import { applicationApi } from "./pelican";
import { MANAGED_SLUG, managedGatewayV1 } from "./managed-ai";
import { podTypeFromEggId } from "./pod-types";

export type PodSummary = {
  id: number;
  identifier: string;
  uuid: string;
  name: string;
  status: string | null;
  installed: boolean;
  memory: number;
  cpu: number;
  disk: number;
  podTypeSlug: string;
  provider: string;
  model: string;
  createdAt: string;
};

const DEFAULT_MANAGED_GATEWAY_V1 =
  "https://pods-managed-ai.nighthost-team.workers.dev/v1";

function normalizeUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export function podProviderFromEnv(env: Record<string, string>): string {
  const rawProvider =
    env.HERMES_INFERENCE_PROVIDER ??
    env.LLM_PROVIDER ??
    "—";
  const baseUrl = normalizeUrl(
    env.PODS_KEY_OPENAI_BASE_URL ??
      env.OPENAI_BASE_URL ??
      env.HERMES_OPENAI_BASE_URL,
  );
  const managedGatewayUrls = new Set(
    [managedGatewayV1(), DEFAULT_MANAGED_GATEWAY_V1].map(normalizeUrl),
  );

  if (rawProvider === "custom" && managedGatewayUrls.has(baseUrl)) {
    return MANAGED_SLUG;
  }

  return rawProvider;
}

export async function listMyPods(
  pelicanUserId: number | null | undefined,
): Promise<PodSummary[]> {
  if (!pelicanUserId) return [];
  try {
    const data = await applicationApi<{
      data: Array<{
        attributes: {
          id: number;
          identifier: string;
          uuid: string;
          name: string;
          status: string | null;
          user: number;
          created_at: string;
          limits: { memory: number; cpu: number; disk: number };
          egg: number;
          container: {
            installed: number;
            environment: Record<string, string>;
          };
        };
      }>;
    }>(`/servers?per_page=200`);
    return data.data
      .filter((s) => s.attributes.user === pelicanUserId)
      .map((s) => ({
        id: s.attributes.id,
        identifier: s.attributes.identifier,
        uuid: s.attributes.uuid,
        name: s.attributes.name,
        status: s.attributes.status,
        installed: s.attributes.container.installed === 1,
        memory: s.attributes.limits.memory,
        cpu: s.attributes.limits.cpu,
        disk: s.attributes.limits.disk,
        podTypeSlug: podTypeFromEggId(s.attributes.egg).slug,
        provider: podProviderFromEnv(s.attributes.container.environment),
        model:
          s.attributes.container.environment.HERMES_INFERENCE_MODEL ??
          s.attributes.container.environment.LLM_MODEL ??
          "—",
        createdAt: s.attributes.created_at,
      }));
  } catch {
    return [];
  }
}
