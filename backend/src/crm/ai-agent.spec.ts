import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { setAiClient } from './ai.js';
import { chat, decide, newThread, type AgentCtx } from './ai-agent.js';
import type { Load } from './crm.types.js';

const load = (x: Partial<Load>): Load => ({
  id: 1, date: '2026-11-10', carrierId: 1, dispatcherId: 1, broker: 'TQL', pro: 'T1', origin: 'Nashville, TN', destination: 'Orlando, FL', rate: 2000, notes: '',
  status: 'invoiced', truckId: 1, loadedMiles: 686, emptyMiles: 0, detention: 0, layover: 0, tonu: 0, other: 0, lumper: 0, invoicedOn: '2026-09-01', paidOn: null, brokerMc: '', ...x,
});

function fakeApi(responses: Anthropic.Beta.BetaContentBlock[][]) {
  const sent: { messages: Anthropic.Beta.BetaMessageParam[] }[] = [];
  const fetch = (async (_u: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    const content = responses.shift()!;
    return new Response(JSON.stringify({
      id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content,
      stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  setAiClient(new Anthropic({ apiKey: 'test', fetch, maxRetries: 0 }));
  return sent;
}

function fakeCtx() {
  const loads = [load({ id: 1 }), load({ id: 2, status: 'paid', paidOn: '2026-10-01' })];
  const updates: { id: number; status: string; paidOn: string | null }[] = [];
  const ctx: AgentCtx = {
    state: async () => ({ company: { name: 'Acme', type: 'dispatch', mc: '', dot: '', phone: '', fleetSize: '' }, loads, carriers: [], trucks: [], dispatchers: [], checks: [], files: [], invoices: [], brokerEmails: {}, drivers: [], positions: [] }),
    check: async () => null, lookup: async () => [], lane: async () => null,
    createLoad: async (l) => ({ ...l, id: 9 }), updateLoad: async (id, l) => { updates.push({ id, status: l.status, paidOn: l.paidOn }); return { ...l, id }; },
    sendInvoice: async () => ({ number: 'INV-1' }), addCarrier: async (c) => ({ ...c, id: 5 }), trackingLink: async () => 'u', attachFile: async () => undefined,
  };
  return { ctx, updates };
}

afterEach(() => setAiClient(null));

describe('Ask AI assistant', () => {
  it('looks up with tools, proposes a change, and continues once the user confirms it', async () => {
    const sent = fakeApi([
      [{ type: 'text', text: 'Checking overdue invoices.', citations: null }, { type: 'tool_use', id: 'tu1', name: 'find_loads', input: { overdue: true }, caller: { type: 'direct' } }, { type: 'tool_use', id: 'tu2', name: 'update_load', input: { id: 1, status: 'paid' }, caller: { type: 'direct' } }] as unknown as Anthropic.Beta.BetaContentBlock[],
      [{ type: 'text', text: 'Done — load 1 is paid.', citations: null }] as unknown as Anthropic.Beta.BetaContentBlock[],
    ]);
    const { ctx, updates } = fakeCtx();
    const t = newThread();
    await chat(ctx, t, 'board', { text: 'mark the overdue TQL load paid' });
    expect(t.pending).toHaveLength(1);
    expect(t.pending[0].summary).toMatch(/Change load TQL .*status → paid/);
    expect(t.display.at(-1)?.cards?.[0]).toMatchObject({ type: 'loads', ids: [1] });
    expect(updates).toHaveLength(0); // nothing changes before the user confirms

    await decide(ctx, t, 'board', 'tu2', true);
    expect(updates[0]).toMatchObject({ id: 1, status: 'paid' });
    expect(updates[0].paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const results = sent[1].messages.at(-1)!.content as { type: string; tool_use_id: string }[];
    expect(results.map((r) => r.tool_use_id)).toEqual(['tu1', 'tu2']); // both results in one message
    expect(t.display.at(-1)?.text).toBe('Done — load 1 is paid.');
  });

  it('a new message declines actions left unconfirmed', async () => {
    const sent = fakeApi([
      [{ type: 'tool_use', id: 'a1', name: 'add_carrier', input: { name: 'X' }, caller: { type: 'direct' } }] as unknown as Anthropic.Beta.BetaContentBlock[],
      [{ type: 'text', text: 'OK, not adding it.', citations: null }] as unknown as Anthropic.Beta.BetaContentBlock[],
    ]);
    const { ctx } = fakeCtx();
    const t = newThread();
    await chat(ctx, t, 'board', { text: 'add carrier X' });
    await chat(ctx, t, 'board', { text: 'never mind' });
    const last = sent[1].messages.at(-1)!.content as { type: string; content?: string }[];
    expect(last[0].type).toBe('tool_result');
    expect(last[0].content).toContain('did not confirm');
    expect(last[1]).toMatchObject({ type: 'text', text: 'never mind' });
  });
});
