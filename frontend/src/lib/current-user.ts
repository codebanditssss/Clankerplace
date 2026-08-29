import "server-only";

import { getSessionUserId } from "./session";
import type { UserRow } from "./db";

export type CurrentUser = {
  id: number;
  email: string;
  pelicanUserId: number;
  emailVerifiedAt: string | null;
};

/**
 * Lightweight session lookup for server-rendered pages.
 *
 * Keep the native SQLite dependency lazy so public pages can render on
 * Vercel without loading better-sqlite3 when there is no session cookie.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const uid = await getSessionUserId();
  if (uid == null) return null;

  const { default: db } = await import("./db");
  const row = db
    .prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?")
    .get(uid);
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    pelicanUserId: row.pelican_user_id,
    emailVerifiedAt: row.email_verified_at,
  };
}
