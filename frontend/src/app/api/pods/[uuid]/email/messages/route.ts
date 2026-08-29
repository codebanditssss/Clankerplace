// GET /api/pods/[uuid]/email/messages?limit=50
//
// Inbox + sent history for the pod's managed email. Newest first.
// Caps at 200 rows per request — the UI paginates if it needs more.
import { NextRequest, NextResponse } from "next/server";
import db, { type PodEmailRow } from "@/lib/db";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const srv = data.data?.[0]?.attributes;
  if (!srv || srv.user !== user.pelicanUserId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit") ?? 50)),
  );
  const direction = url.searchParams.get("direction"); // "in" | "out" | null

  let rows: PodEmailRow[];
  if (direction === "in" || direction === "out") {
    rows = db
      .prepare<[string, string, number], PodEmailRow>(
        `SELECT * FROM pod_emails
         WHERE pod_uuid_short = ? AND direction = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(uuid, direction, limit);
  } else {
    rows = db
      .prepare<[string, number], PodEmailRow>(
        `SELECT * FROM pod_emails
         WHERE pod_uuid_short = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(uuid, limit);
  }

  // Trim body to a snippet for the list view — the open-drawer fetches
  // a single row via /messages/<id> for the full content (TBD; for now
  // we send everything because individual messages are typically small).
  return NextResponse.json({
    count: rows.length,
    messages: rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      from: r.from_addr,
      to: r.to_addr,
      subject: r.subject,
      snippet: snippetOf(r.text, r.html),
      text: r.text,
      html: r.html,
      resend_email_id: r.resend_email_id,
      in_reply_to: r.in_reply_to,
      message_id: r.message_id,
      received_at: r.received_at,
      sent_at: r.sent_at,
      error: r.error,
      created_at: r.created_at,
    })),
  });
}

function snippetOf(text: string | null, html: string | null): string {
  const src = text ?? stripHtml(html ?? "") ?? "";
  return src.replace(/\s+/g, " ").trim().slice(0, 200);
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}
