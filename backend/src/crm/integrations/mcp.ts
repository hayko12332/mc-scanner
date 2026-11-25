import { createHash, randomBytes } from 'node:crypto';

// Connecting a company's own MCP server (Model Context Protocol) to a board, so HaulPanel's AI assistant can work in
// that account: the owner signs in on the company's site (OAuth 2.1 + PKCE), HaulPanel registers itself as a client
// on the fly (dynamic client registration, RFC 7591) — no partner deal or developer account needed — and the access
// token is handed to Claude's MCP connector with each AI request. Only servers checked to allow that are listed.

export interface McpApp { id: string; name: string; url: string }

/** MCP servers that let any app register and the user sign in (checked 2026-11-25). */
export const MCP_APPS: McpApp[] = [
  { id: 'motive', name: 'Motive', url: 'https://mcp.us.gomotive.com/mcp' },
  { id: 'geotab', name: 'Geotab', url: 'https://mcp.geotab.com/mygeotab' },
  { id: 'zapier', name: 'Zapier', url: 'https://mcp.zapier.com/api/v1/connect' },
  { id: 'stripe', name: 'Stripe', url: 'https://mcp.stripe.com' },
  { id: 'paypal', name: 'PayPal', url: 'https://mcp.paypal.com/mcp' },
  { id: 'square', name: 'Square', url: 'https://mcp.squareup.com/mcp' },
];
export const mcpApp = (id: string) => MCP_APPS.find((a) => a.id === id);

type Json = Record<string, unknown>;
type Fetch = typeof fetch;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export class McpError extends Error {}

async function getJson(url: string, fetcher: Fetch): Promise<Json | null> {
  try {
    const r = await fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    return (await r.json()) as Json;
  } catch { return null; }
}

export interface AuthServer { issuer: string; authorize: string; token: string; register: string; scopes: string[]; resource: string }

/**
 * Where to sign in for an MCP server: its protected-resource metadata (from the 401's WWW-Authenticate header, or
 * the well-known path), then the authorization server's metadata.
 */
export async function discover(url: string, fetcher: Fetch = fetch): Promise<AuthServer> {
  let prmUrl = '';
  try {
    const r = await fetcher(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'HaulPanel', version: '1' } } }),
      signal: AbortSignal.timeout(15_000),
    });
    prmUrl = /resource_metadata="([^"]+)"/.exec(r.headers.get('www-authenticate') ?? '')?.[1] ?? '';
  } catch { /* fall back to the well-known paths */ }
  const u = new URL(url);
  const prm = (prmUrl ? await getJson(prmUrl, fetcher) : null)
    ?? await getJson(`${u.origin}/.well-known/oauth-protected-resource${u.pathname === '/' ? '' : u.pathname}`, fetcher)
    ?? await getJson(`${u.origin}/.well-known/oauth-protected-resource`, fetcher);
  const asBase = str((prm?.authorization_servers as unknown[] | undefined)?.[0]) || u.origin;
  const b = new URL(asBase);
  const path = b.pathname === '/' ? '' : b.pathname.replace(/\/$/, '');
  const as = await getJson(`${b.origin}/.well-known/oauth-authorization-server${path}`, fetcher)
    ?? await getJson(`${asBase.replace(/\/$/, '')}/.well-known/oauth-authorization-server`, fetcher)
    ?? await getJson(`${asBase.replace(/\/$/, '')}/.well-known/openid-configuration`, fetcher);
  if (!as || !str(as.authorization_endpoint) || !str(as.token_endpoint)) throw new McpError('This service’s sign-in could not be found');
  if (!str(as.registration_endpoint)) throw new McpError('This service doesn’t let apps connect on their own yet');
  return {
    issuer: str(as.issuer), authorize: str(as.authorization_endpoint), token: str(as.token_endpoint), register: str(as.registration_endpoint),
    scopes: ((prm?.scopes_supported as unknown[] | undefined) ?? []).map(str).filter(Boolean), resource: str(prm?.resource) || url,
  };
}

export interface Client { clientId: string; clientSecret: string }

/** Registers HaulPanel as an OAuth client of that service (once per service and return address). */
export async function register(as: AuthServer, redirect: string, fetcher: Fetch = fetch): Promise<Client> {
  const r = await fetcher(as.register, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'HaulPanel', client_uri: 'https://haulpanel.com', logo_uri: 'https://haulpanel.com/logo.svg',
      redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok || !str(j.client_id)) throw new McpError(`The service refused to register HaulPanel (${r.status})`);
  return { clientId: str(j.client_id), clientSecret: str(j.client_secret) };
}

export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export function authorizeUrl(as: AuthServer, client: Client, redirect: string, state: string, challenge: string): string {
  const q = new URLSearchParams({
    response_type: 'code', client_id: client.clientId, redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: 'S256', resource: as.resource,
  });
  // Ask for what the server lists (refresh tokens too, when offered).
  if (as.scopes.length) q.set('scope', as.scopes.join(' '));
  return `${as.authorize}${as.authorize.includes('?') ? '&' : '?'}${q}`;
}

export interface Tokens { access: string; refresh: string; expiresAt: number }

async function tokenCall(as: AuthServer, client: Client, body: Record<string, string>, fetcher: Fetch): Promise<Tokens> {
  const form = new URLSearchParams({ ...body, client_id: client.clientId, resource: as.resource });
  if (client.clientSecret) form.set('client_secret', client.clientSecret);
  const r = await fetcher(as.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form, signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok || !str(j.access_token)) throw new McpError(str(j.error_description) || str(j.error) || `Sign-in failed (${r.status})`);
  const ttl = typeof j.expires_in === 'number' ? j.expires_in : 3600;
  return { access: str(j.access_token), refresh: str(j.refresh_token) || body.refresh_token || '', expiresAt: Date.now() + ttl * 1000 };
}

export const exchange = (as: AuthServer, client: Client, code: string, redirect: string, verifier: string, fetcher: Fetch = fetch) =>
  tokenCall(as, client, { grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier }, fetcher);

export const refresh = (as: AuthServer, client: Client, refreshToken: string, fetcher: Fetch = fetch) =>
  tokenCall(as, client, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetcher);

/** The tools the server offers to this account (also proves the token works). Streamable HTTP, JSON or SSE replies. */
export async function listTools(url: string, token: string, fetcher: Fetch = fetch): Promise<{ name: string; description: string }[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` };
  const call = async (id: number, method: string, params: Json = {}) => {
    const r = await fetcher(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(20_000) });
    if (r.status === 401 || r.status === 403) throw new McpError('The service no longer accepts this sign-in — connect again');
    const session = r.headers.get('mcp-session-id');
    if (session) headers['Mcp-Session-Id'] = session;
    const text = await r.text();
    const json = text.trim().startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter((l) => l.startsWith('{')).pop() ?? '{}';
    const j = JSON.parse(json) as Json;
    if (j.error) throw new McpError(str((j.error as Json).message) || 'The service answered with an error');
    return (j.result ?? {}) as Json;
  };
  await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'HaulPanel', version: '1' } });
  await fetcher(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  const res = await call(2, 'tools/list');
  return ((res.tools as Json[] | undefined) ?? []).map((t) => ({ name: str(t.name), description: str(t.description).slice(0, 200) }));
}
