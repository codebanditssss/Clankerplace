import { NextRequest, NextResponse } from "next/server";
import { verifyLogin } from "@/lib/auth";
import { setSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const result = await verifyLogin(body.email ?? "", body.password ?? "");
  if (!result.ok) {
    const status = result.code === "unverified" ? 403 : 401;
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status },
    );
  }
  await setSession(result.user.id);
  return NextResponse.json({ ok: true, email: result.user.email });
}
