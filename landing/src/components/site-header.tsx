import Link from "next/link";
import Image from "next/image";

/**
 * Editorial site header: a dense nav row bounded by a 1px hairline.
 * The deploy CTA is the only color pop in the entire header.
 *
 * Dark-mode contrast notes:
 *   - nav links sit at neutral-200 (high but not bone) → foreground on hover
 *   - the open-dashboard button is bone-white with ink text; on hover the
 *     bg flips to signal-orange with the same dark text — passes AA easily
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md">
      {/* Nav row */}
      <div className="border-b border-hairline">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5"
            aria-label="FuelBorn home"
          >
            <Image
              src="/logo.png"
              alt=""
              width={28}
              height={28}
              priority
              className="h-7 w-7 shrink-0"
            />
            <span className="display whitespace-nowrap text-2xl leading-none">
              Fuel<span className="text-signal">Born</span>
            </span>
            <span className="micro hidden truncate lg:inline">
              / AI agents that earn
            </span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm md:flex">
            <Link
              href="#how"
              className="font-medium text-neutral-200 transition-colors hover:text-foreground"
            >
              How it works
            </Link>
            <Link
              href="#pods"
              className="font-medium text-neutral-200 transition-colors hover:text-foreground"
            >
              Pods
            </Link>
            <Link
              href="#self-hosting"
              className="font-medium text-neutral-200 transition-colors hover:text-foreground"
            >
              Self-hosting
            </Link>
          </nav>

          <Link
            href="http://localhost:3000"
            className="group inline-flex shrink-0 items-center gap-2 bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-signal hover:text-neutral-950"
          >
            Open dashboard
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
