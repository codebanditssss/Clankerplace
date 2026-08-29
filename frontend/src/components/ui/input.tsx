import * as React from "react";
import { cn } from "@/lib/cn";

// Autofill suppression strategy.
//
// Chrome's autofill totally ignores `autocomplete="off"` on text fields
// and ignores the data-* hints that 1Password/LastPass/Dashlane/Bitwarden
// respect. Its heuristic is: "I see a type=password input → assume the
// nearest text-type sibling is a username and fill it." This is what was
// dumping the user's saved login into the Client ID field of the
// DingTalk connector form.
//
// The reliable cure is: never render a real <input type="password">
// outside the login/signup forms. Outside those, we render type="text"
// with `-webkit-text-security: disc` (Chrome, Safari, Edge) so the value
// still LOOKS like a password but Chrome's heuristic doesn't classify
// the form as a credential form. No password classification → no
// adjacent-username autofill.
//
// We tell the auth context apart from everywhere else by the explicit
// `autoComplete` value the caller passes. auth-shell.tsx passes
// "email" / "current-password" / "new-password" — those are the
// well-known credential autocomplete tokens and the only place we WANT
// the password manager to engage. Everywhere else gets the masked-text
// fallback regardless of what the consumer wrote.

const AUTH_AUTOCOMPLETE = new Set([
  "username",
  "email",
  "current-password",
  "new-password",
  "one-time-code",
]);

// Belt + suspenders for non-Chrome password managers. Chrome doesn't
// respect them, but 1Password / LastPass / Dashlane / Bitwarden do.
const NO_AUTOFILL: React.HTMLAttributes<HTMLElement> & {
  "data-1p-ignore"?: string;
  "data-lpignore"?: string;
  "data-form-type"?: string;
  "data-bwignore"?: string;
} = {
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other",
  "data-bwignore": "true",
};

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, autoComplete, type, style, ...props }, ref) {
    const isAuthField =
      typeof autoComplete === "string" && AUTH_AUTOCOMPLETE.has(autoComplete);

    // Decide effective rendered type. Real password-type only when this
    // is clearly an auth field (caller passed a credential autoComplete
    // value). Otherwise downgrade to text + CSS mask.
    const renderedType =
      type === "password" && !isAuthField ? "text" : (type ?? "text");

    // CSS mask for downgraded password fields. Browsers we care about
    // all support `-webkit-text-security`; the standard `text-security`
    // is a typo in older drafts and not supported anywhere yet. React's
    // CSSProperties type doesn't include the vendor prop, so we cast.
    const maskStyle =
      type === "password" && !isAuthField
        ? ({
            WebkitTextSecurity: "disc",
            // Older Firefox falls back to plaintext — accepted trade-off,
            // nobody's saved logins get sprayed across the app.
          } as React.CSSProperties)
        : ({} as React.CSSProperties);

    const defaultAutoComplete = isAuthField
      ? autoComplete
      : type === "password"
        ? "new-password" // tells Chrome "don't pre-fill saved passwords"
        : "off";

    return (
      <input
        ref={ref}
        type={renderedType}
        autoComplete={defaultAutoComplete}
        {...NO_AUTOFILL}
        className={cn(
          "h-9 w-full border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-quaternary)]",
          "transition-colors duration-100",
          "hover:border-[color:var(--border-strong)] focus:border-[color:var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[color:var(--acc-blue)]/30",
          "disabled:cursor-not-allowed disabled:opacity-60",
          type === "password" ? "font-mono tracking-wider" : "",
          className,
        )}
        style={{ ...maskStyle, ...style }}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, autoComplete, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      autoComplete={autoComplete ?? "off"}
      {...NO_AUTOFILL}
      className={cn(
        "min-h-[80px] w-full border border-[color:var(--border)] bg-[color:var(--bg-1)] px-3 py-2 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-quaternary)] focus:border-[color:var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[color:var(--acc-blue)]/30",
        className,
      )}
      {...props}
    />
  );
});

export function Label({
  className,
  hint,
  optional,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & {
  hint?: string;
  optional?: boolean;
}) {
  return (
    <label className={cn("block space-y-1.5", className)} {...props}>
      <span className="flex items-baseline gap-1.5 text-[12px] font-medium text-[color:var(--text-primary)]">
        {props.children}
        {optional && (
          <span className="text-[11px] font-normal text-[color:var(--text-quaternary)]">
            optional
          </span>
        )}
        {hint && (
          <span className="text-[11px] font-normal text-[color:var(--text-quaternary)]">
            · {hint}
          </span>
        )}
      </span>
    </label>
  );
}

export function Hint({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-[11px] leading-snug text-[color:var(--text-quaternary)]",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  optional,
  error,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label hint={hint} optional={optional}>
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-[11px] text-[color:var(--acc-red)]">{error}</p>
      )}
    </div>
  );
}
