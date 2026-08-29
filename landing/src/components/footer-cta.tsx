import Link from "next/link";

/**
 * Footer CTA + masthead-style site footer.
 *
 * The CTA is an inverted slab — bone foreground on dark canvas — so it
 * lands like a final printed page. Signal-orange picks up "Ready." as
 * the payoff. Below sits a print-style colophon on the canvas.
 */
export function FooterCta() {
  return (
    <>
      {/* The slab — only inverted (light-on-light) block in the design. */}
      <section className="relative overflow-hidden border-t border-b border-hairline bg-foreground text-background">
        <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-12 px-6 py-24 lg:grid-cols-12 lg:py-32">
          <div className="lg:col-span-8">
            <div className="flex items-center gap-3">
              <span className="size-2 shrink-0 bg-signal" aria-hidden />
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                № 002 — the close
              </span>
            </div>

            <h2 className="display mt-8 text-[clamp(2.75rem,7.5vw,6.5rem)]">
              One click.
              <br />
              One pod.
              <br />
              <span className="text-signal">Ready.</span>
            </h2>
          </div>

          <div className="flex flex-col justify-end gap-6 lg:col-span-4">
            <p className="text-base leading-7 text-neutral-500">
              Sign in, pick a template, and you have a containerized agent
              with a public URL before your coffee cools. Free during the
              prototype.
            </p>

            <div className="flex flex-col gap-3">
              <Link
                href="http://localhost:3000"
                className="group inline-flex items-center justify-between bg-signal px-5 py-3 text-sm font-semibold text-neutral-950 transition-transform hover:translate-x-1"
              >
                Open the dashboard
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Print-style colophon on the canvas. */}
      <footer className="bg-background">
        <div className="mx-auto max-w-7xl px-6 py-12">
          {/* Big wordmark */}
          <div className="flex items-end justify-between gap-4 border-b border-hairline pb-8">
            <span className="display truncate text-[clamp(2.5rem,9vw,8rem)] leading-none text-foreground">
              Fuel<span className="text-signal">Born</span>
            </span>
            <span className="micro hidden shrink-0 sm:inline">
              {new Date().getFullYear()} · prototype
            </span>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-8 text-sm sm:grid-cols-4">
            <FooterCol
              title="product"
              links={[
                ["Dashboard", "http://localhost:3000"],
                ["Deploy",    "http://localhost:3000/deploy"],
                ["Pods",      "#pods"],
              ]}
            />
            <FooterCol
              title="stack"
              links={[
                ["Pelican Panel", "https://pelican.dev"],
                ["Wings",         "https://pelican.dev/docs/wings"],
                ["Caddy",         "https://caddyserver.com"],
              ]}
            />
            <FooterCol
              title="contact"
              links={[["FuelBorn on GitHub", "https://github.com/codebanditssss/FuelBorn"]]}
            />
          </div>

          <div className="mt-12 flex flex-col gap-2 border-t border-hairline pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="micro">
              © FuelBorn — AI agents that earn
            </p>
            <p className="micro">
              pelican · wings · docker · caddy · manrope · jetbrains mono
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: [string, string][];
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="micro">{title}</span>
      <ul className="flex flex-col gap-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link
              href={href}
              className="text-neutral-200 underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
