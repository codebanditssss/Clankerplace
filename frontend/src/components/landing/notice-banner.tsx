// Slim notice strip that sits above the landing site header.
// Reuses the Discord URL from the shared SOCIALS catalog so there's no
// chance of the link drifting out of sync.

import { Info } from "lucide-react";
import { SOCIALS } from "./social-links";

export function NoticeBanner() {
  const discord = SOCIALS.find((s) => s.label === "Discord");
  const href = discord?.href ?? "#";
  return (
    <div className="relative z-50 border-b border-signal/30 bg-signal/10 text-foreground">
      <div className="mx-auto flex max-w-7xl items-center gap-2.5 px-4 py-2 text-[12px] leading-snug sm:gap-3 sm:px-6 sm:text-[13px]">
        <Info className="h-3.5 w-3.5 shrink-0 text-signal sm:h-4 sm:w-4" aria-hidden />
        <p className="min-w-0">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-signal sm:text-[11px]">
            Note
          </span>
          <span className="mx-2 text-neutral-600">/</span>
          <span className="text-neutral-200">
            To access pods using terminal commands, apply for our early beta
            test role in{" "}
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-signal underline-offset-4 hover:underline"
            >
              our Discord
              <span aria-hidden> →</span>
            </a>
          </span>
        </p>
      </div>
    </div>
  );
}
