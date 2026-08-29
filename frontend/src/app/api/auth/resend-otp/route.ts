import { NextRequest, NextResponse } from "next/server";
import { resendSignupOtp } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const res = await resendSignupOtp(body.email ?? "");
  if (!res.ok) {
    const status = res.code === "rate_limited" ? 429 : 400;
    return NextResponse.json({ error: res.error, code: res.code }, { status });
  }
  return NextResponse.json({ ok: true });
}
