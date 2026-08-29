import { NextRequest, NextResponse } from "next/server";
import { verifySignupOtp } from "@/lib/auth";
import { setSession } from "@/lib/session";
import { validateOtp } from "@/lib/validation";

export async function POST(req: NextRequest) {
  let body: { email?: string; code?: string };
  try {
    body = (await req.json()) as { email?: string; code?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const code = (body.code ?? "").trim();
  const codeErr = validateOtp(code);
  if (codeErr) return NextResponse.json({ error: codeErr }, { status: 400 });

  const res = await verifySignupOtp(body.email ?? "", code);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  await setSession(res.user.id);
  return NextResponse.json({ ok: true, email: res.user.email });
}
