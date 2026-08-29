// Tiny health probe for Pelican Application API. Returns 200 if the
// /api/application/nodes endpoint responds within 4s, else 503.

import { NextResponse } from "next/server";
import { NotAdminError, requireAdmin } from "@/lib/admin";
import { applicationApi } from "@/lib/pelican";

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
    await applicationApi("/nodes?per_page=1");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
