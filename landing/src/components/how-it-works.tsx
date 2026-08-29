/**
 * "How it works" — three steps presented as a technical spec sheet.
 * Each step has a giant tabular numeral (Manrope 800), a definition
 * row, and a tiny terminal-style command preview. The third (final)
 * step picks up the signal-orange to mark the payoff.
 *
 * Dark-mode notes:
 *   - cards sit on neutral-900 (elevated) so the 1px gap reads as a hairline
 *   - non-payoff numerals are neutral-700 (deep gray, ghost-presence)
 *   - the inline terminal uses neutral-800 — distinct from card neutral-900
 */

const STEPS = [
  {
    n: "01",
    label: "Pick a template",
    body: "Hermes agent, code-sandbox, n8n, Minecraft. Each one is a vetted pod — egg, image, resources, ports, post-deploy surface, all defined ahead of time.",
    spec: [
      ["templates", "4"],
      ["families",  "agent · automation · sandbox · game"],
      ["form",      "rendered per template"],
    ],
    cmd: "pods list",
  },
  {
    n: "02",
    label: "Hit deploy",
    body: "Pelican + Wings provision the container, allocate a port on 0.0.0.0, and run the install script. The deploy hub streams live progress back to your browser.",
    spec: [
      ["orchestrator", "pelican panel"],
      ["runtime",      "wings + docker"],
      ["proxy",        "caddy · let's encrypt"],
    ],
    cmd: "pods deploy hermes --auto-domain",
  },
  {
    n: "03",
    label: "Ship the URL",
    body: "Under thirty seconds you have a public HTTPS endpoint. Open the in-app terminal, watch real-time CPU/RAM, attach connectors, swap providers — all without leaving the dashboard.",
    spec: [
      ["latency",   "p50 ≈ 27s"],
      ["surface",   "https · tcp"],
      ["terminal",  "websocket → docker exec"],
    ],
    cmd: "open your FuelBorn agent",
    payoff: true,
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHeader
          eyebrow="how it works"
          title={
            <>
              From template to{" "}
              <span className="editorial-italic text-neutral-300">
                public URL
              </span>{" "}
              in three steps.
            </>
          }
          counter="3 steps"
        />

        <ol className="mt-12 grid grid-cols-1 gap-px overflow-hidden border border-hairline bg-hairline md:grid-cols-3">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="flex flex-col gap-6 bg-neutral-900 p-8"
            >
              <div className="flex items-start justify-between gap-4">
                <span
                  className={`tabular display text-7xl leading-none ${
                    s.payoff ? "text-signal" : "text-neutral-700"
                  }`}
                >
                  {s.n}
                </span>
                <span className="micro mt-3 text-right">{s.label}</span>
              </div>

              <p className="text-[15px] leading-7 text-neutral-200">
                {s.body}
              </p>

              <dl className="flex flex-col gap-2 border-t border-hairline pt-4">
                {s.spec.map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-baseline justify-between gap-4 text-[12px]"
                  >
                    <dt className="font-mono uppercase tracking-widest text-neutral-300">
                      {k}
                    </dt>
                    <dd className="tabular text-right font-medium text-neutral-50">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-auto flex min-w-0 items-center gap-2 bg-neutral-800 px-3 py-2 font-mono text-[12px] text-neutral-50">
                <span className="text-signal">$</span>
                <span className="truncate">{s.cmd}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* Shared section header — used across the page. */
export function SectionHeader({
  eyebrow,
  title,
  counter,
}: {
  eyebrow: string;
  title: React.ReactNode;
  counter?: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <span className="size-2 shrink-0 bg-signal" aria-hidden />
        <span className="micro shrink-0">{eyebrow}</span>
        <span className="h-px flex-1 bg-hairline" />
        {counter && <span className="micro shrink-0">{counter}</span>}
      </div>
      <h2 className="display max-w-4xl text-[clamp(1.875rem,4.5vw,3.5rem)] text-foreground">
        {title}
      </h2>
    </div>
  );
}
