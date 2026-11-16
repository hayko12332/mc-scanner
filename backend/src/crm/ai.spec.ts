import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { askBoard, readRateCon, setAiClient } from './ai.js';

const fields = {
  isRateConfirmation: true, broker: 'Total Quality Logistics', brokerMc: '411443', brokerEmail: 'ap@tql.com', loadNumber: 'TQL-1',
  pickupDate: '2026-11-18', deliveryDate: '2026-11-19', origin: 'Nashville, TN', destination: 'Orlando, FL', rate: 2100, miles: 686, notes: 'PU 08:00',
};

function fake(text: string) {
  const sent: Record<string, unknown>[] = [];
  const fetch = (async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  setAiClient(new Anthropic({ apiKey: 'test', fetch, maxRetries: 0 }));
  return sent;
}

afterEach(() => setAiClient(null));

describe('AI on the board', () => {
  it('sends the rate con as a PDF document with a JSON schema, and returns the fields', async () => {
    const sent = fake(JSON.stringify(fields));
    const r = await readRateCon(Buffer.from('%PDF-1.4'), 'application/pdf', '2026-11-17');
    expect(r).toEqual(fields);
    const body = sent[0] as { model: string; messages: { content: { type: string; source?: { media_type: string } }[] }[]; output_config: { format: { type: string } }; fallbacks: string };
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.messages[0].content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.fallbacks).toBe('default');
  });

  it('answers from the board data, which is cached in the system prompt', async () => {
    const sent = fake('Gross last week: $4,350');
    expect(await askBoard('LOADS: …', [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], 'gross last week?')).toBe('Gross last week: $4,350');
    const body = sent[0] as { system: { cache_control?: unknown }[]; messages: unknown[] };
    expect(body.system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages).toHaveLength(3);
  });
});
