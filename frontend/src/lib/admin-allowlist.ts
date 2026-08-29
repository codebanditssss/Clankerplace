import "server-only";

const BUILT_IN_ADMIN_EMAILS = new Set([
  "yashagrawalrkt123@gmail.com",
]);

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return null;
  return normalized;
}

export function allowedAdminEmails(): string[] {
  const emails = new Set(BUILT_IN_ADMIN_EMAILS);
  const bootstrapEmail = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  if (bootstrapEmail) emails.add(bootstrapEmail);
  return [...emails];
}

export function isAllowedAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  return normalized != null && allowedAdminEmails().includes(normalized);
}
