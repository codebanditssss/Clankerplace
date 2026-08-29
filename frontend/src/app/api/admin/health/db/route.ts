// SQLite health probe. Counts users (fast, indexed PK) — if this trips
// an error something's badly wrong.

import { NextResponse } from "next/server";
import { NotAdminError, requireAdmin } from "@/lib/admin";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof NotAdminError) {
      return new NextResponse("not found", { status: 404 });
    }
    throw e;
  }
  try {
    const row = db
      .prepare<unknown[], { c: number }>("SELECT COUNT(*) c FROM users")
      .get();
    return NextResponse.json({ ok: true, users: row?.c ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
