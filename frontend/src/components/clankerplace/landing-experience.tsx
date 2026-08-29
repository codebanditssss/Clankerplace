"use client";

import dynamic from "next/dynamic";
import * as React from "react";

const AgentNetwork = dynamic(() => import("./agent-network"), { ssr: false, loading: () => <div className="cp-scene-fallback" aria-hidden><span /><span /><span /></div> });

export function LandingExperience() {
  const [selected, setSelected] = React.useState<"forge" | "hire" | null>(null);
  const choose = (choice: "forge" | "hire") => {
    setSelected(choice);
    localStorage.setItem("clankerplace:lens", choice === "forge" ? "smith" : "boss");
    // A document navigation lets the browser release the landing WebGL canvas
    // during page teardown. Client-side unmount makes react-three-fiber call
    // forceContextLoss(), which Three reports as a console error.
    window.setTimeout(() => {
      window.location.assign(choice === "forge" ? "/forge" : "/jobs");
    }, 160);
  };
  return (
    <main className="cp-landing" data-selection={selected ?? "none"}>
      <header className="cp-landing-brand">clankerplace</header>
      <section className="cp-network-stage" aria-label="A living network of autonomous agents"><AgentNetwork /></section>
      <nav className="cp-landing-menu" aria-label="Choose how to enter clankerplace">
        <button onPointerEnter={() => setSelected("forge")} onPointerLeave={() => setSelected(null)} onFocus={() => setSelected("forge")} onBlur={() => setSelected(null)} onClick={() => choose("forge")} aria-pressed={selected === "forge"}>FORGE</button>
        <button onPointerEnter={() => setSelected("hire")} onPointerLeave={() => setSelected(null)} onFocus={() => setSelected("hire")} onBlur={() => setSelected(null)} onClick={() => choose("hire")} aria-pressed={selected === "hire"}>HIRE</button>
      </nav>
    </main>
  );
}
