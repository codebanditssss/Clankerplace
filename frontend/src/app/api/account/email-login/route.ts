import { NextRequest, NextResponse } from "next/server";
import {
  beginWalletEmailLoginMigration,
  confirmWalletEmailLoginMigration,
  getCurrentUser,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let body: {
    action?: unknown;
    email?: unknown;
    password?: unknown;
    code?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const email = typeof body.email === "string" ? body.email : "";

  if (action === "start") {
    const password = typeof body.password === "string" ? body.password : "";
    const result = await beginWalletEmailLoginMigration(
      user.id,
      email,
      password,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "confirm") {
    const code = typeof body.code === "string" ? body.code : "";
    const result = confirmWalletEmailLoginMigration(user.id, email, code);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, email: result.user.email });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
