import Link from "next/link";
import Image from "next/image";
import { NoticeBanner } from "./notice-banner";
import { SocialIconRow } from "./social-links";

/**
 * Editorial site header. A dense nav row bounded by a 1px hairline.
 * The deploy CTA is the only color pop in the entire header.
 *
 * Dark-mode contrast notes:
 *   - nav links sit at neutral-200 (high but not bone), foreground on hover
 *   - the open-dashboard button is bone-white with ink text; on hover the
 *     bg flips to signal-orange with the same dark text, passes AA easily
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md">
      <NoticeBanner />
      {/* Nav row */}
      <div className="border-b border-hairline">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3"
            aria-label="FuelBorn home"
          >
            <Image
              src="/pods_favicon_tight_512.png"
              alt=""
              width={384}
              height={512}
              priority
              className="h-8 w-auto shrink-0 sm:h-9"
            />
            <span className="flex min-w-0 items-baseline gap-3">
              <span className="display whitespace-nowrap text-xl leading-none sm:text-2xl">
              Fuel<span className="text-signal">Born</span>
              </span>
              <span className="micro hidden truncate lg:inline">
                / AI agents that earn
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm md:flex lg:gap-8">
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
              href="/pricing"
              className="font-medium text-neutral-200 transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              href="#self-hosting"
              className="font-medium text-neutral-200 transition-colors hover:text-foreground"
            >
              Self-hosting
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {/* Socials. Hidden on phones to keep the header compact;
                show from sm up. The footer always carries them too. */}
            <SocialIconRow className="hidden sm:flex" />

            <span aria-hidden className="hidden h-5 w-px bg-hairline sm:inline-block" />

            <Link
              href="/login"
              className="group inline-flex shrink-0 items-center gap-1.5 bg-foreground px-3 py-2 text-[12px] font-semibold text-background transition-colors hover:bg-signal hover:text-neutral-950 sm:gap-2 sm:px-4 sm:text-sm"
            >
              <span>Open dashboard</span>
              <span
                aria-hidden
                className="transition-transform group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
