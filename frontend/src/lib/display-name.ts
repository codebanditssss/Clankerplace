/**
 * Helpers for displaying a user's "name" in the UI.
 *
 * Wallet-only accounts have a synthetic email like
 * `<base58-address>@wallet.pods.local` (see WALLET_EMAIL_DOMAIN in
 * lib/auth.ts). Rendering that verbatim looks awful — the local part
 * is a legacy wallet address. These helpers detect the synthetic shape
 * and produce a short, recognizable label.
 *
 * Pure / side-effect free — safe to import from client components.
 */

const WALLET_EMAIL_DOMAIN = "wallet.pods.local";

export function isWalletEmail(email: string): boolean {
  return typeof email === "string" && email.endsWith(`@${WALLET_EMAIL_DOMAIN}`);
}

/**
 * The full base58 address embedded in a wallet-synthetic email, or
 * null if the email isn't synthetic. Note: the synthetic email is
 * lowercased, but legacy wallet addresses are case-sensitive. For
 * display purposes that's fine — the actual address with original
 * casing is always available via the user's wallet_identities rows.
 */
export function walletAddressFromEmail(email: string): string | null {
  if (!isWalletEmail(email)) return null;
  return email.split("@")[0];
}

/**
 * Short, human-friendly handle for any user. Examples:
 *   "alice@example.com"                              → "alice"
 *   "3jrrdw6w...kubghn@wallet.pods.local"            → "3jrr…BGHn"
 *   ""                                               → ""
 *
 * The wallet form keeps the first 4 chars + last 4 chars of the
 * address, with the original (mixed-case) ending preserved when
 * possible by taking from the actual address (we have it via the
 * email's local part).
 */
export function shortHandle(email: string): string {
  if (!email) return "";
  const addr = walletAddressFromEmail(email);
  if (addr) {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  }
  return email.split("@")[0];
}

/**
 * One-character avatar marker. For email users: first letter of the
 * local part, uppercased. For wallet users: a generic wallet symbol
 * (◎) so the avatar isn't a meaningless digit.
 */
export function avatarChar(email: string): string {
  if (isWalletEmail(email)) return "◎";
  return email[0]?.toUpperCase() ?? "?";
}
