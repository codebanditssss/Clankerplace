import { SiteHeader } from "@/components/site-header";
import { HeroCard } from "@/components/hero-card";
import { HowItWorks } from "@/components/how-it-works";
import { PodFamily } from "@/components/pod-family";
import { WhyPods } from "@/components/why-pods";
import { FooterCta } from "@/components/footer-cta";

export default function Home() {
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
