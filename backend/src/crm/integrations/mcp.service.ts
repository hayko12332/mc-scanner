import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { config } from '../../config.js';
import { EldSyncService } from './eld-sync.service.js';
import { authorizeUrl, discover, exchange, listTools, mcpApp, MCP_APPS, McpError, pkce, refresh, register, type AuthServer, type Client, type McpApp, type Tokens } from './mcp.js';
import { vaultReady } from './vault.js';

/** Local testing only (never on Render): MCP_TEST_APP=geotab MCP_TEST_URL=http://localhost:8790/mcp points one service at a stand-in. */
const local = (a: McpApp): McpApp =>
  (process.env.RENDER !== 'true' && process.env.MCP_TEST_URL && process.env.MCP_TEST_APP === a.id ? { ...a, url: process.env.MCP_TEST_URL } : a);

interface Saved extends Tokens { clientId: string; clientSecret: string }

/**
 * A board's MCP connections: sign-in (OAuth with PKCE and on-the-fly client registration), tokens kept sealed in
 * crm_integrations as provider "mcp:<app>", refreshed before they run out, and handed to the AI assistant.
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  private readonly pending = new Map<string, { ws: number; app: string; verifier: string; client: Client; expires: number }>();
  private readonly servers = new Map<string, { as: AuthServer; at: number }>();

  constructor(private readonly eld: EldSyncService) {}

  enabled() { return !!this.eld.store && vaultReady(); }
  apps(): McpApp[] { return MCP_APPS.map(local); }
  private app(id: string): McpApp {
    const a = mcpApp(id);
    if (!a) throw new McpError('Unknown service');
    return local(a);
  }
  private get store() { return this.eld.store!; }
  private redirect() { return `${config.publicUrl || 'https://haulpanel.com'}/api/crm/integrations/mcp/callback`; }

  private async auth(a: McpApp): Promise<AuthServer> {
    const c = this.servers.get(a.id);
    if (c && Date.now() - c.at < 3600_000) return c.as;
    const as = await discover(a.url);
    this.servers.set(a.id, { as, at: Date.now() });
    return as;
  }

  /** HaulPanel's client id at that service (registered once per return address, kept in the database). */
  private async client(a: McpApp, as: AuthServer): Promise<Client> {
    const redirect = this.redirect();
    const known = await this.store.mcpClient(a.id, redirect);
    if (known) return known;
    const c = await register(as, redirect);
    await this.store.saveMcpClient(a.id, redirect, c);
    return c;
  }

  /** The sign-in address for the board owner. */
  async start(ws: number, appId: string): Promise<string> {
    const a = this.app(appId);
    const as = await this.auth(a);
    const client = await this.client(a, as);
    const { verifier, challenge } = pkce();
    const state = randomBytes(18).toString('base64url');
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k);
    this.pending.set(state, { ws, app: a.id, verifier, client, expires: now + 15 * 60_000 });
    return authorizeUrl(as, client, this.redirect(), state, challenge);
  }

  /** The service sent the owner back: the code becomes tokens, checked by listing the tools. */
  async finish(state: string, code: string, ws: number): Promise<{ app: McpApp; tools: number }> {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || p.expires < Date.now() || p.ws !== ws) throw new McpError('This sign-in link has expired — press Connect again');
    const a = this.app(p.app);
    const as = await this.auth(a);
    const t = await exchange(as, p.client, code, this.redirect(), p.verifier);
    const tools = await listTools(a.url, t.access).catch((e: Error) => { this.logger.warn(`MCP ${a.id} tools: ${e.message}`); return [] });
    await this.store.connect(ws, `mcp:${a.id}`, 'us', JSON.stringify({ ...t, clientId: p.client.clientId, clientSecret: p.client.clientSecret } satisfies Saved), a.name);
    return { app: a, tools: tools.length };
  }

  /** A working access token, refreshed when it is about to run out; null when the owner must connect again. */
  async token(ws: number, appId: string): Promise<string | null> {
    const raw = await this.store.secretOf(ws, `mcp:${appId}`);
    if (!raw) return null;
    let s: Saved;
    try { s = JSON.parse(raw) as Saved } catch { return null }
    if (s.expiresAt - Date.now() > 120_000) return s.access;
    if (!s.refresh) { await this.store.markError(ws, `mcp:${appId}`, 'The sign-in ran out — connect again'); return null }
    try {
      const a = this.app(appId);
      const t = await refresh(await this.auth(a), { clientId: s.clientId, clientSecret: s.clientSecret }, s.refresh);
      await this.store.setSecret(ws, `mcp:${appId}`, JSON.stringify({ ...s, ...t }));
      await this.store.markOk(ws, `mcp:${appId}`);
      return t.access;
    } catch (e) {
      await this.store.markError(ws, `mcp:${appId}`, `Sign-in ran out (${(e as Error).message}) — connect again`);
      return null;
    }
  }

  /** The connected MCP servers of a board, ready for Claude's MCP connector. */
  async forAi(ws: number): Promise<{ name: string; url: string; token: string; label: string }[]> {
    if (!this.enabled()) return [];
    const conns = (await this.store.connections(ws)).filter((c) => c.provider.startsWith('mcp:'));
    const out: { name: string; url: string; token: string; label: string }[] = [];
    for (const c of conns) {
      const id = c.provider.slice(4);
      const found = mcpApp(id);
      if (!found) continue;
      const a = local(found);
      const token = await this.token(ws, id).catch(() => null);
      if (token) out.push({ name: a.id, url: a.url, token, label: a.name });
    }
    return out;
  }

  /** What the AI can do there now (the server's tool list). */
  async tools(ws: number, appId: string) {
    const a = this.app(appId);
    const token = await this.token(ws, appId);
    if (!token) throw new McpError('Not connected — press Connect');
    return listTools(a.url, token);
  }
}
