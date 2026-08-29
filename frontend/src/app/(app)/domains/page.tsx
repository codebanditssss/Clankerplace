import { redirect } from "next/navigation";
import Link from "next/link";
import { Globe } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { EmptyState } from "@/components/ui/empty";
import db, { type PodDomainRow } from "@/lib/db";
import { DOMAIN_ROOT, fullDomain } from "@/lib/domains";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import DomainsList from "./DomainsList";

async function listOwnedPods(
  pelicanUserId: number,
): Promise<Record<string, { name: string; identifier: string }>> {
  try {
    const data = await applicationApi<{
      data: Array<{ attributes: ServerAttributes }>;
    }>(`/servers?filter[user]=${pelicanUserId}&per_page=200`);
    const out: Record<string, { name: string; identifier: string }> = {};
    for (const s of data.data ?? []) {
      out[s.attributes.identifier] = {
        name: s.attributes.name,
        identifier: s.attributes.identifier,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export default async function DomainsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const domains = db
    .prepare<[number], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(user.id);
  const pods = await listOwnedPods(user.pelicanUserId);

  const rows = domains.map((d) => ({
    ...d,
    url: `https://${fullDomain(d.slug)}`,
    pod_name: pods[d.pod_uuid_short]?.name ?? d.pod_uuid_short,
  }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-hairline pb-8">
        <span className="micro text-neutral-500">Workspace · Domains</span>
        <h1 className="display mt-3 text-[clamp(2rem,4vw,3rem)] leading-[0.95]">
          Domains<span className="text-signal">.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-neutral-400">
          Public subdomains under{" "}
          <code className="border border-hairline bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            *.{DOMAIN_ROOT}
          </code>{" "}
          mapped to ports inside your pods. TLS auto-issued, request-isolated
          per origin, no host-port binding required.
        </p>
        <div className="mt-4 font-mono text-[12px] tabular text-neutral-500">
          {rows.length.toString().padStart(2, "0")}{" "}
          {rows.length === 1 ? "domain" : "domains"} configured
        </div>
      </header>

      <div className="pt-10">
        {rows.length === 0 ? (
          <div className="border border-hairline bg-neutral-900">
            <EmptyState
              icon={<Globe className="h-5 w-5 text-neutral-400" />}
              title="No domains yet"
              description="Every new pod gets one auto-assigned domain. Head to a pod's Domains tab to add more (pick any port your container listens on)."
              action={
                <Link
                  href="/pods"
                  className="text-signal underline-offset-4 hover:underline"
                >
                  View pods →
                </Link>
              }
            />
          </div>
        ) : (
          <DomainsList rows={rows} />
        )}
      </div>
    </div>
  );
}
