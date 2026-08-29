// Shared social-link catalog + icon row. Used by the landing header
// and the footer colophon. Icons are inline SVGs so the brand glyphs
// stay pixel-perfect at every size and don't pull a third-party
// brand-icon package.

import { cn } from "@/lib/cn";
import { DISCORD_INVITE_URL } from "@/lib/external-links";

type IconProps = { className?: string };

function XIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25h6.829l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function DiscordIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 -28.5 256 256"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d="M216.856 16.597a208.502 208.502 0 0 0-51.991-16.13 1.085 1.085 0 0 0-1.13.521c-2.247 3.978-4.733 9.149-6.474 13.224a195.402 195.402 0 0 0-56.522 0c-1.741-4.164-4.317-9.246-6.586-13.224a1.118 1.118 0 0 0-1.13-.522 207.886 207.886 0 0 0-51.999 16.131 1.034 1.034 0 0 0-.473.405C7.013 71.394-3.176 121.018 1.831 170.064a1.31 1.31 0 0 0 .493.917c19.852 14.59 39.087 23.45 57.967 29.328a1.124 1.124 0 0 0 1.218-.41 165.708 165.708 0 0 0 14.063-22.811 1.087 1.087 0 0 0-.594-1.514 137.747 137.747 0 0 1-19.673-9.376 1.108 1.108 0 0 1-.111-1.836c1.32-.99 2.633-2.022 3.892-3.062a1.078 1.078 0 0 1 1.124-.151c41.288 18.85 85.992 18.85 126.802 0a1.072 1.072 0 0 1 1.142.141c1.265 1.04 2.572 2.082 3.902 3.072a1.108 1.108 0 0 1-.094 1.836 129.272 129.272 0 0 1-19.683 9.366 1.094 1.094 0 0 0-.583 1.524 186.197 186.197 0 0 0 14.054 22.802 1.103 1.103 0 0 0 1.21.42c18.97-5.876 38.205-14.736 58.057-29.326a1.115 1.115 0 0 0 .493-.907c5.987-56.704-10.025-105.928-42.443-149.612a.879.879 0 0 0-.461-.415zM85.474 140.087c-12.522 0-22.835-11.495-22.835-25.61 0-14.114 10.114-25.61 22.835-25.61 12.823 0 23.036 11.596 22.835 25.61 0 14.115-10.112 25.61-22.835 25.61zm84.398 0c-12.521 0-22.834-11.495-22.834-25.61 0-14.114 10.113-25.61 22.834-25.61 12.823 0 23.036 11.596 22.835 25.61 0 14.115-10.012 25.61-22.835 25.61z" />
    </svg>
  );
}

function GitHubIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export const SOCIALS = [
  { label: "X", handle: "@podsml",        href: "https://x.com/podsml",         Icon: XIcon },
  { label: "Discord", handle: "podsml",   href: DISCORD_INVITE_URL,             Icon: DiscordIcon },
  { label: "GitHub", handle: "podsML",    href: "https://github.com/podsML",    Icon: GitHubIcon },
] as const;

/**
 * Compact icon-button row used in the landing header and inline footer.
 * Each anchor is a square hit target so it stays comfortable on touch.
 */
export function SocialIconRow({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "large" | "footer";
}) {
  const wrap =
    variant === "large"
      ? "h-11 w-11"
      : variant === "footer"
        ? "h-10 w-10"
        : "h-9 w-9";
  const icon =
    variant === "large" ? "h-[18px] w-[18px]" : "h-4 w-4";
  return (
    <ul className={cn("flex items-center gap-1", className)}>
      {SOCIALS.map(({ label, href, Icon }) => (
        <li key={label}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={label}
            title={label}
            className={cn(
              "grid place-items-center border border-transparent text-neutral-300 transition-colors hover:border-hairline hover:bg-neutral-800 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60",
              wrap,
            )}
          >
            <Icon className={icon} />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Wider footer variant. Renders the icon plus a label so it reads as a
 * proper "find us on" block in the masthead colophon.
 */
export function SocialLabeledList({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {SOCIALS.map(({ label, handle, href, Icon }) => (
        <li key={label}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2.5 text-neutral-200 transition-colors hover:text-foreground"
          >
            <span className="grid h-7 w-7 place-items-center border border-hairline bg-neutral-900 text-neutral-400 transition-colors group-hover:border-neutral-700 group-hover:bg-neutral-800 group-hover:text-foreground">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="flex flex-col gap-0">
              <span className="text-[13px] font-medium leading-none underline-offset-4 group-hover:underline">
                {label}
              </span>
              <span className="mt-1 font-mono text-[10px] text-neutral-500">
                {handle}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
