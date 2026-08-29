import Link from "next/link";
import { GlyphField } from "@/components/glyph-field";

/**
 * Hero — minimal, centered, breathing.
 *
 * One job: get the eye from the headline to the primary CTA in under a second.
 * Background is a live ASCII glyph field that fades out radially toward the
 * center so the headline and CTA sit on clean canvas. Edges of the section
 * keep the dense data-field texture.
 *
 * Padding is intentionally unchanged from the previous hero — content sits in
 * `mx-auto max-w-4xl px-6 py-20 sm:py-24 lg:py-28` so horizontal rhythm
 * stays consistent with the rest of the landing page.
 */
export function HeroCard() {
  return (
    <section className="relative isolate overflow-hidden border-b border-hairline bg-background">
      {/* Background layers are wrapped in the same `mx-auto max-w-7xl px-6`
          container as every other section on the landing page. That means
          the glyph field's visible left/right edges land at the *exact*
          same horizontal position as how-it-works, pod-family, why-pods,
          and the footer — at every viewport, not just narrow ones. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="relative mx-auto h-full max-w-7xl px-6">
          {/* Glyph field — radial mask cuts a hard transparent core large
              enough to fully clear the centered content column (headline +
              subhead + CTA row at every breakpoint), then ramps to full
              opacity at the edges so the ASCII texture only frames the
              composition. Sized for the worst case (375px viewport, where
              content takes ~95% of section width); at wider viewports the
              ASCII still frames generously on left/right because the
              section grows but the ellipse stays content-sized. */}
          <div
            className="absolute inset-y-0 left-6 right-6"
            style={{
              WebkitMaskImage:
                "radial-gradient(ellipse 70% 55% at 50% 50%, transparent 0%, transparent 25%, rgba(0,0,0,0.6) 55%, black 85%)",
              maskImage:
                "radial-gradient(ellipse 70% 55% at 50% 50%, transparent 0%, transparent 25%, rgba(0,0,0,0.6) 55%, black 85%)",
            }}
          >
            <GlyphField className="h-full w-full opacity-100" />
          </div>

          {/* Opaque-core vignette: a solid background-color disc behind the
              content column so any residual mask edge can never bleed type.
              Inner 50% is fully opaque background, then ramps cleanly to
              transparent at the edges. This is the layer doing the real
              work — the mask above is decorative falloff. */}
          <div
            className="absolute inset-y-0 left-6 right-6"
            style={{
              background:
                "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(11,10,9,1) 0%, rgba(11,10,9,1) 30%, rgba(11,10,9,0.7) 55%, transparent 80%)",
            }}
          />
        </div>
      </div>

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 py-20 text-center sm:py-24 lg:py-28">
        <h1 className="display text-[clamp(2.5rem,7vw,5.75rem)]">
          Spin up an
          <br />
          <span className="editorial-italic text-neutral-200">
            entire agent stack
          </span>{" "}
          in
          <br />
          <span className="text-signal">thirty seconds.</span>
        </h1>

        <p className="mt-6 max-w-xl text-base leading-7 text-neutral-300 sm:text-lg">
          Pick a template, hit deploy, get a public URL. Reproducible runtime,
          your data, one VM.
        </p>

        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row">
          <Link
            href="http://localhost:3000"
            className="group inline-flex items-center gap-3 bg-foreground px-7 py-4 text-sm font-semibold text-background transition-colors hover:bg-signal hover:text-neutral-950"
          >
            Deploy your first pod
            <span
              aria-hidden
              className="transition-transform group-hover:translate-x-1"
            >
              →
            </span>
          </Link>

          <Link
            href="#how"
            className="text-sm font-medium text-neutral-400 underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}
