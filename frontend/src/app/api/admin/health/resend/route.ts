// Resend health probe. Hits /domains which doesn't burn quota.

import { NextResponse } from "next/server";
import { NotAdminError, requireAdmin } from "@/lib/admin";

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
  const key = process.env.RESEND_API_KEY ?? process.env.RESEND;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "RESEND_API_KEY missing" },
      { status: 503 },
    );
  }
  try {
    const r = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 503 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
