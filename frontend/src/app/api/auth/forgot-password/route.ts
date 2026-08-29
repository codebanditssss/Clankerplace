import { NextRequest, NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const res = await requestPasswordReset(body.email ?? "");
  // requestPasswordReset deliberately returns ok=true even for unknown
  // emails — don't divulge account existence through the response.
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
