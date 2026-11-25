import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorizeUrl, discover, exchange, listTools, pkce, register } from './mcp.js';

// A stand-in MCP server with OAuth (PKCE + dynamic client registration), answered by a fake fetch.
function fakeServer() {
  const base = 'https://mcp.example.com';
  let challenge = '';
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const auth = new Headers(init?.headers).get('authorization');
    if (u.pathname === '/mcp' && !auth) return res(401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
    if (u.pathname === '/.well-known/oauth-protected-resource/mcp') return res(200, { resource: `${base}/mcp`, authorization_servers: ['https://auth.example.com/'], scopes_supported: ['mcp'] });
    if (u.href === 'https://auth.example.com/.well-known/oauth-authorization-server') return res(200, { issuer: 'https://auth.example.com', authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/token', registration_endpoint: 'https://auth.example.com/register' });
    if (u.pathname === '/register') return res(201, { client_id: 'client-1' });
    if (u.pathname === '/token') {
      const f = new URLSearchParams(String(init?.body));
      if (createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') !== challenge) return res(400, { error: 'invalid_grant' });
      return res(200, { access_token: 'tok', refresh_token: 'ref', expires_in: 60 });
    }
    if (u.pathname === '/mcp') {
      const m = JSON.parse(String(init?.body)) as { method: string; id?: number };
      if (m.method === 'initialize') return res(200, { jsonrpc: '2.0', id: m.id, result: {} }, { 'mcp-session-id': 's1' });
      // tools/list answered as a server-sent event, like many Streamable HTTP servers do
      if (m.method === 'tools/list') return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'list_vehicles', description: 'Vehicles' }] } })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      return new Response(null, { status: 202 });
    }
    return res(404, {});
  }) as typeof fetch;
  return { fetcher, setChallenge: (c: string) => { challenge = c } };
}

describe('MCP sign-in', () => {
  it('finds the sign-in, registers, exchanges the code with PKCE and lists the tools', async () => {
    const s = fakeServer();
    const as = await discover('https://mcp.example.com/mcp', s.fetcher);
    expect(as).toMatchObject({ authorize: 'https://auth.example.com/authorize', register: 'https://auth.example.com/register', scopes: ['mcp'], resource: 'https://mcp.example.com/mcp' });
    const client = await register(as, 'https://haulpanel.com/api/crm/integrations/mcp/callback', s.fetcher);
    expect(client.clientId).toBe('client-1');
    const { verifier, challenge } = pkce();
    s.setChallenge(challenge);
    const url = new URL(authorizeUrl(as, client, 'https://haulpanel.com/cb', 'st', challenge));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'client-1', code_challenge_method: 'S256', state: 'st', scope: 'mcp', resource: 'https://mcp.example.com/mcp' });
    await expect(exchange(as, client, 'code', 'https://haulpanel.com/cb', 'wrong-verifier', s.fetcher)).rejects.toThrow();
    const t = await exchange(as, client, 'code', 'https://haulpanel.com/cb', verifier, s.fetcher);
    expect(t).toMatchObject({ access: 'tok', refresh: 'ref' });
    expect(await listTools('https://mcp.example.com/mcp', t.access, s.fetcher)).toEqual([{ name: 'list_vehicles', description: 'Vehicles' }]);
  });
});
