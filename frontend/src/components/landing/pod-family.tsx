import Link from "next/link";
import { SectionHeader } from "./how-it-works";

/**
 * Pod family. Catalog spec sheet. Each row carries port, memory, CPU,
 * protocol so this reads like a real reference, not marketing fluff.
 *
 * All four pods render as dense rows by default. Hovering or focusing a
 * row expands it into the featured-tile layout (signal-orange swatch
 * plus dark detail panel) used throughout the brand system.
 */

type Pod = {
  slug: string;
  label: string;
  blurb: string;
  kind: string;
  port: string;
  protocol: string;
  mem: string;
  cpu: string;
  disk: string;
  detail: string;
};

const PODS: Pod[] = [
  {
    slug: "hermes",
    label: "Hermes Agent",
    blurb:
      "Always-on AI agent with persistent memory, skills, MCP servers, and over 30 messaging connectors. The flagship pod, the reason this exists.",
    kind: "agent",
    port: "8080",
    protocol: "https",
    mem: "4 GB",
    cpu: "2 vCPU",
    disk: "20 GB",
    detail:
      "Skills, MCP servers, connectors for WhatsApp, Discord, Slack, and Telegram. OAuth handoff, streaming terminal, and a managed mailbox per pod.",
  },
  {
    slug: "code-sandbox",
    label: "Code Sandbox",
    blurb:
      "Ubuntu pod with VS Code in the browser, Claude Code CLI, or a plain shell. Persistent home directory, sudo, and a public URL.",
    kind: "sandbox",
    port: "8080",
    protocol: "https",
    mem: "4 GB",
    cpu: "1 vCPU",
    disk: "20 GB",
    detail:
      "Persistent home directory, sudo access, and a public HTTPS URL out of the box. Bring your own toolchain or pick a preinstalled flavor.",
  },
  {
    slug: "n8n",
    label: "n8n",
    blurb:
      "Visual workflow automation with drag-and-drop nodes, 400 plus integrations, and queue mode. Public webhook URL out of the box.",
    kind: "automation",
    port: "5678",
    protocol: "https",
    mem: "2 GB",
    cpu: "1 vCPU",
    disk: "8 GB",
    detail:
      "Queue mode, 400 plus integrations, and a public webhook URL out of the box. Editor protected by basic auth.",
  },
  {
    slug: "minecraft-paper",
    label: "Minecraft (Paper)",
    blurb:
      "High-performance Bukkit and Spigot compatible server. Latest stable Paper build, console plus file access plus plugin folder.",
    kind: "game",
    port: "25565",
    protocol: "tcp",
    mem: "4 GB",
    cpu: "2 vCPU",
    disk: "10 GB",
    detail:
      "Console plus file access plus plugin folder. Latest stable Paper build, server.properties editor, and version pinning.",
  },
];

