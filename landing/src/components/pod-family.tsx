import Link from "next/link";
import { SectionHeader } from "./how-it-works";

/**
 * Pod family — catalog spec sheet. Each row carries port, memory, CPU,
 * protocol so this reads like a real reference, not marketing fluff.
 * Data is verbatim from `frontend/src/lib/pod-types.ts`.
 *
 * All four pods render as dense rows by default. Hovering or focusing a
 * row expands it into the featured-tile layout (signal-orange swatch +
 * dark detail panel) used throughout the brand system.
 */

type Pod = {
  slug: string;
  label: string;
  blurb: string;
  kind: string;
  image: string;
  port: string;
  protocol: string;
  mem: string;
  cpu: string;
  disk: string;
};

const PODS: Pod[] = [
  {
    slug: "hermes",
    label: "Hermes Agent",
    blurb:
      "Always-on AI agent with persistent memory, skills, MCP servers, and 30+ messaging connectors. The flagship pod, the reason this exists.",
    kind: "agent",
    image: "pods-ml/sandbox-ubuntu:1.0",
    port: "0.0.0.0:8080",
    protocol: "https",
    mem: "4096 MiB",
    cpu: "100%",
    disk: "15 GB",
  },
  {
    slug: "code-sandbox",
    label: "Code Sandbox",
    blurb:
      "Ubuntu pod with VS Code in-browser, Claude Code CLI, or plain shell. Persistent /home/container, sudo, public URL.",
    kind: "sandbox",
    image: "pods-ml/sandbox-ubuntu:1.0",
    port: "0.0.0.0:8080",
    protocol: "https",
    mem: "4096 MiB",
    cpu: "100%",
    disk: "20 GB",
  },
  {
    slug: "n8n",
    label: "n8n",
    blurb:
      "Visual workflow automation — drag-and-drop nodes, 400+ integrations, queue mode. Public webhook URL out of the box.",
    kind: "automation",
    image: "pelican-eggs/yolks:nodejs_22",
    port: "0.0.0.0:5678",
    protocol: "https",
    mem: "2048 MiB",
    cpu: "100%",
    disk: "8 GB",
  },
  {
    slug: "minecraft-paper",
    label: "Minecraft (Paper)",
    blurb:
      "High-performance Bukkit/Spigot-compatible server. Latest stable Paper build, console + SFTP + plugin folder access.",
    kind: "game",
    image: "pterodactyl/yolks:java_21",
    port: "0.0.0.0:25565",
    protocol: "tcp",
    mem: "4096 MiB",
    cpu: "100%",
    disk: "10 GB",
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
/*  Dense pod row — collapsed by default, expands on hover/focus              */
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
      {/* Collapsed row — always visible */}
      <div className="grid grid-cols-1 items-center gap-6 p-6 lg:grid-cols-12">
        {/* Index + status */}
        <div className="flex items-center gap-4 lg:col-span-1">
          <span className="tabular display text-3xl leading-none text-neutral-700 transition-colors group-hover/row:text-signal group-focus-within/row:text-signal">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="size-1.5 rounded-full bg-live" aria-hidden />
        </div>

        {/* Title + blurb — grows to fill width when row expands */}
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

        {/* Quick spec — hidden entirely when row expands (no reserved space) */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 lg:col-span-4 group-hover/row:hidden group-focus-within/row:hidden">
          <SpecKV k="port"   v={pod.port} mono />
          <SpecKV k="memory" v={pod.mem} />
          <SpecKV k="proto"  v={pod.protocol} />
          <SpecKV k="cpu"    v={pod.cpu} />
        </dl>

        {/* CTA — hidden when expanded (expanded panel has its own CTA) */}
        <div className="flex justify-start lg:col-span-2 lg:justify-end group-hover/row:hidden group-focus-within/row:hidden">
          <Link
            href={`http://localhost:3000/deploy?type=${pod.slug}`}
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

      {/* Expandable detail — mirrors the Hermes featured tile layout:
          signal-orange swatch on the left + dark detail panel on the right.
          Uses grid-rows-[0fr→1fr] for a pure-CSS smooth height transition. */}
      <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out group-hover/row:grid-rows-[1fr] group-focus-within/row:grid-rows-[1fr]">
        <div className="overflow-hidden">
          <div className="border-t border-hairline">
            <div className="grid grid-cols-1 lg:grid-cols-12">
              {/* Left swatch — same signal-orange + hatch as Hermes */}
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
                    <SpecKV k="image"  v={pod.image}    mono />
                    <SpecKV k="port"   v={pod.port}     mono />
                    <SpecKV k="proto"  v={pod.protocol} />
                    <SpecKV k="memory" v={pod.mem} />
                    <SpecKV k="cpu"    v={pod.cpu} />
                  </dl>

                  <div className="mt-auto flex flex-col items-start gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <p className="max-w-2xl text-sm text-neutral-300">
                      {pod.kind === "agent" &&
                        "Skills, MCP servers, connectors for WhatsApp/Discord/Slack/Telegram, OAuth handoff, streaming terminal."}
                      {pod.kind === "sandbox" &&
                        "Persistent /home/container, sudo access, public HTTPS URL out of the box."}
                      {pod.kind === "automation" &&
                        "Queue mode, 400+ integrations, webhook URL out of the box."}
                      {pod.kind === "game" &&
                        "Console + SFTP + plugin folder access. Latest stable Paper build."}
                    </p>
                    <Link
                      href={`http://localhost:3000/deploy?type=${pod.slug}`}
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
