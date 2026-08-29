import { NextRequest, NextResponse } from "next/server";
import { verifyResetCode } from "@/lib/auth";
import { setResetSession } from "@/lib/session";
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

  const res = await verifyResetCode(body.email ?? "", code);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  await setResetSession(res.userId);
  return NextResponse.json({ ok: true });
}