export function PodFamily() {
  return (
    <section id="pods" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHeader
          eyebrow="the pod family"
          title={
            <>
              Four pods today.{" "}
              <span className="editorial-italic text-neutral-300">
                More coming.
              </span>
            </>
          }
          counter={`${PODS.length} templates`}
        />

        <ol className="mt-12 border border-hairline bg-neutral-900">
          {PODS.map((p, i) => (
            <PodRow key={p.slug} pod={p} index={i} />
          ))}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Dense pod row, collapsed by default, expands on hover or focus            */
/* -------------------------------------------------------------------------- */

function PodRow({
  pod,
  index,
}: {
  pod: Pod;
  index: number;
}) {
  return (
    <li
      className={`group/row relative transition-colors hover:bg-neutral-800 focus-within:bg-neutral-800 ${
        index > 0 ? "border-t border-hairline" : ""
      }`}
    >
      {/* Collapsed row, always visible */}
      <div className="grid grid-cols-1 items-center gap-6 p-6 lg:grid-cols-12">
        {/* Index + status */}
        <div className="flex items-center gap-4 lg:col-span-1">
          <span className="tabular display text-3xl leading-none text-neutral-700 transition-colors group-hover/row:text-signal group-focus-within/row:text-signal">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="size-1.5 rounded-full bg-live" aria-hidden />
        </div>

        {/* Title + blurb, grows to fill width when row expands */}
        <div className="min-w-0 lg:col-span-5 lg:group-hover/row:col-span-11 lg:group-focus-within/row:col-span-11 transition-[grid-column] duration-300">
          <div className="flex items-baseline gap-3">
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {pod.label}
            </h3>
            <span className="micro">{pod.kind}</span>
          </div>
          <p className="mt-1.5 text-[14px] leading-6 text-neutral-200">
            {pod.blurb}
          </p>
        </div>

        {/* Quick spec, hidden entirely when row expands */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 lg:col-span-4 group-hover/row:hidden group-focus-within/row:hidden">
          <SpecKV k="port"   v={pod.port} mono />
          <SpecKV k="memory" v={pod.mem} />
          <SpecKV k="proto"  v={pod.protocol} />
          <SpecKV k="cpu"    v={pod.cpu} />
        </dl>

        {/* CTA, hidden when expanded */}
        <div className="flex justify-start lg:col-span-2 lg:justify-end group-hover/row:hidden group-focus-within/row:hidden">
          <Link
            href={`/deploy?type=${pod.slug}`}
            className="group/cta inline-flex items-center gap-2 border border-foreground px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            Deploy
            <span
              aria-hidden
              className="transition-transform group-hover/cta:translate-x-0.5"
            >
              →
            </span>
          </Link>
        </div>
      </div>

      {/* Expandable detail. Signal-orange swatch on the left plus dark detail panel on the right. */}
      <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out group-hover/row:grid-rows-[1fr] group-focus-within/row:grid-rows-[1fr]">
        <div className="overflow-hidden">
          <div className="border-t border-hairline">
            <div className="grid grid-cols-1 lg:grid-cols-12">
              {/* Left swatch */}
              <div className="relative overflow-hidden bg-signal p-8 text-neutral-950 lg:col-span-4">
                <div aria-hidden className="hatch absolute inset-0 opacity-50" />
                <div className="relative flex h-full min-h-[200px] flex-col justify-between gap-8">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[11px] uppercase tracking-widest opacity-80">
                      {pod.kind}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 bg-neutral-950/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest">
                      <span className="size-1.5 rounded-full bg-neutral-950" />
                      live
                    </span>
                  </div>
                  <h4 className="display text-[clamp(1.875rem,3vw,2.5rem)] leading-none">
                    {pod.label}
                  </h4>
                  <code className="truncate font-mono text-xs opacity-90">
                    $ pods deploy {pod.slug}
                  </code>
                </div>
              </div>

              {/* Right detail panel */}
              <div className="lg:col-span-8">
                <div className="flex h-full flex-col gap-6 p-8">
                  <p className="max-w-2xl text-[15px] leading-7 text-neutral-200">
                    {pod.blurb}
                  </p>

                  <dl className="grid grid-cols-1 gap-x-8 gap-y-3 border-y border-hairline py-5 sm:grid-cols-3 lg:grid-cols-5">
                    <SpecKV k="port"   v={pod.port}     mono />
                    <SpecKV k="proto"  v={pod.protocol} />
                    <SpecKV k="memory" v={pod.mem} />
                    <SpecKV k="cpu"    v={pod.cpu} />
                    <SpecKV k="disk"   v={pod.disk} />
                  </dl>

                  <div className="mt-auto flex flex-col items-start gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <p className="max-w-2xl text-sm text-neutral-300">
                      {pod.detail}
                    </p>
                    <Link
                      href={`/deploy?type=${pod.slug}`}
                      className="group/cta inline-flex shrink-0 items-center gap-2 border border-foreground px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-foreground hover:text-background"
                    >
                      Deploy {pod.label}
                      <span
                        aria-hidden
                        className="transition-transform group-hover/cta:translate-x-0.5"
                      >
                        →
                      </span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function SpecKV({
  k,
  v,
  mono,
}: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-neutral-300">
        {k}
      </dt>
      <dd
        className={`tabular truncate text-[13px] font-medium text-neutral-50 ${
          mono ? "font-mono" : ""
        }`}
      >
        {v}
      </dd>
    </div>
  );
}
