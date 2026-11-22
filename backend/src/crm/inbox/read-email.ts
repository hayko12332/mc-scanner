import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { api, FAST_MODEL, friendly } from '../ai.js';

// What an email to a board's HaulPanel address is, and the loads in it. Load-board alerts (DAT, 123Loadboard…) and
// brokers' "available loads" emails come in any layout, so the AI reads them; everything after that is plain code.

export const Posting = z.object({
  broker: z.string().describe('Broker / company that posted the load'),
  contact: z.string().describe('Contact person name, or empty'),
  email: z.string().describe('Contact email for this load, or empty'),
  phone: z.string().describe('Contact phone, or empty'),
  origin: z.string().describe('Pickup as "City, ST" (US/Canada state code), or empty'),
  destination: z.string().describe('Delivery as "City, ST", or empty'),
  pickup_date: z.string().describe('Pickup date YYYY-MM-DD, or empty'),
  equipment: z.string().describe('Trailer type as posted (Van, Reefer, Flatbed, …), or empty'),
  weight_lbs: z.number().describe('Weight in lbs, 0 if not posted'),
  rate: z.number().describe('Posted rate in USD for the load, 0 if not posted'),
  miles: z.number().describe('Trip miles if posted, else 0'),
  ref: z.string().describe('Posting / reference / load number, or empty'),
  notes: z.string().describe('Anything else that matters in one short line (length, full/partial, commodity, team), max 200 chars'),
});
export type PostingFields = z.infer<typeof Posting>;

const EmailRead = z.object({
  kind: z.enum(['load_postings', 'rate_confirmation', 'forwarding_confirmation', 'other'])
    .describe('load_postings = load board alert or a broker listing available loads; rate_confirmation = a broker sent a rate con / load tender (usually a PDF); forwarding_confirmation = an email provider (Gmail, Outlook) asks to confirm forwarding to this address; other = anything else'),
  summary: z.string().describe('What the email is, in under 12 words'),
  postings: z.array(Posting).describe('Every load offered in the email (only for load_postings), up to 60'),
  confirmation: z.string().describe('For forwarding_confirmation: the confirmation code or link, else empty'),
});
export type EmailReading = z.infer<typeof EmailRead>;

export interface InboundEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; contentType: string; content: Buffer }[];
}

/** HTML mail as plain text with links kept (tables become rows), so the AI and the tests see the same thing. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\b[^>]*href="(mailto:)?([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, _mt: string, href: string, inner: string) => `${inner} (${href})`)
    .replace(/<\/(td|th)>/gi, ' | ').replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim();
}

/** The email as the AI reads it: who, subject, and the body (plain text preferred, else the HTML made readable). */
export function emailText(e: InboundEmail): string {
  const body = (e.text?.trim() || htmlText(e.html ?? '')).slice(0, 40_000);
  const files = e.attachments.map((a) => `${a.filename} (${a.contentType})`).join(', ');
  return `From: ${e.from}\nSubject: ${e.subject}\n${files ? `Attachments: ${files}\n` : ''}\n${body}`;
}

/** Reads one email: its kind and, for load emails, every posting in it. */
export async function readEmail(e: InboundEmail, today: string): Promise<EmailReading> {
  try {
    const r = await api().beta.messages.parse({
      model: FAST_MODEL, max_tokens: 16000,
      output_config: { effort: 'low', format: betaZodOutputFormat(EmailRead) },
      messages: [{
        role: 'user',
        content: `A US truck dispatch company forwards email to its TMS. Say what this email is, and if it offers loads, list every load exactly as posted — never invent a value; leave it empty or 0 when it isn't there. Today is ${today}; a date without a year is in the next 12 months. Places as "City, ST".\n\n---\n${emailText(e)}`,
      }],
    });
    if (r.stop_reason === 'refusal' || !r.parsed_output) return { kind: 'other', summary: 'Could not read this email', postings: [], confirmation: '' };
    return r.parsed_output;
  } catch (err) {
    throw friendly(err);
  }
}
