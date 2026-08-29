// Composes the landing sections into one server-renderable page.
// Mirrors landing/src/app/page.tsx, lives inside the frontend app so
// it can run on the same Next route as the dashboard ("/") and switch
// based on auth state in `(app)/page.tsx`.

import { SiteHeader } from "./site-header";
import { HeroCard } from "./hero-card";
import { HowItWorks } from "./how-it-works";
import { PodFamily } from "./pod-family";
import { WhyPods } from "./why-pods";
import { FooterCta } from "./footer-cta";

export function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <HeroCard />
        <HowItWorks />
        <PodFamily />
        <WhyPods />
        <FooterCta />
      </main>
    </div>
  );
}
