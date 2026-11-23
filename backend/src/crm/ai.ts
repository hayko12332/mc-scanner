import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { FileKind } from './crm.store.js';

// AI on the dispatch board (Claude): read a rate confirmation into a new load, tell a BOL from a POD in a driver's
// photo, and answer the owner's questions about their own board. Switched on by ANTHROPIC_API_KEY (Render env);
// without it every feature stays hidden and nothing is sent anywhere.

/**
 * Models, chosen to keep the bill small. Everything runs on Haiku (the low-cost model) by default; AI_MODEL on the
 * server switches the assistant and document reading to a stronger model (e.g. claude-sonnet-5-5) without a code
 * change. Quick single reads (rate cons, document type, spreadsheet columns) always use Haiku.
 */
export const MODEL = process.env.AI_MODEL?.trim() || 'claude-haiku-5-5';
export const FAST_MODEL = 'claude-haiku-5-5';
const BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01'];
/**
 * The model and, where it exists, the server-side fallback (a request declined by a safety classifier is retried on
 * another model by the API itself). Haiku has no fallback, so nothing extra is sent for it.
 */
export function modelParams(model = MODEL): { model: string; betas?: Anthropic.Beta.AnthropicBeta[]; fallbacks?: 'default' } {
  return /^claude-(sonnet|opus|fable)/.test(model) ? { model, betas: BETAS, fallbacks: 'default' } : { model };
}

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const RateCon = z.object({
  isRateConfirmation: z.boolean().describe('false if the document is not a rate confirmation / load tender'),
  broker: z.string().describe('Broker company name (who pays), as printed'),
  brokerMc: z.string().describe('Broker MC number, digits only, or empty'),
  brokerEmail: z.string().describe('Billing / accounting email to send the invoice to, or the broker contact email, or empty'),
  loadNumber: z.string().describe('Load / order / confirmation number the broker uses'),
  pickupDate: z.string().describe('First pickup date as YYYY-MM-DD, or empty'),
  deliveryDate: z.string().describe('Last delivery date as YYYY-MM-DD, or empty'),
  origin: z.string().describe('First pickup as "City, ST" (US state code) or empty'),
  destination: z.string().describe('Last delivery as "City, ST" or empty'),
  rate: z.number().describe('Total pay to the carrier in USD (all-in linehaul incl. fuel), 0 if not found'),
  miles: z.number().describe('Loaded miles if printed, else 0'),
  notes: z.string().describe('One short line each: pickup and delivery appointment times, commodity, weight, equipment, reference / PO numbers, extra stops. Max 400 chars.'),
});
export type RateConFields = z.infer<typeof RateCon>;

const DocType = z.object({
  kind: z.enum(['bol', 'pod', 'ratecon', 'other']).describe('bol = bill of lading before delivery; pod = signed / stamped delivery receipt (BOL signed by the receiver); ratecon = rate confirmation; other = lumper receipt, scale ticket, anything else'),
});

const DeliveryDoc = z.object({
  kind: z.enum(['bol', 'pod', 'other']).describe('bol = bill of lading not yet signed by the receiver; pod = proof of delivery (a BOL or delivery receipt signed or stamped by the receiver); other = anything else'),
  references: z.array(z.string()).describe('Every load, PRO, BOL, order, PO, shipment and reference number printed on it, as printed (max 12)'),
  shipper: z.string().describe('Shipper (ship from) company name, or empty'),
  consignee: z.string().describe('Consignee (ship to) company name, or empty'),
  origin: z.string().describe('Ship-from place as "City, ST", or empty'),
  destination: z.string().describe('Ship-to place as "City, ST", or empty'),
  pickupDate: z.string().describe('Ship / pickup date as YYYY-MM-DD, or empty'),
  deliveryDate: z.string().describe('Delivery date written or stamped by the receiver as YYYY-MM-DD, or empty'),
  signedByReceiver: z.boolean().describe('true only if a receiver signature, name or stamp is on it'),
  receiver: z.string().describe('Name of who signed for it at delivery, or empty'),
  pieces: z.string().describe('Pieces / pallets / handling units as printed, or empty'),
  weight: z.string().describe('Total weight as printed (with units), or empty'),
  exceptions: z.string().describe('Shortage, damage, overage, refused, "subject to count" or other notes the receiver wrote, in one short line; empty if clean'),
});
export type DeliveryDocFields = z.infer<typeof DeliveryDoc>;

let client: Anthropic | null = null;
export const api = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 120_000 }));
/** Tests swap in a client with a fake fetch. */
export const setAiClient = (c: Anthropic | null) => { client = c; };
const logger = new Logger('AI');

