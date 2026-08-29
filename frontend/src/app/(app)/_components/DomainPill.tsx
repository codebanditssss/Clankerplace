"use client";

import { ExternalLink, Globe } from "lucide-react";

export default function DomainPill({
  host,
  url,
  variant = "inline",
}: {
  host: string;
  url: string;
  variant?: "inline" | "card";
}) {
  const card = variant === "card";
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={
        card
          ? "group mt-2 inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 font-mono text-[11px] text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--acc-blue)]/40 hover:bg-[color:var(--acc-blue-soft)]/30 hover:text-[color:var(--acc-blue)]"
          : "group inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-[11px] text-[color:var(--text-secondary)] transition-colors hover:border-[color:var(--acc-blue)]/40 hover:bg-[color:var(--acc-blue-soft)]/30 hover:text-[color:var(--acc-blue)]"
      }
      title={url}
    >
      <Globe className={card ? "h-3 w-3 flex-none" : "h-3 w-3"} />
      <span className={card ? "truncate" : "font-mono"}>{host}</span>
      <ExternalLink
        className={
          card
            ? "h-2.5 w-2.5 flex-none opacity-60 transition-opacity group-hover:opacity-100"
            : "h-2.5 w-2.5 opacity-60 transition-opacity group-hover:opacity-100"
        }
      />
    </a>
  );
}
