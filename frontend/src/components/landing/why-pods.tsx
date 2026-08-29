import { SectionHeader } from "./how-it-works";

/**
 * Why pods. Editorial layout. Giant italic pull quote on the left, three
 * numbered statements on the right. The section sits on a slightly
 * elevated dark surface so it reads as a chapter break.
 */

const POINTS = [
  {
    n: "01",
    title: "Self-hosted from byte one.",
    body: "The whole platform runs inside your own Azure, Hetzner, or bare-metal box. We never see your traffic, your prompts, or your model keys.",
  },
  {
    n: "02",
    title: "No middleman cloud.",
    body: "Pod data lives on your disk. No managed database, no telemetry pipe, no third-party inference relay sitting between you and the model.",
  },
  {
    n: "03",
    title: "One box, many pods.",
    body: "A single 4-vCPU box runs an agent, an automation server, a code IDE, and a game server side by side. Pay your cloud bill, not ours. Resources are hard-capped per pod, not by us.",
  },
];

export function WhyPods() {
  return (
    <section
      id="self-hosting"
      className="border-b border-hairline bg-neutral-900"
    >
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHeader
          eyebrow="self-hosting"
          title={
            <>
              The data is yours.{" "}
              <span className="editorial-italic text-neutral-300">
                The runtime is yours.
              </span>{" "}
              The bill is yours.
            </>
          }
          counter="3 reasons"
        />

        <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          {/* Pull quote */}
          <figure className="flex flex-col gap-8 lg:col-span-5">
            <blockquote className="editorial-italic text-[clamp(1.625rem,2.75vw,2.5rem)] leading-[1.1] text-foreground">
              &ldquo;If your agent platform can read your prompts, it&rsquo;s
              not your agent platform.&rdquo;
            </blockquote>
            <figcaption className="flex items-center gap-3">
              <span className="size-2 shrink-0 bg-signal" aria-hidden />
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">
                  The clankerplace thesis
                </span>
                <span className="micro mt-1">north star, always</span>
              </div>
            </figcaption>

            <hr className="hairline" />

            {/* Tiny stack diagram, user-facing only */}
            <ul className="flex flex-col gap-0 font-mono text-[12px]">
              {[
                ["your runtime", "persistent + verifiable"],
                ["edge",        "automatic tls, per-pod subdomain"],
                ["dashboard",   "auth, deploy, live console"],
                ["your pod",    "isolated runtime, your data"],
                ["the model",   "your provider, your key"],
              ].map(([k, v]) => (
                <li
                  key={k}
                  className="flex items-baseline gap-3 border-b border-hairline py-2"
                >
                  <span className="w-28 shrink-0 uppercase tracking-widest text-neutral-300">
                    {k}
                  </span>
                  <span className="min-w-0 truncate text-neutral-50">{v}</span>
                </li>
              ))}
            </ul>
          </figure>

          {/* Reasons */}
          <ol className="flex flex-col gap-px overflow-hidden border border-hairline bg-hairline lg:col-span-7">
            {POINTS.map((p) => (
              <li
                key={p.n}
                className="flex flex-col gap-3 bg-neutral-800 p-8"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="tabular display text-5xl leading-none text-neutral-50">
                    {p.n}
                  </span>
                  <span className="micro">principle</span>
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-foreground">
                  {p.title}
                </h3>
                <p className="max-w-2xl text-[15px] leading-7 text-neutral-200">
                  {p.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
