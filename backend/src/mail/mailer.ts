import { Logger } from '@nestjs/common';
import { config } from '../config.js';

export interface Mail { to: string; subject: string; text: string; html: string }

const logger = new Logger('Mailer');

/** Email can be sent (Resend is configured), or we are developing locally and codes are printed to the log. */
export const mailReady = () => !!config.resendApiKey || !config.onRender;

/**
 * Sends one email through Resend (https://resend.com/docs/api-reference/emails/send-email).
 * Locally without a key the message is printed to the log instead, so sign-up can be tested.
 */
export async function sendMail(mail: Mail, fetcher: typeof fetch = fetch): Promise<void> {
  if (!config.resendApiKey) {
    if (config.onRender) throw new Error('Email is not set up yet');
    logger.log(`[dev mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  const res = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.mailFrom, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, reply_to: config.mailReplyTo || undefined }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    logger.error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    throw new Error('Could not send the email, please try again in a minute');
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The one-time code email (verification or password reset): plain, readable on a phone, code easy to copy. */
export function codeMail(to: string, code: string, purpose: 'verify' | 'reset', name = ''): Mail {
  const brand = config.brandName;
  const verify = purpose === 'verify';
  const subject = verify ? `${code} is your ${brand} verification code` : `${code} is your ${brand} password reset code`;
  const lead = verify ? `Welcome to ${brand}! Enter this code to confirm your email:` : `Enter this code to set a new password for your ${brand} account:`;
  const tail = verify
    ? 'If you did not sign up, you can ignore this email.'
    : 'If you did not ask to reset your password, you can ignore this email — your password stays the same.';
  const hi = name ? `Hi ${name},` : 'Hi,';
  const text = `${hi}\n\n${lead}\n\n${code}\n\nThe code works for 15 minutes.\n${tail}\n\n— The ${brand} team\n${config.publicUrl}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;border:1px solid #e2e8f0">
<tr><td style="padding:28px 28px 8px;font-size:18px;font-weight:800">${esc(brand)}</td></tr>
<tr><td style="padding:8px 28px;font-size:15px;line-height:1.5">${esc(hi)}<br><br>${esc(lead)}</td></tr>
<tr><td style="padding:12px 28px"><div style="font-size:32px;font-weight:800;letter-spacing:8px;background:#f1f5f9;border-radius:10px;padding:14px 0;text-align:center">${code}</div></td></tr>
<tr><td style="padding:8px 28px 24px;font-size:13px;line-height:1.5;color:#64748b">The code works for 15 minutes.<br>${esc(tail)}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">— The ${esc(brand)} team · <a href="${esc(config.publicUrl)}" style="color:#2563eb">${esc(config.publicUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
</table></td></tr></table></body></html>`;
  return { to, subject, text, html };
}
