import { redirect } from "next/navigation";
import Link from "next/link";
import { Boxes, Cpu, HardDrive, MemoryStick } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listMyPods, type PodSummary } from "@/lib/pods";
import { EmptyState } from "@/components/ui/empty";
import { BrandIcon, providerBrand } from "@/components/brand-icon";
import HomeNewPodTrigger from "../_components/HomeNewPodTrigger";
import DomainPill from "../_components/DomainPill";
import db, { type PodDomainRow } from "@/lib/db";
import { fullDomain } from "@/lib/domains";

export default async function PodsListPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const pods = await listMyPods(user.pelicanUserId);

  const myDomains = db
    .prepare<[number], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE user_id = ? ORDER BY (kind = 'auto') DESC, created_at ASC",
    )
    .all(user.id);
  const primaryDomainByPod = new Map<string, PodDomainRow>();
  for (const d of myDomains) {
    if (!primaryDomainByPod.has(d.pod_uuid_short))
      primaryDomainByPod.set(d.pod_uuid_short, d);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-8">
        <div>
          <span className="micro text-neutral-500">Workspace · Pods</span>
          <h1 className="display mt-3 text-[clamp(2rem,4vw,3rem)] leading-[0.95]">
            Pods<span className="text-signal">.</span>
          </h1>
          <p className="mt-3 font-mono text-[12px] text-neutral-400 tabular">
            {pods.length.toString().padStart(2, "0")} {pods.length === 1 ? "pod" : "pods"} provisioned
          </p>
        </div>
        <HomeNewPodTrigger />
      </header>

      <div className="pt-10">
        {pods.length === 0 ? (
          <EmptyState
            icon={<Boxes className="h-7 w-7" />}
            title="No pods yet"
            description="Spin up a Hermes Agent sandbox in 30 seconds."
            action={<HomeNewPodTrigger />}
          />
        ) : (
          <div className="grid gap-px border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3">
            {pods.map((p, i) => (
              <PodCard
                key={p.id}
                index={i + 1}
                pod={p}
                domain={primaryDomainByPod.get(p.identifier)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PodCard({
  pod,
  domain,
  index,
}: {
  pod: PodSummary;
  domain?: PodDomainRow;
  index: number;
}) {
  return (
    <div className="group relative h-full bg-neutral-900 p-5 transition-colors hover:bg-neutral-800/60">
      <Link
        href={`/pods/${pod.identifier}`}
        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60"
        aria-label={`Open ${pod.name}`}
      />
      <div className="pointer-events-none relative z-0">
        {/* Top row: index + status */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tabular text-neutral-600">
            {index.toString().padStart(2, "0")}
          </span>
          <PodStatusTag installed={pod.installed} status={pod.status} />
        </div>

        {/* Identity */}
        <div className="mt-5 flex items-start gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center border border-hairline bg-neutral-950">
            <BrandIcon slug={providerBrand(pod.provider)} size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
              {pod.name}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">
              {pod.identifier}
            </div>
          </div>
        </div>

        <div className="mt-3 truncate font-mono text-[11px] text-neutral-400">
          {pod.model}
        </div>

        {domain && (
          <div className="pointer-events-auto relative z-20 mt-3">
            <DomainPill
              host={fullDomain(domain.slug)}
              url={`https://${fullDomain(domain.slug)}`}
              variant="card"
            />
          </div>
        )}

        {/* Resource strip */}
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-hairline pt-3 font-mono text-[11px] tabular text-neutral-400">
          <Stat icon={<MemoryStick className="h-3 w-3" />} v={`${(pod.memory / 1024).toFixed(1)}G`} />
          <Stat icon={<Cpu className="h-3 w-3" />} v={`${pod.cpu}%`} />
          <Stat icon={<HardDrive className="h-3 w-3" />} v={`${(pod.disk / 1024).toFixed(1)}G`} />
        </div>
      </div>
    </div>
  );
}

function PodStatusTag({
  installed,
  status,
}: {
  installed: boolean;
  status: string | null;
}) {
  if (!installed) {
    return (
      <span className="inline-flex items-center gap-1.5 border border-deploying/30 bg-deploying/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-deploying">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-deploying animate-pulse" />
        deploying
      </span>
    );
  }
  if (status && status !== "running") {
    return (
      <span className="inline-flex items-center gap-1.5 border border-hairline bg-neutral-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-neutral-600" />
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 border border-live/30 bg-live/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-live">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-live" />
      live
    </span>
  );
}

function Stat({ icon, v }: { icon: React.ReactNode; v: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-neutral-600">{icon}</span>
      <span>{v}</span>
    </span>
  );
}
