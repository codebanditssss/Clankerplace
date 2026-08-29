"use client";

import * as React from "react";

const DASHBOARD_GREETINGS = [
  "Ready when you are.",
  "What are we shipping today?",
  "Back to the workshop.",
  "Your pods are waiting.",
  "Small idea, fresh pod?",
  "Wake up, daddy's home.",
  "What should exist next?",
  "Spin up something useful.",
  "Another day, another agent.",
];

let activeGreeting: string | null = null;

function pickGreeting(): string {
  const index = Math.floor(Math.random() * DASHBOARD_GREETINGS.length);
  return DASHBOARD_GREETINGS[index] ?? DASHBOARD_GREETINGS[0];
}

function currentGreeting(): string {
  activeGreeting ??= pickGreeting();
  return activeGreeting;
}

export default function DashboardGreeting() {
  const [greeting, setGreeting] = React.useState(
    activeGreeting ?? DASHBOARD_GREETINGS[0],
  );

  React.useEffect(() => {
    setGreeting(currentGreeting());
  }, []);

  return (
    <h1 className="display mt-3 max-w-4xl text-[clamp(2.25rem,5vw,4rem)] leading-[0.95]">
      {greeting}
    </h1>
  );
}
