import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { setAiClient } from './ai.js';
import { chat, decide, newThread, undo, type AgentCtx, type AgentEvent } from './ai-agent.js';
import type { Load } from './crm.types.js';

const load = (x: Partial<Load>): Load => ({
  id: 1, date: '2026-11-10', carrierId: 1, dispatcherId: 1, broker: 'TQL', pro: 'T1', origin: 'Nashville, TN', destination: 'Orlando, FL', rate: 2000, notes: '',
  status: 'invoiced', truckId: 1, loadedMiles: 686, emptyMiles: 0, detention: 0, layover: 0, tonu: 0, other: 0, lumper: 0, invoicedOn: '2026-09-01', paidOn: null, brokerMc: '', ...x,
});

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
const text = (t: string): Block => ({ type: 'text', text: t });
const tool = (id: string, name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id, name, input });

/** The Messages API as a server-sent event stream, the way the SDK reads it. */
function sse(content: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  content.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      for (const part of b.text.match(/.{1,8}/g) ?? []) out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: part } });
    } else {
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    out += ev('content_block_stop', { index });
  });
  out += ev('message_delta', { delta: { stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
  return out + ev('message_stop', {});
}

function fakeApi(responses: Block[][]) {
  const sent: { model: string; fallbacks?: string; messages: Anthropic.Beta.BetaMessageParam[]; tools: { eager_input_streaming?: boolean }[] }[] = [];
  const fetch = (async (_u: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return new Response(sse(responses.shift()!), { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof globalThis.fetch;
  setAiClient(new Anthropic({ apiKey: 'test', fetch, maxRetries: 0 }));
  return sent;
}

function fakeCtx() {
  const loads = [load({ id: 1 }), load({ id: 2, status: 'paid', paidOn: '2026-10-01' })];
  const updates: { id: number; status: string; paidOn: string | null }[] = [];
  const sentInvoices: number[] = [];
  const deleted: number[] = [];
  const factored: { id: number; to?: string }[] = [];
  const brokerMails: { to: string; subject: string; body: string }[] = [];
  const ctx: AgentCtx = {
    state: async () => ({ company: { name: 'Acme', type: 'dispatch', mc: '', dot: '', phone: '', fleetSize: '' }, loads,
      carriers: [{ id: 1, name: 'BEKU', mc: '', dot: '', phone: '', email: '', notes: '', feeType: 'percent' as const, fee: 0, factoring: 'RTS Financial', factoringEmail: 'inv@rts.example' }], trucks: [], dispatchers: [], checks: [], files: [], invoices: [], brokerEmails: { tql: 'ap@tql.example' }, drivers: [], positions: [] }),
    check: async () => null, lookup: async () => [], lane: async () => null,
    createLoad: async (l) => ({ ...l, id: 9 }),
    updateLoad: async (id, l) => { updates.push({ id, status: l.status, paidOn: l.paidOn }); return { ...l, id }; },
    sendInvoice: async (id) => { sentInvoices.push(id); return { number: 'INV-1' }; },
    addCarrier: async (c) => ({ ...c, id: 5 }), trackingLink: async () => 'u', attachFile: async () => undefined,
    deleteLoad: async (id) => { deleted.push(id); }, archiveCarrier: async () => undefined,
    sendFactoring: async (id, _attach, to) => { factored.push({ id, to }); return { number: 'INV-2', to: to ?? 'inv@rts.example', factor: 'RTS Financial' }; },
    emailBroker: async (to, subject, body) => { brokerMails.push({ to, subject, body }); return { to }; },
  };
  return { ctx, updates, sentInvoices, deleted, factored, brokerMails };
}

afterEach(() => setAiClient(null));

describe('AI assistant', () => {
  it('does board changes itself, shows each step live, and can undo them', async () => {
    const sent = fakeApi([
      [tool('tu1', 'find_loads', { overdue: true }), tool('tu2', 'update_load', { id: 1, status: 'paid' })],
      [text('**Done — load 1 is paid.**')],
    ]);
    const { ctx, updates } = fakeCtx();
    const t = newThread();
    const events: AgentEvent[] = [];
    await chat(ctx, t, 'board', { text: 'mark the overdue TQL load paid' }, (e) => events.push(e));

    expect(updates[0]).toMatchObject({ id: 1, status: 'paid' });
    expect(updates[0].paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent[0].tools.every((x) => x.eager_input_streaming)).toBe(true);
    expect(sent[0].model).toBe('claude-haiku-5-5'); // the low-cost model by default
    expect(sent[0].fallbacks).toBeUndefined();
    // Live: each tool is shown running, then done; the answer arrives in pieces.
    const steps = events.filter((e) => e.type === 'step') as Extract<AgentEvent, { type: 'step' }>[];
    expect(steps.map((e) => `${e.id}:${e.state}`)).toEqual(['tu1:running', 'tu1:done', 'tu2:running', 'tu2:done']);
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toContain('Done — load 1 is paid.');
    expect(events.some((e) => e.type === 'action' && e.action.undoable)).toBe(true);
    // One message for the whole request.
    const item = t.display.at(-1)!;
    expect(item.text).toBe('**Done — load 1 is paid.**');
    expect(item.steps).toHaveLength(2);
    expect(item.actions).toEqual(['tu2']);
    expect(item.cards?.[0]).toMatchObject({ type: 'loads', ids: [1] });

    await undo(ctx, t, 'tu2');
    expect(updates.at(-1)).toMatchObject({ id: 1, status: 'invoiced', paidOn: null }); // back as it was
    expect(t.actions![0].status).toBe('undone');
    // The assistant hears about it with the next message.
    fakeApi([[text('Noted.')]]);
    await chat(ctx, t, 'board', { text: 'ok' });
    expect(JSON.stringify(t.messages.at(-2))).toContain('the user undid');
  });

  it('an email waits for the OK; approving it sends it and the assistant continues', async () => {
    const sent = fakeApi([
      [tool('r1', 'find_loads', { not_invoiced: true }), tool('e1', 'send_invoice', { load_id: 1 })],
      [text('Invoice sent.')],
    ]);
    const { ctx, sentInvoices } = fakeCtx();
    const t = newThread();
    await chat(ctx, t, 'board', { text: 'invoice load 1' });
    expect(sentInvoices).toHaveLength(0);
    expect(t.pending[0]).toMatchObject({ id: 'e1', status: 'pending', preview: { to: 'ap@tql.example' } });
    expect(t.display.at(-1)?.steps?.at(-1)).toMatchObject({ state: 'waiting' });

    await decide(ctx, t, 'board', 'e1', true);
    expect(sentInvoices).toEqual([1]);
    expect(t.actions?.find((a) => a.id === 'e1')?.status).toBe('done'); // the email stays in the chat as sent
    const results = sent[1].messages.at(-1)!.content as { type: string; tool_use_id: string }[];
    expect(results.map((r) => r.tool_use_id)).toEqual(['r1', 'e1']); // both results in one message
    expect(t.display.at(-1)?.text).toBe('Invoice sent.');
  });

  it('a new message declines an email left waiting', async () => {
    const sent = fakeApi([
      [tool('e1', 'send_invoice', { load_id: 1 })],
      [text('OK, not sending it.')],
    ]);
    const { ctx, sentInvoices } = fakeCtx();
    const t = newThread();
    await chat(ctx, t, 'board', { text: 'invoice load 1' });
    await chat(ctx, t, 'board', { text: 'never mind' });
    expect(sentInvoices).toHaveLength(0);
    const last = sent[1].messages.at(-1)!.content as { type: string; content?: string; text?: string }[];
    expect(last[0].type).toBe('tool_result');
    expect(last[0].content).toContain('did not confirm');
    expect(last.at(-1)).toMatchObject({ type: 'text', text: 'never mind' });
  });

  it('never runs a tool whose input is missing a required field', async () => {
    const sent = fakeApi([
      [tool('u1', 'update_load', { status: 'paid' })],
      [text('I need the load number.')],
    ]);
    const { ctx, updates } = fakeCtx();
    const t = newThread();
    await chat(ctx, t, 'board', { text: 'mark it paid' });
    expect(updates).toHaveLength(0);
    const result = (sent[1].messages.at(-1)!.content as { content: string; is_error?: boolean }[])[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Missing id');
  });

  it('a stop keeps the chat valid for the next message', async () => {
    fakeApi([[tool('f1', 'find_loads', {})]]);
    const { ctx } = fakeCtx();
    const t = newThread();
    const ac = new AbortController();
    await chat(ctx, t, 'board', { text: 'find loads' }, (e) => { if (e.type === 'step' && e.state === 'done') ac.abort(); }, ac.signal);
    expect(t.display.at(-1)?.stopped).toBe(true);
    const sent = fakeApi([[text('Here you go.')]]);
    await chat(ctx, t, 'board', { text: 'continue' });
    const first = (sent[0].messages.at(-1)!.content as { type: string; tool_use_id?: string }[])[0];
    expect(first).toMatchObject({ type: 'tool_result', tool_use_id: 'f1' });
  });

  it('sends a load to factoring and emails a broker about a posting, each only after the OK', async () => {
    fakeApi([
      [tool('f1', 'send_to_factoring', { load_id: 1 }),
        tool('m1', 'email_broker', { to: 'jane@coyote.example', subject: 'Load Dallas, TX → Atlanta, GA 11/24', body: 'Hi Jane,\nIs this load still available? Our truck is empty in Dallas at 8am.' })],
      [text('Both sent.')],
    ]);
    const { ctx, factored, brokerMails } = fakeCtx();
    const t = newThread();
    await chat(ctx, t, 'board', { text: 'factor load 1 and ask Coyote about the Dallas load' });
    expect(factored).toHaveLength(0);
    expect(brokerMails).toHaveLength(0);
    expect(t.pending.find((p) => p.id === 'f1')?.preview).toMatchObject({ to: 'inv@rts.example', lines: expect.arrayContaining(['RTS Financial · remit to on the invoice']) });
    expect(t.pending.find((p) => p.id === 'm1')?.preview).toEqual({ to: 'jane@coyote.example', subject: 'Load Dallas, TX → Atlanta, GA 11/24', lines: ['Hi Jane,', 'Is this load still available? Our truck is empty in Dallas at 8am.'] });
    await decide(ctx, t, 'board', 'f1', true);
    await decide(ctx, t, 'board', 'm1', true);
    expect(factored).toEqual([{ id: 1, to: undefined }]);
    expect(brokerMails[0]).toMatchObject({ to: 'jane@coyote.example' });
    expect(t.display.at(-1)?.text).toBe('Both sent.');
  });
});
