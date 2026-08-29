import { redirect } from "next/navigation";
import Link from "next/link";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { BrandIcon, providerBrand } from "@/components/brand-icon";
import PodShell from "./PodShell";
import PodActions from "./PodActions";
import { podTypeFromEggId } from "@/lib/pod-types";
import { podProviderFromEnv } from "@/lib/pods";

type RawServer = { object: string; attributes: ServerAttributes };

async function getServer(identifier: string) {
  try {
    const data = await applicationApi<{ data: RawServer[] }>(
      `/servers?filter[uuid_short]=${encodeURIComponent(identifier)}`,
    );
    return data.data?.[0]?.attributes ?? null;
  } catch {
    return null;
  }
}

export default async function PodPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const server = await getServer(uuid);

  if (!server || server.user !== user.pelicanUserId) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <span className="micro text-neutral-500">404 · Not found</span>
        <h1 className="display mt-3 text-[clamp(2rem,4vw,3rem)] leading-[0.95]">
          Pod not found<span className="text-signal">.</span>
        </h1>
        <p className="mt-4 text-[13px] text-neutral-400">
          We couldn&apos;t find a pod of yours with id{" "}
          <code className="border border-hairline bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {uuid}
          </code>
          .
        </p>
        <Link
          href="/pods"
          className="mt-6 inline-block font-mono text-[12px] text-signal underline-offset-4 hover:underline"
        >
          ← back to pods
        </Link>
      </div>
    );
  }

  const installing = server.container.installed !== 1;
  const env = server.container.environment;
  const providerSlug = podProviderFromEnv(env);
  const modelId =
    (env.HERMES_INFERENCE_MODEL as string | undefined) ??
    (env.LLM_MODEL as string | undefined) ??
    "—";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-500">
            <Link href="/pods" className="hover:text-foreground">
              ~/pods
            </Link>
            <span className="text-neutral-700">/</span>
            <span className="text-foreground">{server.identifier}</span>
          </div>
          <h1 className="display mt-3 truncate text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[0.95]">
            {server.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] tabular text-neutral-400">
            <span className="inline-flex items-center gap-1.5">
              <BrandIcon slug={providerBrand(providerSlug)} size={12} />
              <span>{providerSlug}</span>
            </span>
            <span className="text-neutral-700">/</span>
            <span>{modelId}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {installing ? (
            <span className="inline-flex items-center gap-1.5 border border-deploying/30 bg-deploying/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-deploying">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-deploying animate-pulse" />
              deploying
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 border border-live/30 bg-live/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-live">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-live" />
              running
            </span>
          )}
          <PodActions identifier={server.identifier} podName={server.name} />
        </div>
      </header>

      <PodShell
        identifier={server.identifier}
        initiallyInstalled={!installing}
        podName={server.name}
        podTypeSlug={podTypeFromEggId(server.egg).slug}
        meta={{
          provider: providerSlug,
          model: modelId,
          memory: server.limits.memory,
          cpu: server.limits.cpu,
          disk: server.limits.disk,
        }}
      />
    </div>
  );
}
