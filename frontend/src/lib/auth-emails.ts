// Transactional auth emails sent through Resend: signup verification
// OTP and password-reset OTP. Kept separate from the per-pod email
// plumbing in lib/resend.ts so a change to one doesn't risk the other.

import "server-only";
import { sendEmail } from "./resend";

const FROM_EMAIL =
  process.env.AUTH_FROM_EMAIL ?? "FuelBorn <onboarding@resend.dev>";
// APP_NAME shown in subject lines + email body (e.g. "your FuelBorn
// verification code"). Env-driven so a future rebrand only needs an
// env change, no code change. Defaults to "FuelBorn" matching the
// from-address domain.
const APP_NAME = process.env.APP_NAME ?? "FuelBorn";

function codeBlockHtml(code: string): string {
  return `
    <div style="margin:24px 0;padding:18px 22px;border:1px solid #1f2937;background:#0a0a0a;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;letter-spacing:8px;color:#f5f5f5;text-align:center;">
      ${code}
    </div>`;
}

function frameHtml(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="520" style="max-width:520px;margin:0 auto;background:#0a0a0a;border:1px solid #1f2937;border-radius:10px;">
      <tr><td style="padding:28px 32px;">
        <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#737373;">${APP_NAME}</div>
        <h1 style="margin:14px 0 6px;font-size:22px;font-weight:600;color:#fafafa;">${title}</h1>
        ${bodyHtml}
        <p style="margin-top:28px;font-size:12px;color:#737373;line-height:1.6;">
          If you didn't request this, you can safely ignore this email — no changes will be made.
        </p>
      </td></tr>
    </table>
  </body></html>`;
}

export async function sendSignupOtpEmail(opts: {
  to: string;
  code: string;
}): Promise<void> {
  const html = frameHtml(
    "Verify your email",
    `<p style="margin:0;color:#d4d4d4;font-size:14px;line-height:1.6;">
      Enter this code on the verification screen to finish creating your
      <strong style="color:#fafafa;">${APP_NAME}</strong> account. The code expires in 10 minutes.
    </p>
    ${codeBlockHtml(opts.code)}`,
  );
  const text = `Your ${APP_NAME} verification code is: ${opts.code}\n\nIt expires in 10 minutes. If you didn't request this, ignore this email.`;
  await sendEmail({
    to: opts.to,
    from: FROM_EMAIL,
    subject: `${opts.code} is your ${APP_NAME} verification code`,
    text,
    html,
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  code: string;
}): Promise<void> {
  const html = frameHtml(
    "Reset your password",
    `<p style="margin:0;color:#d4d4d4;font-size:14px;line-height:1.6;">
      Enter this code on the password reset screen to choose a new password
      for your <strong style="color:#fafafa;">${APP_NAME}</strong> account.
      The code expires in 10 minutes.
    </p>
    ${codeBlockHtml(opts.code)}`,
  );
  const text = `Your ${APP_NAME} password-reset code is: ${opts.code}\n\nIt expires in 10 minutes. If you didn't request a reset, ignore this email and your password will stay the same.`;
  await sendEmail({
    to: opts.to,
    from: FROM_EMAIL,
    subject: `${opts.code} is your ${APP_NAME} password reset code`,
    text,
    html,
  });
}
