import { NextResponse, type NextRequest } from "next/server";
import {
  parseDodoEvent,
  processDodoWebhook,
  verifyDodoWebhookSignature,
} from "@/lib/billing/dodo";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const webhookId = req.headers.get("webhook-id");
  const webhookTimestamp = req.headers.get("webhook-timestamp");
  const webhookSignature = req.headers.get("webhook-signature");

  const valid = verifyDodoWebhookSignature({
    rawBody,
    webhookId,
    webhookTimestamp,
    webhookSignature,
  });
  if (!valid) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  if (!webhookId) {
    return NextResponse.json({ error: "missing_webhook_id" }, { status: 400 });
  }

  let event;
  try {
    event = parseDodoEvent(rawBody);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_payload", message: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const result = processDodoWebhook({ webhookId, rawBody, event });
  if (!result.ok) {
    return NextResponse.json(
      { error: "webhook_processing_failed", message: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ received: true, ...result });
}
