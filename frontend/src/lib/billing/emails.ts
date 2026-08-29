import "server-only";
import { sendEmail } from "../resend";
import { FUELBORN_BRAND } from "../brand";

/**
 * Billing-related transactional emails. Distinct file from auth-emails.ts
 * for the same reason that file exists separately from lib/resend.ts —
 * a templating change to "verify your email" shouldn't risk breaking
 * "your pods were suspended", which is a much higher-impact email.
 *
 * Every send is a single Resend API call wrapped in a try/catch at the
 * caller (defaultEffectRunner in thresholds.ts). A Resend outage cannot
 * block the threshold engine — the user_billing_state row's
 * warn_low_sent_at / suspended_at / etc. is the audit trail of "we
 * intended to send X at time T", regardless of whether Resend was up.
 */

const FROM_EMAIL =
  process.env.BILLING_FROM_EMAIL ??
  process.env.AUTH_FROM_EMAIL ??
  "clankerplace <onboarding@resend.dev>";
// Env-driven so a rebrand only needs APP_NAME=NewName + restart.
// Shared with auth-emails.ts via the same env var.
const APP_NAME = process.env.APP_NAME ?? "clankerplace";
const APP_URL =
  process.env.FUELBORN_PUBLIC_URL ??
  process.env.PODS_PUBLIC_URL ??
  FUELBORN_BRAND.defaultOrigin;

function frameHtml(title: string, bodyHtml: string, footer?: string): string {
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="560" style="max-width:560px;margin:0 auto;background:#0a0a0a;border:1px solid #1f2937;border-radius:10px;">
      <tr><td style="padding:28px 32px;">
        <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#737373;">${APP_NAME}</div>
        <h1 style="margin:14px 0 6px;font-size:22px;font-weight:600;color:#fafafa;">${title}</h1>
        ${bodyHtml}
        ${footer ?? `<p style="margin-top:28px;font-size:12px;color:#737373;line-height:1.6;">Manage credits at <a href="${APP_URL}/billing" style="color:#cccccc;">clankerplace billing</a>.</p>`}
      </td></tr>
    </table>
  </body></html>`;
}

function moneyLine(label: string, valueHtml: string): string {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-top:1px solid #1f2937;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;">
    <span style="color:#737373;">${label}</span>
    <span style="color:#fafafa;">${valueHtml}</span>
  </div>`;
}

function usdString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Public templates. One per ThresholdSideEffect kind.

export async function sendWarnLowEmail(opts: {
  to: string;
  balanceCents: number;
  burnPerDayCents: number;
}): Promise<void> {
  const days = opts.burnPerDayCents > 0
    ? Math.floor(opts.balanceCents / opts.burnPerDayCents)
    : null;
  const runwayLine = days != null
    ? `~${Math.max(0, days)} day${days === 1 ? "" : "s"} of runway at your current burn.`
    : `No pods currently running.`;
  const html = frameHtml(
    "Your credits are running low",
    `<p style="margin:0;color:#d4d4d4;font-size:14px;line-height:1.6;">
       Your <strong style="color:#fafafa;">${APP_NAME}</strong> credit balance is below $1. ${runwayLine}
     </p>
     <div style="margin:22px 0 6px;">
       ${moneyLine("Balance", usdString(opts.balanceCents))}
       ${moneyLine("Daily burn", usdString(opts.burnPerDayCents))}
     </div>
     <p style="margin-top:18px;color:#d4d4d4;font-size:14px;line-height:1.6;">
       <a href="${APP_URL}/billing" style="display:inline-block;background:#fafafa;color:#0a0a0a;padding:10px 18px;font-weight:600;text-decoration:none;border-radius:4px;">Top up credits →</a>
     </p>`,
  );
  await sendEmail({
    to: opts.to,
    from: FROM_EMAIL,
    subject: `Heads up: your ${APP_NAME} credits are running low`,
    text:
      `Your ${APP_NAME} balance is ${usdString(opts.balanceCents)}. ` +
      `${runwayLine}\n\nTop up at ${APP_URL}/billing.`,
    html,
  });
}

