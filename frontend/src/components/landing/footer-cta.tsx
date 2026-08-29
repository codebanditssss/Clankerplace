import Link from "next/link";
import { SocialIconRow, SocialLabeledList } from "./social-links";

/**
 * Footer CTA plus masthead-style site footer.
 *
 * The CTA is an inverted slab, bone foreground on dark canvas, so it
 * lands like a final printed page. Signal-orange picks up "Ready." as
 * the payoff. Below sits a print-style colophon on the canvas.
 */
export function FooterCta() {
  return (
    <>
      {/* The slab. Only inverted (light-on-light) block in the design. */}
      <section className="relative overflow-hidden border-t border-b border-hairline bg-foreground text-background">
        <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-12 px-6 py-20 sm:py-24 lg:grid-cols-12 lg:py-32">
          <div className="lg:col-span-8">
            <div className="flex items-center gap-3">
              <span className="size-2 shrink-0 bg-signal" aria-hidden />
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                № 002, the close
              </span>
            </div>

            <h2 className="display mt-8 text-[clamp(2.25rem,7.5vw,6.5rem)] leading-[0.95]">
              One click.
              <br />
              One pod.
              <br />
              <span className="text-signal">Ready.</span>
            </h2>
          </div>

          <div className="flex flex-col justify-end gap-6 lg:col-span-4">
            <p className="text-base leading-7 text-neutral-500">
              Sign in, pick a template, and you have a running agent with a
              public URL before your coffee cools. Free during the prototype.
            </p>

            <div className="flex flex-col gap-3">
              <Link
                href="/login"
                className="group inline-flex items-center justify-between bg-signal px-5 py-3 text-sm font-semibold text-neutral-950 transition-transform hover:translate-x-1"
              >
                Open the dashboard
                <span aria-hidden>→</span>
              </Link>
              <a
                href="https://github.com/codebanditssss/FuelBorn"
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center justify-between border border-neutral-950/30 px-5 py-3 text-sm font-semibold text-background transition-colors hover:bg-background hover:text-foreground"
              >
                Read the source
                <span aria-hidden>↗</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Print-style colophon on the canvas. */}
      <footer className="bg-background">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          {/* Big wordmark + social row */}
          <div className="flex flex-col gap-6 border-b border-hairline pb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <span className="display truncate text-[clamp(2.25rem,9vw,8rem)] leading-none text-foreground">
              Fuel<span className="text-signal">Born</span>
            </span>
            <div className="flex items-center gap-4">
              <span className="micro hidden shrink-0 sm:inline">
                {new Date().getFullYear()}, prototype
              </span>
              <SocialIconRow variant="footer" />
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-8 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <FooterCol
              title="product"
              links={[
                ["Dashboard", "/"],
                ["Deploy",    "/?wizard=1"],
                ["Pods",      "#pods"],
                ["Pricing",   "/pricing"],
              ]}
            />
            <FooterCol
              title="learn"
              links={[
                ["How it works", "#how"],
                ["Self-hosting", "#self-hosting"],
                ["Pod family",   "#pods"],
              ]}
            />
            <FooterCol
              title="contact"
              links={[["FuelBorn on GitHub", "https://github.com/codebanditssss/FuelBorn"]]}
            />
            <div className="col-span-2 flex flex-col gap-3 sm:col-span-3 lg:col-span-1">
              <span className="micro">community</span>
              <SocialLabeledList />
            </div>
          </div>

          <div className="mt-12 flex flex-col gap-2 border-t border-hairline pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="micro">
              © FuelBorn, AI agents that earn
            </p>
            <p className="micro">one click, one pod, your data</p>
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
