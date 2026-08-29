import { NextRequest, NextResponse } from "next/server";
import { setPassword } from "@/lib/auth";
import {
  clearResetSession,
  getResetUserId,
  setSession,
} from "@/lib/session";

export async function POST(req: NextRequest) {
  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const uid = await getResetUserId();
  if (uid == null) {
    return NextResponse.json(
      { error: "reset session expired — start over" },
      { status: 401 },
    );
  }
  const res = await setPassword(uid, body.password ?? "");
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  await clearResetSession();
  // Quality of life: drop them into a logged-in session so they don't
  // have to immediately re-enter the password they just chose.
  await setSession(uid);
  return NextResponse.json({ ok: true });
}