export async function sendSuspendEmail(opts: {
  to: string;
}): Promise<void> {
  const html = frameHtml(
    "Your pods have been suspended",
    `<p style="margin:0;color:#d4d4d4;font-size:14px;line-height:1.6;">
       Your credit balance went past zero and the 24-hour grace window
       expired. Your pods have been gracefully stopped — <strong>your data
       is preserved</strong>, but they can't accept traffic until you top up.
     </p>
     <p style="margin:18px 0 0;color:#d4d4d4;font-size:14px;line-height:1.6;">
       Top up your balance to automatically restart your pods. Storage is
       billed at $0.10 / GB-month while pods are suspended; after 30 days
       we delete the data.
     </p>
     <p style="margin-top:22px;">
       <a href="${APP_URL}/billing" style="display:inline-block;background:#fafafa;color:#0a0a0a;padding:10px 18px;font-weight:600;text-decoration:none;border-radius:4px;">Top up to resume →</a>
     </p>`,
  );
  await sendEmail({
    to: opts.to,
    from: FROM_EMAIL,
    subject: `Your ${APP_NAME} pods are suspended — top up to resume`,
    text:
      `Your ${APP_NAME} pods have been suspended due to insufficient credits. ` +
      `Top up at ${APP_URL}/billing to resume. Your data is preserved for 30 days.`,
    html,
  });
}

export async function sendPurgeWarnEmail(opts: {
  to: string;
  daysUntilPurge: number;
}): Promise<void> {
  const html = frameHtml(
    `Your pods will be deleted in ${opts.daysUntilPurge} days`,
    `<p style="margin:0;color:#d4d4d4;font-size:14px;line-height:1.6;">
       Your pods have been suspended for a week. If you don't top up within
       the next <strong>${opts.daysUntilPurge} days</strong>, we'll permanently
       delete the data. This is irreversible.
     </p>
     <p style="margin-top:22px;">
       <a href="${APP_URL}/billing" style="display:inline-block;background:#fafafa;color:#0a0a0a;padding:10px 18px;font-weight:600;text-decoration:none;border-radius:4px;">Top up to keep your data →</a>
     </p>`,
  );
  await sendEmail({
    to: opts.to,
    from: FROM_EMAIL,
    subject: `Final notice: data deletion in ${opts.daysUntilPurge} days`,
    text: `Your suspended pods will be permanently deleted in ${opts.daysUntilPurge} days. Top up at ${APP_URL}/billing.`,
    html,
  });
}

export async function sendPurgedEmail(opts: {
  to: string;
  podsDeleted: number;
}): Promise<void> {
  const html = frameHtml(
    "Your pods have been deleted",
    `<p style="margin:0;color:#d4d4d4;font-size:14px;line-height:1.6;">
       ${opts.podsDeleted} pod${opts.podsDeleted === 1 ? "" : "s"} and
       associated data have been permanently deleted after 30 days of
       suspension. Your account is still active — you can deploy new pods
       any time after topping up.
     </p>
     <p style="margin-top:22px;">
       <a href="${APP_URL}" style="display:inline-block;background:#fafafa;color:#0a0a0a;padding:10px 18px;font-weight:600;text-decoration:none;border-radius:4px;">Start fresh →</a>
     </p>`,
  );
  await sendEmail({
    to: opts.to,
    from: FROM_EMAIL,
    subject: `${APP_NAME}: your pods have been deleted`,
    text: `Your suspended pods have been deleted after 30 days. Your account is still active at ${APP_URL}.`,
    html,
  });
}

export async function sendResumedEmail(opts: {
  to: string;
  podsResumed: number;
}): Promise<void> {
  const html = frameHtml(
    "Welcome back — your pods are running",
    `<p style="margin:0;color:#d4d4d4;font-size:14px;line-height:1.6;">
       Thanks for topping up. ${opts.podsResumed} pod${opts.podsResumed === 1 ? "" : "s"} ${opts.podsResumed === 1 ? "is" : "are"} back online and accepting traffic.
     </p>
     <p style="margin-top:18px;color:#737373;font-size:13px;line-height:1.6;">
       This usually takes ~30 seconds per pod once the container restarts.
       Check the dashboard to see them come back up.
     </p>
     <p style="margin-top:22px;">
       <a href="${APP_URL}" style="display:inline-block;background:#fafafa;color:#0a0a0a;padding:10px 18px;font-weight:600;text-decoration:none;border-radius:4px;">View pods →</a>
     </p>`,
  );
  await sendEmail({
    to: opts.to,
    from: FROM_EMAIL,
    subject: `${APP_NAME}: your pods are running again`,
    text: `Your ${opts.podsResumed} pod${opts.podsResumed === 1 ? "" : "s"} ${opts.podsResumed === 1 ? "is" : "are"} back online after your top-up. ${APP_URL}`,
    html,
  });
}