/** A PDF or a photo as a content block. */
function fileBlock(data: Buffer, mime: string): Anthropic.Beta.BetaContentBlockParam {
  const b64 = data.toString('base64');
  if (mime === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
  return { type: 'image', source: { type: 'base64', media_type: mime === 'image/png' ? 'image/png' : 'image/jpeg', data: b64 } };
}

/** Turns API errors into messages a dispatcher can act on. */
export function friendly(e: unknown): Error {
  if (e instanceof Anthropic.RateLimitError) return new Error('AI is busy right now, try again in a minute');
  if (e instanceof Anthropic.AuthenticationError) return new Error('AI is not set up correctly (API key)');
  if (e instanceof Anthropic.BadRequestError) { logger.warn(`AI request: ${e.message}`); return new Error('AI could not read this file'); }
  if (e instanceof Anthropic.APIError) { logger.warn(`AI ${e.status}: ${e.message}`); return new Error('AI is not answering right now, try again in a minute'); }
  return e instanceof Error ? e : new Error(String(e));
}

/** Reads a rate confirmation (PDF or photo) into the fields of a new load. */
export async function readRateCon(data: Buffer, mime: string, today: string): Promise<RateConFields> {
  try {
    const r = await api().beta.messages.parse({
      model: FAST_MODEL, max_tokens: 4000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(RateCon) },
      messages: [{
        role: 'user',
        content: [
          fileBlock(data, mime),
          { type: 'text', text: `This is a document a truck dispatcher received from a freight broker. Fill in the load fields from it. Use only what is printed; leave a field empty (or 0) when it is not there. Dates as YYYY-MM-DD (today is ${today}; a date without a year is in the next 12 months). Places as "City, ST".` },
        ],
      }],
    });
    if (r.stop_reason === 'refusal' || !r.parsed_output) throw new Error('AI could not read this file');
    return r.parsed_output;
  } catch (e) {
    throw friendly(e);
  }
}

/** Reads a BOL or POD (PDF or photo): numbers to match it to a load, whether the receiver signed, and any exceptions. */
export async function readDeliveryDoc(data: Buffer, mime: string, today: string): Promise<DeliveryDocFields> {
  try {
    const r = await api().beta.messages.parse({
      model: FAST_MODEL, max_tokens: 3000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(DeliveryDoc) },
      messages: [{
        role: 'user',
        content: [
          fileBlock(data, mime),
          { type: 'text', text: `A freight company got this trucking document (often a phone photo). Say whether it is a bill of lading or a signed proof of delivery and read the fields. Use only what is on it; leave a field empty when it is not there or not legible. Dates as YYYY-MM-DD (today is ${today}). Places as "City, ST". Handwriting counts.` },
        ],
      }],
    });
    if (r.stop_reason === 'refusal' || !r.parsed_output) throw new Error('AI could not read this file');
    return { ...r.parsed_output, references: r.parsed_output.references.slice(0, 12) };
  } catch (e) {
    throw friendly(e);
  }
}

/** What a driver's photo or PDF is: BOL, POD, rate con or something else. Null if AI is off or unsure. */
export async function classifyDoc(data: Buffer, mime: string): Promise<FileKind | null> {
  if (!aiEnabled()) return null;
  try {
    const r = await api().beta.messages.parse({
      model: FAST_MODEL, max_tokens: 1000,
      output_config: { effort: 'low', format: betaZodOutputFormat(DocType) },
      messages: [{ role: 'user', content: [fileBlock(data, mime), { type: 'text', text: 'A truck driver sent this. Which trucking document is it?' }] }],
    });
    return r.stop_reason === 'refusal' ? null : (r.parsed_output?.kind ?? null);
  } catch (e) {
    logger.warn(`Classify: ${friendly(e).message}`);
    return null;
  }
}

export interface AskTurn { role: 'user' | 'assistant'; text: string }

const ASK_SYSTEM = `You are the assistant inside HaulPanel, a TMS for truck dispatch companies. You answer the user's questions about their own dispatch board, using only the board data given below (loads, carriers, trucks, dispatchers). Do the arithmetic carefully and show the key numbers. Money in USD. "Gross" = rate + detention + layover + TONU + other (lumper is a reimbursement, not gross). RPM = gross / loaded miles; all-in RPM includes empty miles. A load is overdue when invoiced and unpaid more than 30 days after the invoice date. Weeks run Monday to Sunday. If the data can't answer the question, say what is missing. Answer briefly in the user's language, with a short list or table when it helps. Never invent loads or numbers.`;

/** Answers a question about the board. `board` is the board's data as compact text (stable, so it is cached). */
export async function askBoard(board: string, history: AskTurn[], question: string): Promise<string> {
  try {
    const r = await api().beta.messages.create({
      ...modelParams(), max_tokens: 4000,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: ASK_SYSTEM }, { type: 'text', text: board, cache_control: { type: 'ephemeral' } }],
      messages: [
        ...history.slice(-8).map((t): Anthropic.Beta.BetaMessageParam => ({ role: t.role, content: t.text })),
        { role: 'user', content: question },
      ],
    });
    if (r.stop_reason === 'refusal') return 'I can’t help with that one — ask me about your loads, carriers, trucks or dispatchers.';
    return r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim() || 'No answer — try asking another way.';
  } catch (e) {
    throw friendly(e);
  }
}
