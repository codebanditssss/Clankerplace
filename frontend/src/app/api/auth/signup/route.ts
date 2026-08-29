import { NextRequest, NextResponse } from "next/server";
import { createPendingSignup } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const res = await createPendingSignup(body.email ?? "", body.password ?? "");
  if (!res.ok) {
    const status = res.code === "rate_limited" ? 429 : 400;
    return NextResponse.json({ error: res.error, code: res.code }, { status });
  }
  // 202 — accepted, verification pending. UI redirects to /verify-email.
  return NextResponse.json({ ok: true, pending: true }, { status: 202 });
}
