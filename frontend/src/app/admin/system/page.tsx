// /admin/system — node capacity, allocations, and a roll-up of which
// containers are running where. Read-only — no toggles in v1.

import { applicationApi } from "@/lib/pelican";
import { Badge, StatusDot } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NodeAttrs = {
  id: number;
  name: string;
  fqdn: string;
  scheme: string;
  memory: number;
  disk: number;
  cpu: number;
  memory_overallocate: number;
  disk_overallocate: number;
  cpu_overallocate: number;
  maintenance_mode: boolean;
  allocated_resources: { memory: number; disk: number; cpu: number };
};

type AllocAttrs = { id: number; assigned: boolean };

export default async function SystemPage() {
  let nodes: NodeAttrs[] = [];
  try {
    const r = await applicationApi<{
      data: { attributes: NodeAttrs }[];
    }>(`/nodes?per_page=50`);
    nodes = r.data.map((n) => n.attributes);
  } catch (err) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-[20px] font-semibold tracking-tight">System</h1>
        </header>
        <div className="border border-[color:var(--acc-red)]/40 bg-[color:var(--acc-red-soft)] px-5 py-4 text-[13px] tracking-tight text-[color:var(--acc-red)]">
          Pelican unreachable: {err instanceof Error ? err.message : String(err)}
        </div>
      </div>
    );
  }

  const allocs = await Promise.all(
    nodes.map(async (n) => {
      try {
        const r = await applicationApi<{
          data: { attributes: AllocAttrs }[];
        }>(`/nodes/${n.id}/allocations?per_page=400`);
        const total = r.data.length;
        const free = r.data.filter((a) => !a.attributes.assigned).length;
        return { node: n.id, total, free };
      } catch {
        return { node: n.id, total: 0, free: 0 };
      }
    }),
  );
  const allocMap = new Map(allocs.map((a) => [a.node, a]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight">System</h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-tertiary)]">
          Live Wings + Pelican capacity.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {nodes.map((n) => {
          const memUsedPct = Math.min(
            100,
            Math.round((n.allocated_resources.memory / n.memory) * 100),
          );
          const a = allocMap.get(n.id);
          return (
            <div
              key={n.id}
              className="border border-[color:var(--border)] bg-[color:var(--bg-2)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border-subtle)] px-5 py-3">
                <div className="flex items-center gap-2">
                  <StatusDot
                    tone={n.maintenance_mode ? "amber" : "green"}
                  />
                  <h2 className="text-[14px] font-semibold tracking-tight">
                    Node {n.id} — {n.name}
                  </h2>
                </div>
                {n.maintenance_mode && (
                  <Badge tone="amber">maintenance</Badge>
                )}
              </div>
              <div className="space-y-3 px-5 py-4">
                <KV label="FQDN" value={n.fqdn} mono />
                <KV label="Scheme" value={n.scheme} />
                <Bar
                  label="Memory"
                  used={n.allocated_resources.memory}
                  total={n.memory}
                  unit="MB"
                  warnPct={80}
                />
                <Bar
                  label="Disk"
                  used={n.allocated_resources.disk}
                  total={n.disk}
                  unit="MB"
                />
                <Bar
                  label="CPU (oversubscribable)"
                  used={n.allocated_resources.cpu}
                  total={n.cpu}
                  unit="%"
                />
                <KV
                  label="Allocations"
                  value={
                    a
                      ? `${a.total - a.free} used / ${a.free} free / ${a.total} total`
                      : "—"
                  }
                />
                <KV
                  label="Overcommit policy"
                  value={`mem ${n.memory_overallocate}× · disk ${n.disk_overallocate}× · cpu ${n.cpu_overallocate}×`}
                />
                {memUsedPct >= 100 && !n.maintenance_mode && (
                  <div className="rounded-sm border border-[color:var(--acc-amber)]/30 bg-[color:var(--acc-amber-soft)] px-3 py-2 text-[11px] tracking-tight text-[color:var(--acc-amber)]">
                    Memory at {memUsedPct}% (limit-allocated). Consider
                    enabling overcommit or routing new pods elsewhere.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold tracking-tight">
          Routing
        </h2>
        <div className="border border-[color:var(--border)] bg-[color:var(--bg-2)] px-5 py-4">
          <div className="grid grid-cols-1 gap-2 text-[12px] tracking-tight md:grid-cols-2">
            <KV
              label="Active node pool (PELICAN_NODE_IDS)"
              value={process.env.PELICAN_NODE_IDS ?? "1"}
              mono
            />
            <KV
              label="Tailnet IP map (PELICAN_NODE_TAILSCALE_IPS)"
              value={process.env.PELICAN_NODE_TAILSCALE_IPS ?? "(not set)"}
              mono
            />
            <KV
              label="Domain root (PODS_DOMAIN_ROOT)"
              value={process.env.PODS_DOMAIN_ROOT ?? "bigcat.pw"}
              mono
            />
            <KV
              label="OAuth base (OAUTH_BASE_URL)"
              value={process.env.OAUTH_BASE_URL ?? "(default)"}
              mono
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px] tracking-tight">
      <span className="text-[color:var(--text-tertiary)]">{label}</span>
      <span
        className={
          mono
            ? "font-mono text-[11px] text-[color:var(--text-primary)]"
            : "text-[color:var(--text-primary)]"
        }
      >
        {value}
      </span>
    </div>
  );
}

function Bar({
  label,
  used,
  total,
  unit,
  warnPct,
}: {
  label: string;
  used: number;
  total: number;
  unit: string;
  warnPct?: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const isWarn = warnPct != null && pct >= warnPct;
  const isFull = pct >= 100;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
        <span>{label}</span>
        <span
          className={
            isFull
              ? "text-[color:var(--acc-red)]"
              : isWarn
                ? "text-[color:var(--acc-amber)]"
                : ""
          }
        >
          {used.toLocaleString()} / {total.toLocaleString()} {unit} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--bg-4)]">
        <div
          className={
            isFull
              ? "h-full bg-[color:var(--acc-red)]"
              : isWarn
                ? "h-full bg-[color:var(--acc-amber)]"
                : "h-full bg-[color:var(--acc-green)]"
          }
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
