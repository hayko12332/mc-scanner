import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, HttpException, NotFoundException, Param, ParseIntPipe, Patch,
  Post, Query, Req, Res, ServiceUnavailableException, UnauthorizedException, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RateLimiter } from '../analytics/rate-limiter.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { carrierInput, dispatcherInput, importRows, loadInput, truckInput } from './crm.input.js';
import { CrmStore } from './crm.store.js';
import type { CrmUser } from './crm.types.js';
import { verifyGoogleIdToken } from './google-auth.js';
import { codeMail, mailReady, sendMail } from '../mail/mailer.js';
import { checkPassword, codeHash, emailOk, hashPassword, newCode, normEmail, passwordProblem } from './password.js';
import type { CodePurpose } from './crm.store.js';
import type { CompanyInput } from './crm.types.js';
import { MilesService } from './miles.js';
import { CompanyCheckService } from './company-check.service.js';
import { aiEnabled, readDeliveryDoc, readRateCon } from './ai.js';
import { matchDoc } from './doc-match.js';
import { buildCarrierRcPdf, carrierRcParts, sendCarrierRc } from './carrier-ratecon.js';
import { actionView, boardContext, chat, decide, newThread, undo, type AgentCtx, type Emit, type Thread } from './ai-agent.js';
import { LookupService } from '../fmcsa/lookup.service.js';
import { parseLookupQuery } from '../fmcsa/lookup.query.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { FILE_KINDS, type FileKind } from './crm.store.js';
import { buildInvoicePdf } from './invoice.js';
import { invoiceParts, sendLoadInvoice, sendToFactoring } from './invoice-send.js';
import { EldSyncService } from './integrations/eld-sync.service.js';
import { QboService } from './integrations/qbo.service.js';
import { InboxService } from './inbox/inbox.service.js';
import { EldError, ELD_PROVIDERS, type EldProvider, type EldRegion } from './integrations/eld.js';
import { vaultReady } from './integrations/vault.js';
import type { Load } from './crm.types.js';
import { emailOk as validEmail } from './password.js';
import { PlacesService } from './places.js';
import { planImport, type ImportFile, type ImportPlan } from './ai-import.js';
import { CrmActivityInterceptor, type ScopedRequest } from './activity.interceptor.js';
import { McpService } from './integrations/mcp.service.js';
import { McpError } from './integrations/mcp.js';

const COOKIE = 'lh_crm';
const COMPANY_TYPES = ['dispatch', 'carrier', 'broker'];
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const ipOf = (req: Request) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '';

/** Company details from a sign-up or onboarding form; MC/DOT keep digits only. */
function companyInput(b: Record<string, unknown>): CompanyInput {
  const type = text(b.companyType ?? b.type, 20);
  return {
    name: text(b.company ?? b.name, 120), type: COMPANY_TYPES.includes(type) ? type : '',
    mc: text(b.mc, 20).replace(/\D/g, ''), dot: text(b.dot, 20).replace(/\D/g, ''), phone: text(b.phone, 40), fleetSize: text(b.fleetSize, 20),
  };
}
const COOKIE_MAX_AGE_MS = 60 * 24 * 3600_000;

function readCookie(req: Request, name: string): string {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

/** Dispatcher CRM API: sign in with Google, then loads, carriers and dispatchers of the user's workspace. */
@Controller('crm')
@UseInterceptors(CrmActivityInterceptor)
export class CrmController {
  private readonly store: CrmStore | null;
  private readonly placesService = new PlacesService();
  private readonly milesService = new MilesService(fetch, this.placesService);
  /** Sign-up, log-in and code checks per IP: enough for people, not for password guessing. */
  private readonly authLimiter = new RateLimiter(40, 10 * 60_000);
  /** Emails per address: one every 30 seconds, at most 6 an hour. */
  private readonly mailCooldown = new RateLimiter(1, 30_000);
  private readonly mailHourly = new RateLimiter(6, 3600_000);
  /** AI calls per board: enough for a busy day, not for running up the bill. */
  private readonly aiLimiter = new RateLimiter(60, 3600_000);
  /** Miles are public (the demo uses them too), so each visitor gets a fair share of the free map services. */
  private readonly milesLimiter = new RateLimiter(150, 10 * 60_000);
  /** AI import previews waiting for "Import" (an hour at most). */
  private readonly importPlans = new Map<string, { at: number; plan: ImportPlan }>();

  constructor(private readonly checks: CompanyCheckService, private readonly telegram: TelegramService, private readonly lookup: LookupService, private readonly eld: EldSyncService, private readonly qbo: QboService, private readonly inbox: InboxService, private readonly mcp: McpService) {
    const pool = db();
    this.store = pool ? new CrmStore(pool) : null;
  }

  @Get('config')
  settings() {
    return { googleClientId: config.googleClientId, devLogin: config.crmDevLogin, enabled: !!this.store, emailAuth: !!this.store && mailReady(), ai: aiEnabled(), loadAlerts: this.inbox.enabled() };
  }

  @Post('auth/google')
  @HttpCode(200)
  async google(@Body() body: { credential?: string }, @Res({ passthrough: true }) res: Response) {
    const store = this.need();
    const profile = await verifyGoogleIdToken(String(body?.credential ?? ''), config.googleClientId);
    if (!profile) throw new UnauthorizedException('Google sign-in failed, please try again');
    return this.startSession(res, await store.signIn(profile));
  }

  /**
   * Sign up with email, like other TMSs: name, company, what kind of business, MC/DOT, phone, password.
   * The account works after the emailed 6-digit code is entered (POST auth/verify).
   */
  @Post('auth/signup')
  @HttpCode(200)
  async signUp(@Req() req: Request, @Body() b: Record<string, unknown>) {
    const store = this.need();
    this.limit(req);
    const email = normEmail(text(b.email, 200));
    const name = text(b.name, 80);
    const password = String(b.password ?? '');
    const company = companyInput(b);
    if (!name) throw new BadRequestException('Enter your name');
    if (!emailOk(email)) throw new BadRequestException('Enter a valid email');
    const weak = passwordProblem(password);
    if (weak) throw new BadRequestException(weak);
    // Someone invited to a board joins that company: no company of their own to fill in.
    const invite = b.invite ? await store.invite(text(b.invite, 100)) : null;
    const invited = !!invite && invite.email.toLowerCase() === email;
    if (!invited && !company.name) throw new BadRequestException('Enter your company name');
    if (!invited && !company.type) throw new BadRequestException('Choose what your company does');
    const user = await store.signUp({ email, name, passwordHash: await hashPassword(password), phone: company.phone, company });
    if (!user) throw new ConflictException('An account with this email already exists — log in instead');
    await this.sendCode(email, 'verify', name);
    return { verify: true, email };
  }

  /** The emailed code confirms the address and signs in. */
  @Post('auth/verify')
  @HttpCode(200)
  async verify(@Req() req: Request, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const store = this.need();
    this.limit(req);
    const email = normEmail(text(b.email, 200));
    const user = await store.findByEmail(email);
    await this.checkCode(email, 'verify', text(b.code, 12));
    if (!user) throw new BadRequestException('Sign up again, please');
    await store.markVerified(user.id);
    return this.startSession(res, user);
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Req() req: Request, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const store = this.need();
    this.limit(req);
    const email = normEmail(text(b.email, 200));
    const user = emailOk(email) ? await store.findByEmail(email) : null;
    // Without an account the password is still hashed, so the answer takes as long either way.
    const ok = user?.passwordHash ? await checkPassword(String(b.password ?? ''), user.passwordHash) : (await hashPassword('x'), false);
    if (!user || !ok) {
      if (user && !user.passwordHash && user.googleSub) throw new UnauthorizedException('This account uses Google — tap “Continue with Google”, or reset the password to add one');
      throw new UnauthorizedException('Wrong email or password');
    }
    if (!user.verified) {
      await this.sendCode(email, 'verify', user.name);
      return { verify: true, email };
    }
    return this.startSession(res, user);
  }

  /** Sends a new verification or reset code. Always answers the same, so it can't be used to find out who has an account. */
  @Post('auth/resend')
  @HttpCode(200)
  async resend(@Req() req: Request, @Body() b: Record<string, unknown>) {
    const store = this.need();
    this.limit(req);
    const email = normEmail(text(b.email, 200));
    const purpose: CodePurpose = b.purpose === 'reset' ? 'reset' : 'verify';
    const user = emailOk(email) ? await store.findByEmail(email) : null;
    if (user && (purpose === 'reset' || !user.verified)) await this.sendCode(email, purpose, user.name);
    return { ok: true };
  }

  /** "Forgot password?": emails a reset code if the account exists (same answer either way). */
  @Post('auth/forgot')
  @HttpCode(200)
  async forgot(@Req() req: Request, @Body() b: Record<string, unknown>) {
    return this.resend(req, { email: b.email, purpose: 'reset' });
  }

  @Post('auth/reset')
  @HttpCode(200)
  async reset(@Req() req: Request, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const store = this.need();
    this.limit(req);
    const email = normEmail(text(b.email, 200));
    const password = String(b.password ?? '');
    const weak = passwordProblem(password);
    if (weak) throw new BadRequestException(weak);
    await this.checkCode(email, 'reset', text(b.code, 12));
    const user = await store.findByEmail(email);
    if (!user) throw new BadRequestException('Request a new code');
    await store.setPassword(user.id, await hashPassword(password));
    return this.startSession(res, user);
  }

  /** Company details after Google sign-up (or edits later). */
  @Post('company')
  @HttpCode(200)
  async setCompany(@Req() req: Request, @Body() b: Record<string, unknown>) {
    const { user } = await this.owner(req);
    const company = companyInput(b);
    if (!company.name) throw new BadRequestException('Enter your company name');
    if (!company.type) throw new BadRequestException('Choose what your company does');
    await this.store!.setCompany(user.id, company);
    return company;
  }

  /** Local development only (CRM_DEV_LOGIN=1, never on Render): sign in without Google. */
  @Post('auth/dev')
  @HttpCode(200)
  async dev(@Body() body: { name?: string }, @Res({ passthrough: true }) res: Response) {
    if (!config.crmDevLogin) throw new ForbiddenException();
    const name = String(body?.name ?? 'Dev user').slice(0, 60);
    const user = await this.need().signIn({ sub: `dev:${name}`, email: `${name.replace(/\W+/g, '.').toLowerCase()}@dev.local`, name, picture: '' });
    return this.startSession(res, user);
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readCookie(req, COOKIE);
    if (token && this.store) await this.store.endSession(token);
    res.clearCookie(COOKIE, { path: '/api/crm' });
    return { ok: true };
  }

  /** Who is signed in, for the site header on every page (never an error: signed out is `{ user: null }`). */
  @Get('me')
  async me(@Req() req: Request) {
    const token = readCookie(req, COOKIE);
    const s = token && this.store ? await this.store.session(token).catch(() => null) : null;
    return { user: s ? { id: s.user.id, email: s.user.email, name: s.user.name, picture: s.user.picture } : null };
  }

  @Get('state')
  async state(@Req() req: Request) {
    return this.scopedState(await this.auth(req));
  }

  // AI (Claude), when ANTHROPIC_API_KEY is set

  /** A rate confirmation (PDF or photo, raw bytes) read into the fields of a new load. */
  @Post('ai/ratecon')
  @HttpCode(200)
  async aiRateCon(@Req() req: Request, @Body() body: unknown) {
    const { ws } = await this.auth(req);
    if (!aiEnabled()) throw new ServiceUnavailableException('AI is not switched on');
    if (!Buffer.isBuffer(body) || !body.length) throw new BadRequestException('Send the rate con as application/octet-stream');
    if (body.length > 10 * 1024 * 1024) throw new BadRequestException('The file is over 10 MB');
    const type = sniff(body);
    if (!type) throw new BadRequestException('Send a PDF or a photo (JPEG or PNG)');
    if (!this.aiLimiter.take(`ws:${ws}`)) throw new HttpException('Too many AI requests this hour, try again later', 429);
    try {
      return await readRateCon(body, type, new Date().toISOString().slice(0, 10));
    } catch (e) {
      throw new ServiceUnavailableException((e as Error).message);
    }
  }

  /**
   * A BOL or POD (PDF or photo, raw bytes): AI reads it and the board finds the load it belongs to. Nothing is saved
   * here — the screen shows what was read and the match, and the person saves it (upload + status) with one click.
   */
  @Post('ai/doc')
  @HttpCode(200)
  async aiDoc(@Req() req: Request, @Body() body: unknown) {
    const s = await this.auth(req);
    if (!aiEnabled()) throw new ServiceUnavailableException('AI is not switched on');
    if (!Buffer.isBuffer(body) || !body.length) throw new BadRequestException('Send the document as application/octet-stream');
    if (body.length > 10 * 1024 * 1024) throw new BadRequestException('The file is over 10 MB');
    const type = sniff(body);
    if (!type) throw new BadRequestException('Send a PDF or a photo (JPEG or PNG)');
    if (!this.aiLimiter.take(`ws:${s.ws}`)) throw new HttpException('Too many AI requests this hour, try again later', 429);
    let doc;
    try {
      doc = await readDeliveryDoc(body, type, new Date().toISOString().slice(0, 10));
    } catch (e) {
      throw new ServiceUnavailableException((e as Error).message);
    }
    const st = await this.scopedState(s);
    return { doc, match: matchDoc(doc, st.loads, st.files) };
  }

  /** The message, file and chat of an AI request (checked before anything is sent to the AI). */
  private async aiInput(s: Scope, b: { threadId?: string; text?: string; file?: { name?: string; data?: string }; loadId?: number }) {
    if (!aiEnabled()) throw new ServiceUnavailableException('AI is not switched on');
    const textIn = text(b?.text, 4000);
    let file: { name: string; mime: string; data: Buffer } | null = null;
    if (b?.file?.data) {
      const data = Buffer.from(String(b.file.data), 'base64');
      const mime = sniff(data);
      if (!mime) throw new BadRequestException('Send a PDF or a photo (JPEG or PNG)');
      if (data.length > 8 * 1024 * 1024) throw new BadRequestException('The file is over 8 MB');
      file = { name: text(b.file.name, 120) || 'document', mime, data };
    }
    if (!textIn && !file) throw new BadRequestException('Write a message');
    if (!this.aiLimiter.take(`ws:${s.ws}`)) throw new HttpException('Too many AI requests this hour, try again later', 429);
    const t = (b?.threadId && (await this.store!.aiThread(s.ws, s.user.id, text(b.threadId, 60)))) || newThread();
    if (t.messages.length > 160) throw new BadRequestException('This chat is long — start a new chat');
    return { t, input: { text: textIn, file, loadId: Number.isInteger(b?.loadId) ? (b.loadId as number) : null } };
  }

  /**
   * Server-sent events: every step of the assistant's work as it happens (steps, text, cards, changes), then the saved
   * chat. Closing the connection (the Stop button) stops the assistant; what it did so far is kept.
   */
  private async streamAi(res: Response, s: Scope, t: Thread, run: (emit: Emit, signal: AbortSignal) => Promise<void>) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const send = (e: object) => { if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(e)}\n\n`); };
    send({ type: 'start', threadId: t.id });
    const ping = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n'); }, 15_000);
    try {
      await run(send, ac.signal);
    } catch (e) {
      send({ type: 'error', message: (e as Error).message });
    } finally {
      clearInterval(ping);
      await this.store!.saveAiThread(s.ws, s.user.id, t).catch(() => undefined);
      send({ type: 'done', view: aiView(t) });
      if (!res.writableEnded) res.end();
    }
  }

  /**
   * The AI assistant (the board's main screen): it works the board with tools, makes board changes itself (each can
   * be undone) and prepares emails that wait for an OK. The conversation is kept per user (crm_ai_threads).
   * Body: { threadId?, text, file?: { name, data (base64) }, loadId? }. `ai/chat/stream` shows the work live.
   */
  @Post('ai/chat')
  @HttpCode(200)
  async aiChat(@Req() req: Request, @Body() b: { threadId?: string; text?: string; file?: { name?: string; data?: string }; loadId?: number }) {
    const s = await this.auth(req);
    const { t, input } = await this.aiInput(s, b);
    const ctx = this.agentCtx(s);
    try {
      await chat(ctx, t, boardContext(await ctx.state(), s), input);
    } catch (e) {
      await this.store!.saveAiThread(s.ws, s.user.id, t);
      throw new ServiceUnavailableException((e as Error).message);
    }
    await this.store!.saveAiThread(s.ws, s.user.id, t);
    return aiView(t);
  }

  @Post('ai/chat/stream')
  async aiChatStream(@Req() req: Request, @Res() res: Response, @Body() b: { threadId?: string; text?: string; file?: { name?: string; data?: string }; loadId?: number }) {
    const s = await this.auth(req);
    const { t, input } = await this.aiInput(s, b);
    const ctx = this.agentCtx(s);
    const board = boardContext(await ctx.state(), s);
    await this.streamAi(res, s, t, (emit, signal) => chat(ctx, t, board, input, emit, signal));
  }

  /** The user answers an email waiting for their OK (approve sends it). */
  @Post('ai/decide')
  @HttpCode(200)
  async aiDecide(@Req() req: Request, @Body() b: { threadId?: string; actionId?: string; approve?: boolean }) {
    const s = await this.auth(req);
    if (!aiEnabled()) throw new ServiceUnavailableException('AI is not switched on');
    const t = found(await this.store!.aiThread(s.ws, s.user.id, text(b?.threadId, 60)));
    const ctx = this.agentCtx(s);
    try {
      await decide(ctx, t, boardContext(await ctx.state(), s), text(b?.actionId, 100), b?.approve === true);
    } catch (e) {
      await this.store!.saveAiThread(s.ws, s.user.id, t);
      throw new ServiceUnavailableException((e as Error).message);
    }
    await this.store!.saveAiThread(s.ws, s.user.id, t);
    return aiView(t);
  }

  @Post('ai/decide/stream')
  async aiDecideStream(@Req() req: Request, @Res() res: Response, @Body() b: { threadId?: string; actionId?: string; approve?: boolean }) {
    const s = await this.auth(req);
    if (!aiEnabled()) throw new ServiceUnavailableException('AI is not switched on');
    const t = found(await this.store!.aiThread(s.ws, s.user.id, text(b?.threadId, 60)));
    const ctx = this.agentCtx(s);
    const board = boardContext(await ctx.state(), s);
    await this.streamAi(res, s, t, (emit, signal) => decide(ctx, t, board, text(b?.actionId, 100), b?.approve === true, emit, signal));
  }

  /** Takes back a change the assistant made by itself. */
  @Post('ai/undo')
  @HttpCode(200)
  async aiUndo(@Req() req: Request, @Body() b: { threadId?: string; actionId?: string }) {
    const s = await this.auth(req);
    const t = found(await this.store!.aiThread(s.ws, s.user.id, text(b?.threadId, 60)));
    const a = await undo(this.agentCtx(s), t, text(b?.actionId, 100));
    if (!a) throw new BadRequestException('Nothing to undo');
    await this.store!.saveAiThread(s.ws, s.user.id, t);
    return aiView(t);
  }

  /**
   * Moving a dispatch office in: files (Excel, CSV, PDF, photos, screenshots) and/or a Google Sheets link → what the
   * AI found, as a preview. Nothing is saved until `ai/import/apply`. Owner only. Body: { files: [{ name, data }], sheetUrl? }.
   */
  @Post('ai/import')
  @HttpCode(200)
  async aiImport(@Req() req: Request, @Body() b: { files?: { name?: string; data?: string }[]; sheetUrl?: string }) {
    const s = await this.owner(req);
    if (!aiEnabled()) throw new ServiceUnavailableException('AI is not switched on');
    const files: ImportFile[] = (Array.isArray(b?.files) ? b.files : []).slice(0, 10).map((f) => ({ name: text(f?.name, 120) || 'file', data: Buffer.from(String(f?.data ?? ''), 'base64') }))
      .filter((f) => f.data.length);
    if (files.some((f) => f.data.length > 15 * 1024 * 1024)) throw new BadRequestException('Each file must be under 15 MB');
    if (b?.sheetUrl) files.push(await googleSheet(text(b.sheetUrl, 500)));
    if (!files.length) throw new BadRequestException('Add a file or a Google Sheets link');
    for (let i = 0; i <= files.length; i++) if (!this.aiLimiter.take(`ws:${s.ws}`)) throw new HttpException('Too many AI requests this hour, try again later', 429);
    const plan = await planImport(await this.store!.state(s.ws, s.user), files);
    this.importPlans.set(`${s.ws}:${plan.id}`, { at: Date.now(), plan });
    for (const [k, v] of this.importPlans) if (Date.now() - v.at > 3600_000) this.importPlans.delete(k);
    return plan;
  }

  @Post('ai/import/apply')
  @HttpCode(200)
  async aiImportApply(@Req() req: Request, @Body() b: { id?: string; skip?: { loads?: number[] } }) {
    const s = await this.owner(req);
    const key = `${s.ws}:${text(b?.id, 60)}`;
    const saved = this.importPlans.get(key);
    if (!saved) throw new BadRequestException('This preview has expired — add the files again');
    const skip = new Set(Array.isArray(b?.skip?.loads) ? b.skip.loads : []);
    const plan = { ...saved.plan, loads: saved.plan.loads.filter((_, i) => !skip.has(i)) };
    const r = await this.store!.applyImport(s.ws, plan);
    this.importPlans.delete(key);
    for (const c of plan.carriers.filter((x) => x.mc && !x.existing).slice(0, 50)) this.checkCarrierSoon(s.ws, c.mc);
    return r;
  }

  /** The person's recent chats for the history list. */
  @Get('ai/threads')
  async aiThreads(@Req() req: Request) {
    const s = await this.auth(req);
    return this.store!.aiThreads(s.ws, s.user.id);
  }

  @Delete('ai/thread/:id')
  async aiDeleteThread(@Req() req: Request, @Param('id') id: string) {
    const s = await this.auth(req);
    await this.store!.deleteAiThread(s.ws, s.user.id, text(id, 60));
    return { ok: true };
  }

  @Get('ai/thread/:id')
  async aiThread(@Req() req: Request, @Param('id') id: string) {
    const s = await this.auth(req);
    return aiView(found(await this.store!.aiThread(s.ws, s.user.id, text(id, 60))));
  }

  /** What the assistant may do: the board as this person sees it, and the same actions the board has (same rules). */
  private agentCtx(s: Scope): AgentCtx {
    const mine = <T extends { dispatcherId: number | null }>(l: T): T => (s.role === 'owner' ? l : { ...l, dispatcherId: s.dispatcherId });
    return {
      state: async () => this.scopedState(s),
      check: (mc, role) => this.checks.check(mc, role),
      lookup: async (q) => {
        const parsed = parseLookupQuery(q, 'auto');
        if (!parsed) return [];
        const r = await this.lookup.lookup(q, parsed);
        return r.profiles.slice(0, 5).map((p) => ({
          name: p.legalName, dba: p.dbaName, mc: p.mc, dot: p.dot, usdot_status: p.usdotStatus, state: p.state, phone: p.phone, email: p.email,
          power_units: p.powerUnits, drivers: p.drivers, added_on: p.addedOn, safety_rating: p.safetyRating,
          authority: p.authority ? { common: p.authority.common, contract: p.authority.contract, broker: p.authority.broker, bipd_on_file: p.authority.bipdOnFile, bond_on_file: p.authority.bondOnFile } : null,
        }));
      },
      lane: async (a, z) => { const r = await this.milesService.lane(a, z); return r && { miles: r.miles, hours: r.hours }; },
      createLoad: (l) => this.store!.addLoad(s.ws, mine(l)),
      updateLoad: async (id, l) => { await this.loadAccess(s, id); return this.store!.updateLoad(s.ws, id, mine(l)); },
      sendInvoice: (id, to, attach) => this.loadAccess(s, id).then(() => this.emailInvoice(s, id, to, [], attach, true, '')),
      sendFactoring: (id, attach, to) => this.factorPacket(s, id, to ?? '', '', [], attach, ''),
      emailBroker: (to, subject, body) => this.brokerEmail(s, to, subject, body),
      addCarrier: async (c) => { if (s.role !== 'owner') throw new Error('Only the owner can add carriers here'); this.checkCarrierSoon(s.ws, c.mc); return this.store!.addCarrier(s.ws, c); },
      trackingLink: async (id) => {
        await this.loadAccess(s, id);
        return `${config.publicUrl || 'https://haulpanel.com'}/#/track/${found(await this.store!.trackingToken(s.ws, id))}`;
      },
      attachFile: async (id, name, mime, data, kind = 'ratecon') => { await this.loadAccess(s, id); return found(await this.store!.addFile(s.ws, id, { kind, name, mime, data })); },
      deleteFile: async (id) => { const f = await this.store!.file(s.ws, id); if (!f) return; await this.loadAccess(s, f.loadId); await this.store!.deleteFile(s.ws, id); },
      deleteLoad: async (id) => { await this.loadAccess(s, id); await this.store!.deleteLoad(s.ws, id); },
      archiveCarrier: async (id) => { if (s.role !== 'owner') throw new Error('Only the owner can remove carriers'); await this.store!.archiveCarrier(s.ws, id); },
      mcp: () => this.mcp.forAi(s.ws),
    };
  }

  /** The board as this person may see it: the owner sees everything, an invited dispatcher only their own loads. */
  private async scopedState(s: Scope) {
    const [base, eld] = await Promise.all([this.store!.state(s.ws, s.user), this.eld.store?.units(s.ws).catch(() => []) ?? []]);
    const st = { ...base, eld };
    const me = { role: s.role, dispatcherId: s.dispatcherId };
    if (s.role === 'owner') return { ...st, me, team: await this.store!.team(s.ws) };
    // An invited dispatcher sees the board's carriers and trucks, but only their own loads, documents and pay.
    const loads = st.loads.filter((l) => l.dispatcherId != null && l.dispatcherId === s.dispatcherId);
    const ids = new Set(loads.map((l) => l.id));
    return {
      ...st, me, loads,
      dispatchers: st.dispatchers.filter((d) => d.id === s.dispatcherId),
      files: st.files.filter((f) => f.loadId != null && ids.has(f.loadId)),
      invoices: st.invoices.filter((i) => ids.has(i.loadId)),
    };
  }

  // Load alerts inbox: load-board alerts and broker load lists sent to the board's address, matched to its trucks

  @Get('inbox')
  async inboxView(@Req() req: Request) {
    const { ws } = await this.auth(req);
    const store = this.inbox.store;
    if (!store) throw new ServiceUnavailableException('The inbox is not available');
    const settings = await store.settings(ws);
    const [rows, messages] = await Promise.all([store.postings(ws), store.messages(ws)]);
    const postings = await this.inbox.refit(ws, rows);
    return {
      enabled: this.inbox.enabled(), ai: aiEnabled(), address: this.inbox.enabled() ? this.inbox.address(settings.token) : '',
      settings: { autoEmail: settings.autoEmail, minRpm: settings.minRpm, maxDeadhead: settings.maxDeadhead, dailyCap: settings.dailyCap },
      postings, messages,
    };
  }

  @Patch('inbox/settings')
  async inboxSettings(@Req() req: Request, @Body() b: Record<string, unknown>) {
    const { ws } = await this.owner(req);
    const n = (v: unknown, min: number, max: number, dflt: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : dflt; };
    await this.inbox.store!.saveSettings(ws, { autoEmail: b.autoEmail === true, minRpm: n(b.minRpm, 0, 20, 2.5), maxDeadhead: Math.round(n(b.maxDeadhead, 0, 1000, 150)), dailyCap: Math.round(n(b.dailyCap, 0, 200, 40)) });
    return { ok: true };
  }

  /** The email to the broker about a posting, ready to send (the dispatcher may edit it). */
  @Get('inbox/postings/:id/draft')
  async postingDraft(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws, user } = await this.auth(req);
    const p = found(await this.inbox.store!.posting(ws, id));
    return { to: p.data.email, ...(await this.inbox.draft(ws, p, user.name)) };
  }

  @Post('inbox/postings/:id/email')
  @HttpCode(200)
  async emailPosting(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() b: Record<string, unknown>) {
    const scope = await this.auth(req);
    const subject = text(b.subject, 200), body = text(b.body, 4000);
    if (!subject || !body) throw new BadRequestException('Write the subject and the message');
    if (!this.mailHourly.take(`broker:${scope.ws}`)) throw new HttpException('Too many emails this hour, try again later', 429);
    try {
      return { ok: true, ...(await this.inbox.emailPosting(scope.ws, scope.user, id, subject, body)) };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Post('inbox/postings/:id/dismiss')
  @HttpCode(200)
  async dismissPosting(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.auth(req);
    await this.inbox.store!.dismiss(ws, id);
    return { ok: true };
  }

  /** Try it without email: paste an alert or a broker's load list, it's read like an email to the board's address. */
  @Post('inbox/paste')
  @HttpCode(200)
  async pasteEmail(@Req() req: Request, @Body() b: Record<string, unknown>) {
    const { ws } = await this.owner(req);
    if (!aiEnabled()) throw new ServiceUnavailableException('AI is not switched on');
    const body = text(b.text, 40_000);
    if (body.length < 20) throw new BadRequestException('Paste the whole email or load list');
    if (!this.aiLimiter.take(`ws:${ws}`)) throw new HttpException('Too many AI requests this hour, try again later', 429);
    try {
      const r = await this.inbox.process(ws, { from: '(pasted)', to: [], subject: text(b.subject, 200) || 'Pasted load list', text: body, html: '', attachments: [] });
      return { ok: true, kind: r.kind, postings: r.postings.length, loadId: r.loadId ?? null };
    } catch (e) {
      throw new ServiceUnavailableException((e as Error).message);
    }
  }

  // Integrations: ELD (Samsara now; Motive once Motive approves HaulPanel), more partners next

  @Get('integrations')
  async integrations(@Req() req: Request) {
    const { ws } = await this.auth(req);
    const store = this.eld.store;
    return {
      ready: !!store && vaultReady(),
      providers: this.eld.providers(),
      quickbooks: this.qbo.enabled(),
      connections: store ? await store.connections(ws) : [],
      units: store ? await store.units(ws) : [],
      /** Services the owner can connect for the AI assistant through their own MCP server. */
      mcp: this.mcp.enabled() ? this.mcp.apps().map((a) => a.id) : [],
    };
  }

  /** Starts connecting a service's MCP server: the page goes to the service's sign-in, which calls back below. */
  @Post('integrations/mcp/:app/connect')
  @HttpCode(200)
  async mcpConnect(@Req() req: Request, @Param('app') app: string) {
    const { ws } = await this.owner(req);
    if (!this.mcp.enabled()) throw new ServiceUnavailableException('Integrations are not switched on yet');
    try {
      return { url: await this.mcp.start(ws, text(app, 40)) };
    } catch (e) {
      if (e instanceof McpError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Get('integrations/mcp/callback')
  async mcpCallback(@Req() req: Request, @Res() res: Response, @Query('code') code = '', @Query('state') state = '', @Query('error') error = '', @Query('error_description') desc = '') {
    const back = (msg: string, app = '') => res.redirect(302, `/#/crm?integrations=${encodeURIComponent(msg)}${app ? `&app=${encodeURIComponent(app)}` : ''}`);
    if (error) return back(error === 'access_denied' ? 'Not connected — the sign-in was cancelled' : `Not connected: ${desc || error}`);
    try {
      const { ws } = await this.owner(req);
      const r = await this.mcp.finish(text(state, 100), text(code, 2000), ws);
      return back(`${r.app.name} connected${r.tools ? ` — ${r.tools} tools for the AI assistant` : ''}`, r.app.id);
    } catch (e) {
      return back((e as Error).message);
    }
  }

  /** What the AI assistant can do in a connected service now. */
  @Get('integrations/mcp/:app/tools')
  async mcpTools(@Req() req: Request, @Param('app') app: string) {
    const { ws } = await this.auth(req);
    try {
      return { tools: await this.mcp.tools(ws, text(app, 40)) };
    } catch (e) {
      if (e instanceof McpError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /** Connects an ELD with the carrier's own token: it's checked against the ELD right away and the fleet is read. */
  @Post('integrations/eld/:provider')
  @HttpCode(200)
  async connectEld(@Req() req: Request, @Param('provider') provider: string, @Body() b: Record<string, unknown>) {
    const { ws } = await this.owner(req);
    const p = this.eldProvider(provider);
    const token = text(b.token, 500).replace(/^Bearer\s+/i, '');
    if (token.length < 10) throw new BadRequestException(p === 'samsara' ? 'Paste the API token from Samsara (Settings → API Tokens)' : 'Paste the API key from Motive (Admin → Developers → API Access)');
    const region = (['us', 'eu', 'ca'].includes(String(b.region)) ? b.region : 'us') as EldRegion;
    if (!this.authLimiter.take(`eld:${ws}`)) throw new HttpException('Too many tries, wait a few minutes', 429);
    try {
      const r = await this.eld.sync(ws, { provider: p, region, token });
      // Saved only after the ELD accepted it; the first sync above already filled the map.
      await this.eld.store!.connect(ws, p, region, token);
      return { ok: true, ...r };
    } catch (e) {
      if (e instanceof EldError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Post('integrations/eld/:provider/sync')
  @HttpCode(200)
  async syncEld(@Req() req: Request, @Param('provider') provider: string) {
    const { ws } = await this.auth(req);
    const p = this.eldProvider(provider);
    const c = (await this.eld.store!.allOf([p])).find((x) => x.ws === ws);
    if (!c) throw new NotFoundException('Not connected');
    try {
      return { ok: true, ...(await this.eld.sync(ws, { provider: p, region: c.region as EldRegion, token: c.secret })) };
    } catch (e) {
      if (e instanceof EldError) {
        if (e.auth) await this.eld.store!.markError(ws, p, e.message);
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  @Delete('integrations/:provider')
  async disconnect(@Req() req: Request, @Param('provider') provider: string) {
    const { ws } = await this.owner(req);
    if (provider === 'quickbooks') await this.qbo.disconnect(ws);
    else if (/^mcp:[a-z0-9]{2,30}$/.test(provider) && this.eld.store) await this.eld.store.disconnect(ws, provider);
    else await this.eld.store!.disconnect(ws, this.eldProvider(provider));
    return { ok: true };
  }

  /** Starts connecting QuickBooks: the page goes to this Intuit address, the owner approves, Intuit calls back. */
  @Post('integrations/quickbooks/connect')
  @HttpCode(200)
  async qboConnect(@Req() req: Request) {
    const { ws, user } = await this.owner(req);
    if (!this.qbo.enabled()) throw new ServiceUnavailableException('QuickBooks connection isn’t switched on yet');
    return { url: this.qbo.start(ws, user.id) };
  }

  /** Intuit sends the owner back here; the code is turned into tokens and the page goes back to Integrations. */
  @Get('integrations/quickbooks/callback')
  async qboCallback(@Req() req: Request, @Res() res: Response, @Query('code') code = '', @Query('state') state = '', @Query('realmId') realmId = '', @Query('error') error = '') {
    const back = (msg: string) => res.redirect(302, `/#/crm?integrations=${encodeURIComponent(msg)}`);
    if (error) return back(error === 'access_denied' ? 'QuickBooks was not connected' : 'QuickBooks couldn’t connect');
    try {
      const { ws, user } = await this.owner(req);
      const r = await this.qbo.finish(state, code, realmId, user.id);
      void this.qbo.pushExisting(ws, user).catch(() => undefined);
      return back(`QuickBooks connected${r.company ? `: ${r.company}` : ''}`);
    } catch (e) {
      return back((e as Error).message);
    }
  }

  /** Sends invoices not in QuickBooks yet and marks loads paid that QuickBooks shows paid. */
  @Post('integrations/quickbooks/sync')
  @HttpCode(200)
  async qboSync(@Req() req: Request) {
    const { ws, user } = await this.owner(req);
    if (!this.qbo.enabled()) throw new ServiceUnavailableException('QuickBooks connection isn’t switched on yet');
    try {
      const pushed = await this.qbo.pushExisting(ws, user);
      const paid = await this.qbo.syncPayments(ws);
      return { ok: true, pushed, paid };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Links an ELD vehicle to a board truck (truckId), to none (null), or makes a new truck from it (create: true). */
  @Patch('integrations/eld/:provider/units/:vehicleId')
  async linkUnit(@Req() req: Request, @Param('provider') provider: string, @Param('vehicleId') vehicleId: string, @Body() b: Record<string, unknown>) {
    const { ws } = await this.owner(req);
    const p = this.eldProvider(provider);
    let truckId = b.truckId == null ? null : Number(b.truckId);
    if (b.create) {
      const u = (await this.eld.store!.units(ws)).find((x) => x.provider === p && x.vehicleId === vehicleId);
      if (!u) throw new NotFoundException();
      truckId = (await this.store!.addTruck(ws, { carrierId: null, unit: (u.name.replace(/^\s*(fleet\s+)?(truck|tractor|unit|trk)\s*#?\s*/i, '') || u.name || vehicleId).slice(0, 40), driver: u.driver.slice(0, 80), phone: '' })).id;
    }
    if (truckId != null && !Number.isInteger(truckId)) throw new BadRequestException('Unknown truck');
    if (!(await this.eld.store!.link(ws, p, vehicleId, truckId))) throw new NotFoundException();
    return { ok: true, truckId };
  }

  private eldProvider(p: string): EldProvider {
    if (!(ELD_PROVIDERS as string[]).includes(p)) throw new NotFoundException();
    if (!this.eld.store || !vaultReady()) throw new ServiceUnavailableException('Integrations are not switched on yet');
    if (!this.eld.providers().includes(p as EldProvider)) throw new BadRequestException('Motive connections open once Motive approves HaulPanel as a partner');
    return p as EldProvider;
  }


  /** Invites a dispatcher of this board by email: they get a link to sign up (or log in) and join. */
  @Post('invites')
  @HttpCode(200)
  async invite(@Req() req: Request, @Body() b: Record<string, unknown>) {
    const { ws, user } = await this.owner(req);
    const email = normEmail(text(b.email, 200));
    if (!emailOk(email)) throw new BadRequestException('Enter the dispatcher’s email');
    if (email === user.email.toLowerCase()) throw new BadRequestException('That is your own email');
    if (!this.mailHourly.take(`invite:${ws}`)) throw new HttpException('Too many invites this hour, try again later', 429);
    let r;
    try {
      r = await this.store!.createInvite(ws, email, Number(b.dispatcherId));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const st = await this.store!.company(ws);
    const company = st.name || user.name;
    const link = `${config.publicUrl || 'https://haulpanel.com'}/#/crm?invite=${r.token}`;
    await sendMail({
      to: email, fromName: `${company} via HaulPanel`, replyTo: user.email,
      subject: `${user.name || company} invited you to ${company}’s dispatch board`,
      text: `Hi,\n\n${user.name || company} invited you to work on ${company}’s dispatch board in HaulPanel: your loads, miles and rate per mile, documents and pay in one place.\n\nJoin here (the link works for 7 days):\n${link}\n\n— HaulPanel team`,
      html: `<p>Hi,</p><p><b>${esc(user.name || company)}</b> invited you to work on <b>${esc(company)}</b>’s dispatch board in HaulPanel: your loads, miles and rate per mile, documents and pay in one place.</p><p><a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600">Join the board</a></p><p style="color:#64748b">The link works for 7 days.</p><p>— HaulPanel team</p>`,
    });
    return r.invite;
  }

  @Delete('invites/:id')
  async removeInvite(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.owner(req);
    await this.store!.removeInvite(ws, id);
    return { ok: true };
  }

  @Delete('members/:userId')
  async removeMember(@Req() req: Request, @Param('userId', ParseIntPipe) userId: number) {
    const { ws } = await this.owner(req);
    await this.store!.removeMember(ws, userId);
    return { ok: true };
  }

  /** What an invite link is for, shown before signing in. */
  @Get('invites/:token')
  async inviteInfo(@Req() req: Request, @Param('token') token: string) {
    this.limit(req);
    const i = await this.need().invite(text(token, 100));
    if (!i) throw new NotFoundException('This invite link has expired or was already used — ask for a new one');
    return { email: i.email, company: i.company, dispatcher: i.dispatcher };
  }

  /** The signed-in user joins the board they were invited to (the invite must be for their email). */
  @Post('invites/accept')
  @HttpCode(200)
  async acceptInvite(@Req() req: Request, @Body() b: { token?: string }) {
    const { user } = await this.auth(req);
    const i = await this.store!.invite(text(b?.token, 100));
    if (!i) throw new NotFoundException('This invite link has expired or was already used — ask for a new one');
    if (i.email.toLowerCase() !== user.email.toLowerCase()) throw new ForbiddenException(`This invite is for ${i.email} — sign in with that email`);
    await this.store!.acceptInvite(i.id, i.ws, user.id, i.dispatcherId);
    return { ok: true, company: i.company };
  }

  // Dispatchers

  @Post('dispatchers')
  async addDispatcher(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { ws } = await this.owner(req);
    const d = dispatcherInput(body);
    return this.store!.addDispatcher(ws, d.name, d.percent);
  }

  @Patch('dispatchers/:id')
  async updateDispatcher(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const { ws } = await this.owner(req);
    const d = dispatcherInput(body);
    return found(await this.store!.updateDispatcher(ws, id, d.name, d.percent));
  }

  @Delete('dispatchers/:id')
  async archiveDispatcher(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.owner(req);
    await this.store!.archiveDispatcher(ws, id);
    return { ok: true };
  }

  // Carriers

  @Post('carriers')
  async addCarrier(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    const c = carrierInput(body);
    this.checkCarrierSoon(ws, c.mc);
    return this.store!.addCarrier(ws, c);
  }

  @Patch('carriers/:id')
  async updateCarrier(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    const c = carrierInput(body);
    this.checkCarrierSoon(ws, c.mc);
    return found(await this.store!.updateCarrier(ws, id, c));
  }

  @Delete('carriers/:id')
  async archiveCarrier(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.owner(req);
    await this.store!.archiveCarrier(ws, id);
    return { ok: true };
  }

  // Trucks

  @Post('trucks')
  async addTruck(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    return this.store!.addTruck(ws, truckInput(body));
  }

  @Patch('trucks/:id')
  async updateTruck(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    return found(await this.store!.updateTruck(ws, id, truckInput(body)));
  }

  @Delete('trucks/:id')
  async archiveTruck(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.owner(req);
    await this.store!.archiveTruck(ws, id);
    return { ok: true };
  }

  /** US cities matching what is typed in a lane field, e.g. ?q=santa mo → Santa Monica, CA. */
  @Get('places')
  places(@Query('q') q = '') {
    return q.length > 60 ? [] : this.placesService.suggest(q).map((p) => p.label);
  }

  /** Driving miles between two places, e.g. ?from=Dallas, TX&to=Atlanta, GA. */
  @Get('miles')
  async miles(@Req() req: Request, @Query('from') from = '', @Query('to') to = '') {
    if (!from.trim() || !to.trim() || from.length > 200 || to.length > 200) throw new BadRequestException('Enter both places');
    if (!this.milesLimiter.take(ipOf(req))) throw new HttpException('Too many mileage lookups, try again in a few minutes', 429);
    let r;
    try {
      r = await this.milesService.miles(from, to);
    } catch {
      throw new ServiceUnavailableException('Maps are not answering right now, try again in a minute');
    }
    if (!r) throw new NotFoundException(`Could not find "${from}" or "${to}" on the map`);
    return r;
  }

  /**
   * FMCSA check of a broker or carrier by MC: authority, bond / insurance, age, revocations, safety rating.
   * Public like the company lookup; for a signed-in board the result is kept (carriers are then re-checked daily).
   */
  @Get('check')
  async check(@Req() req: Request, @Query('mc') mc = '', @Query('role') role = 'broker') {
    const digits = mc.replace(/\D/g, '');
    if (digits.length < 3 || digits.length > 8) throw new BadRequestException('Enter an MC number');
    if (!this.milesLimiter.take(ipOf(req))) throw new HttpException('Too many checks, try again in a few minutes', 429);
    let r;
    try {
      r = await this.checks.check(digits, role === 'carrier' ? 'carrier' : 'broker');
    } catch {
      throw new ServiceUnavailableException('FMCSA is not answering right now, try again in a minute');
    }
    if (!r) throw new NotFoundException(`No company with MC ${digits} in FMCSA records`);
    const s = this.store ? await this.store.session(readCookie(req, COOKIE)).catch(() => null) : null;
    if (s) await this.store!.saveCheck(s.workspaceId, r).catch(() => undefined);
    return r;
  }

  /** Checks a carrier as soon as its MC is saved, so the board shows the result right away. */
  private checkCarrierSoon(ws: number, mc: string) {
    const digits = mc.replace(/\D/g, '');
    if (digits.length < 3 || digits.length > 8) return;
    void this.checks.check(digits, 'carrier').then((r) => r && this.store!.saveCheck(ws, r)).catch(() => undefined);
  }

  /** A lane for the map in the load panel: both ends, the road line, miles and driving hours. Public like miles. */
  /** Where one truck of this board has been in the last hours (the breadcrumb trail on the fleet map). */
  @Get('trucks/:id/trail')
  async trail(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Query('hours') hours = '24') {
    const s = await this.auth(req);
    return { points: await this.store!.trail(s.ws, id, Number(hours) || 24) };
  }

  @Get('lane')
  async lane(@Req() req: Request, @Query('from') from = '', @Query('to') to = '') {
    if (!from.trim() || !to.trim() || from.length > 200 || to.length > 200) throw new BadRequestException('Enter both places');
    if (!this.milesLimiter.take(ipOf(req))) throw new HttpException('Too many map lookups, try again in a few minutes', 429);
    const r = await this.milesService.lane(from, to).catch(() => null);
    if (!r) throw new NotFoundException(`Could not find "${from}" or "${to}" on the map`);
    return r;
  }

  /** Map points of up to 200 places for the board map: { "Dallas, TX": [lon, lat] | null }. */
  @Post('points')
  @HttpCode(200)
  async points(@Req() req: Request, @Body() body: { places?: unknown }) {
    const places = [...new Set((Array.isArray(body?.places) ? body.places : []).map((p) => text(p, 200)).filter(Boolean))].slice(0, 200);
    if (!this.milesLimiter.take(ipOf(req))) throw new HttpException('Too many map lookups, try again in a few minutes', 429);
    return this.milesService.points(places);
  }

  // Documents of a load

  /** Upload: raw bytes (application/octet-stream), ?kind=pod&name=POD.pdf&mime=application/pdf. PDF, JPEG or PNG, up to 10 MB. */
  @Post('loads/:id/files')
  async addFile(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: unknown,
    @Query('kind') kind = 'other', @Query('name') name = '') {
    const scope = await this.auth(req);
    const { ws } = scope;
    await this.loadAccess(scope, id);
    if (!Buffer.isBuffer(body) || !body.length) throw new BadRequestException('Send the file as application/octet-stream');
    if (body.length > 10 * 1024 * 1024) throw new BadRequestException('The file is over 10 MB');
    const type = sniff(body);
    if (!type) throw new BadRequestException('Only PDF, JPEG and PNG files can be attached');
    const k = (FILE_KINDS as readonly string[]).includes(kind) ? (kind as FileKind) : 'other';
    const clean = text(name, 120).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() || `${k}.${type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg'}`;
    try {
      return found(await this.store!.addFile(ws, id, { kind: k, name: clean, mime: type, data: body }));
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }

  @Get('files/:id')
  async getFile(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Query('download') download = '') {
    const scope = await this.auth(req);
    const f = found(await this.store!.file(scope.ws, id));
    await this.loadAccess(scope, f.loadId);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${f.name.replace(/[^\x20-\x7E]|"/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.data);
  }

  @Patch('files/:id')
  async updateFile(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: { kind?: string }) {
    const scope = await this.auth(req);
    const { ws } = scope;
    await this.loadAccess(scope, found(await this.store!.file(ws, id)).loadId);
    if (!(FILE_KINDS as readonly string[]).includes(String(body?.kind))) throw new BadRequestException(`Kind must be one of: ${FILE_KINDS.join(', ')}`);
    await this.store!.setFileKind(ws, id, body.kind as FileKind);
    return { ok: true };
  }

  @Delete('files/:id')
  async deleteFile(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const scope = await this.auth(req);
    const { ws } = scope;
    await this.loadAccess(scope, found(await this.store!.file(ws, id)).loadId);
    await this.store!.deleteFile(ws, id);
    return { ok: true };
  }

  // Invoices

  /** The invoice of a load as a PDF, with the chosen documents after it (?attach=3,4). */
  @Get('loads/:id/invoice.pdf')
  async invoicePdf(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Query('attach') attach = '', @Query('download') download = '') {
    const scope = await this.auth(req);
    await this.loadAccess(scope, id);
    const { ws, user } = scope;
    const { data, files } = await invoiceParts(this.store!, ws, user, id, ids(attach));
    const pdf = await buildInvoicePdf(data, files);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="Invoice-${data.number}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(pdf));
  }

  /** Emails the invoice (with the chosen documents in the same PDF) to the broker; replies go to the dispatcher. */
  @Post('loads/:id/invoice')
  @HttpCode(200)
  async sendInvoice(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() b: Record<string, unknown>) {
    const scope = await this.auth(req);
    await this.loadAccess(scope, id);
    const cc = (Array.isArray(b.cc) ? b.cc : []).map((x) => normEmail(String(x))).filter(validEmail).slice(0, 3);
    const attach = (Array.isArray(b.attach) ? b.attach : []).map(Number).filter(Number.isInteger);
    return { ok: true, ...(await this.emailInvoice(scope, id, String(b.to ?? ''), cc, attach, b.remind !== false, text(b.note, 1000))) };
  }

  /** Builds the invoice PDF (with the chosen documents) and emails it to the broker; replies go to the dispatcher. */
  private async emailInvoice(scope: Scope, id: number, toRaw: string, cc: string[], attach: number[], remind: boolean, note: string) {
    const to = normEmail(toRaw);
    if (!validEmail(to)) throw new BadRequestException('Enter the broker’s billing email');
    if (!this.mailHourly.take(`invoice:${scope.ws}`)) throw new HttpException('Too many invoices this hour, try again later', 429);
    const r = await sendLoadInvoice(this.store!, scope.ws, scope.user, id, to, cc, attach, remind, note);
    void this.qbo.push(scope.ws, scope.user, id);
    return r;
  }

  /** Brokerage boards: the rate confirmation for the carrier of a load, as a PDF. */
  @Get('loads/:id/carrier-ratecon.pdf')
  async carrierRcPdf(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    const scope = await this.auth(req);
    await this.loadAccess(scope, id);
    const { data } = await carrierRcParts(this.store!, scope.ws, scope.user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="RateCon-${data.number}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(await buildCarrierRcPdf(data)));
  }

  /** Brokerage boards: emails the rate con to the carrier (replies go to the user); a copy is kept with the load. */
  @Post('loads/:id/carrier-ratecon')
  @HttpCode(200)
  async sendCarrierRc(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() b: Record<string, unknown>) {
    const scope = await this.auth(req);
    await this.loadAccess(scope, id);
    const to = normEmail(String(b.to ?? ''));
    if (!validEmail(to)) throw new BadRequestException('Enter the carrier’s email');
    if (!this.mailHourly.take(`invoice:${scope.ws}`)) throw new HttpException('Too many emails this hour, try again later', 429);
    const r = await sendCarrierRc(this.store!, scope.ws, scope.user, id, to, text(b.note, 1000));
    // The carrier's email is remembered on the carrier for the next load.
    const st = await this.store!.state(scope.ws, scope.user);
    const load = st.loads.find((l) => l.id === id);
    const carrier = st.carriers.find((c) => c.id === load?.carrierId);
    if (carrier && !carrier.email) { const { id: cid, ...rest } = carrier; await this.store!.updateCarrier(scope.ws, cid, { ...rest, email: to }).catch(() => undefined); }
    return { ok: true, ...r };
  }

  /**
   * Sends the carrier's invoice packet to their factoring company (and remembers that address on the carrier, so the
   * next load is one click). The load is marked invoiced; the factor collects, so no broker reminders.
   */
  @Post('loads/:id/factoring')
  @HttpCode(200)
  async sendFactoring(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() b: Record<string, unknown>) {
    const scope = await this.auth(req);
    const cc = (Array.isArray(b.cc) ? b.cc : []).map((x) => normEmail(String(x))).filter(validEmail).slice(0, 3);
    const attach = (Array.isArray(b.attach) ? b.attach : []).map(Number).filter(Number.isInteger);
    return { ok: true, ...(await this.factorPacket(scope, id, String(b.to ?? ''), text(b.factoring, 120), cc, attach, text(b.note, 1000))) };
  }

  /** The invoice packet to the carrier's factoring company; the factor's name and email are remembered on the carrier. */
  private async factorPacket(scope: Scope, id: number, toRaw: string, factoring: string, cc: string[], attach: number[], note: string) {
    await this.loadAccess(scope, id);
    const load = await this.store!.loadById(scope.ws, id);
    const carrier = load?.carrierId == null ? null : (await this.store!.state(scope.ws, scope.user)).carriers.find((c) => c.id === load.carrierId);
    if (!carrier) throw new BadRequestException('Choose the carrier of this load first');
    const to = normEmail(toRaw) || carrier.factoringEmail || '';
    if (!validEmail(to)) throw new BadRequestException(`Enter ${carrier.factoring || 'the factoring company'}’s email for invoices`);
    // The factoring company's name goes on the invoice as "remit to", so it's saved before the PDF is made.
    const name = factoring || carrier.factoring;
    if (!name) throw new BadRequestException('Enter the factoring company’s name — it goes on the invoice as “remit to”');
    if (!this.mailHourly.take(`invoice:${scope.ws}`)) throw new HttpException('Too many invoices this hour, try again later', 429);
    if (name !== carrier.factoring || to !== carrier.factoringEmail) {
      const { id: cid, ...rest } = carrier;
      await this.store!.updateCarrier(scope.ws, cid, { ...rest, factoring: name, factoringEmail: to });
    }
    const r = await sendToFactoring(this.store!, scope.ws, scope.user, id, to, cc, attach, note);
    void this.qbo.push(scope.ws, scope.user, id);
    return { ...r, factor: name };
  }

  /** An email the AI wrote to a broker (about a posted load, a truck, a rate), sent after the user's OK. Replies go to them. */
  private async brokerEmail(scope: Scope, toRaw: string, subject: string, body: string) {
    const to = normEmail(toRaw);
    if (!validEmail(to)) throw new BadRequestException('That broker email doesn’t look right');
    if (!this.mailHourly.take(`broker:${scope.ws}`)) throw new HttpException('Too many emails this hour, try again later', 429);
    const co = await this.store!.company(scope.ws);
    const from = co.name || scope.user.name;
    const sign = [scope.user.name, [from, co.mc && `MC ${co.mc}`, co.phone].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
    const textBody = `${body.trim()}\n\n${sign}`;
    await sendMail({
      to, fromName: `${from} via HaulPanel`, replyTo: scope.user.email, subject: subject.slice(0, 200),
      text: textBody, html: `<div style="font:14px/1.5 sans-serif">${esc(textBody).replace(/\n/g, '<br>')}</div>`,
    });
    return { to };
  }

  @Patch('loads/:id/invoice')
  async invoiceReminders(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() b: { remind?: boolean }) {
    const scope = await this.auth(req);
    await this.loadAccess(scope, id);
    const { ws } = scope;
    await this.store!.setReminders(ws, id, b?.remind !== false);
    return { ok: true };
  }

  // Drivers on Telegram and tracking links

  /** A Telegram link for the truck's driver: one tap connects them to this truck in the bot. */
  @Post('trucks/:id/driver-link')
  @HttpCode(200)
  async driverLink(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.auth(req);
    const bot = this.telegram.links().bot;
    if (!bot) throw new ServiceUnavailableException('The Telegram bot is not available right now');
    const token = found(await this.store!.createDriverLink(ws, id));
    return { url: `${bot}?start=drv_${token}` };
  }

  @Delete('trucks/:id/driver')
  async disconnectDriver(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.auth(req);
    await this.store!.disconnectDriver(ws, id);
    return { ok: true };
  }

  /** The broker's tracking link of a load (always the same link for that load). */
  @Post('loads/:id/tracking')
  @HttpCode(200)
  async trackingLink(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const s = await this.auth(req);
    await this.loadAccess(s, id);
    const token = found(await this.store!.trackingToken(s.ws, id));
    return { url: `${config.publicUrl || 'https://haulpanel.com'}/#/track/${token}` };
  }

  /** Public tracking page data: lane, status, the truck's last position and the road — no money, no names but the company. */
  @Get('track/:token')
  async track(@Req() req: Request, @Param('token') token: string) {
    if (!this.milesLimiter.take(ipOf(req))) throw new HttpException('Too many requests, try again in a few minutes', 429);
    const t = await this.need().tracking(text(token, 60));
    if (!t) throw new NotFoundException('This tracking link is not valid');
    const lane = await this.milesService.lane(t.origin, t.destination).catch(() => null);
    return { ...t, lane };
  }

  // Loads

  @Post('loads')
  async addLoad(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const s = await this.auth(req);
    const l = loadInput(body);
    return this.store!.addLoad(s.ws, s.role === 'owner' ? l : { ...l, dispatcherId: s.dispatcherId });
  }

  @Patch('loads/:id')
  async updateLoad(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const s = await this.auth(req);
    await this.loadAccess(s, id);
    const l = loadInput(body);
    return found(await this.store!.updateLoad(s.ws, id, s.role === 'owner' ? l : { ...l, dispatcherId: s.dispatcherId }));
  }

  @Delete('loads/:id')
  async deleteLoad(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const s = await this.auth(req);
    await this.loadAccess(s, id);
    const { ws } = s;
    await this.store!.deleteLoad(ws, id);
    return { ok: true };
  }

  @Post('loads/import')
  async importLoads(@Req() req: Request, @Body() body: unknown) {
    const { ws } = await this.owner(req);
    return { imported: await this.store!.importLoads(ws, importRows(body)) };
  }

  private need(): CrmStore {
    if (!this.store) throw new ServiceUnavailableException('The CRM needs a database (DATABASE_URL)');
    return this.store;
  }

  private limit(req: Request) {
    if (!this.authLimiter.take(ipOf(req))) throw new HttpException('Too many attempts — wait a few minutes and try again', 429);
  }

  private async sendCode(email: string, purpose: CodePurpose, name: string) {
    if (!mailReady()) throw new ServiceUnavailableException('Email sign-up is being set up — use Google for now');
    // A code sent in the last 30 seconds is still on its way: don't send another (the latest one is the valid one).
    if (!this.mailCooldown.take(`${purpose}:${email}`)) return;
    if (!this.mailHourly.take(email)) throw new HttpException('Too many codes for this email — try again in an hour', 429);
    const code = newCode();
    await this.store!.saveCode(email, purpose, codeHash(email, code));
    try {
      await sendMail(codeMail(email, code, purpose, name.split(' ')[0]));
    } catch (e) {
      throw new ServiceUnavailableException((e as Error).message);
    }
  }

  private async checkCode(email: string, purpose: CodePurpose, code: string) {
    const r = /^\d{6}$/.test(code) ? await this.store!.useCode(email, purpose, codeHash(email, code)) : 'wrong';
    if (r === 'wrong') throw new BadRequestException('Wrong code — check the latest email');
    if (r === 'expired') throw new BadRequestException('The code has expired — tap “Send a new code”');
  }

  private async auth(req: Request): Promise<Scope> {
    const s = await this.need().session(readCookie(req, COOKIE));
    if (!s) throw new UnauthorizedException('Please sign in');
    const scope: Scope = { ws: s.workspaceId, user: s.user, role: s.role, dispatcherId: s.dispatcherId };
    (req as ScopedRequest).crmScope = scope; // for the activity analytics
    return scope;
  }

  /** Only the owner of the board (not an invited dispatcher) may do this. */
  private async owner(req: Request): Promise<Scope> {
    const s = await this.auth(req);
    if (s.role !== 'owner') throw new ForbiddenException('Only the owner of this board can do that');
    return s;
  }

  /** An invited dispatcher may only touch their own loads; anyone else gets "not found". */
  private async loadAccess(s: Scope, loadId: number | null) {
    if (s.role === 'owner') return;
    const l = loadId == null ? null : await this.store!.loadById(s.ws, loadId);
    if (!l || l.dispatcherId == null || l.dispatcherId !== s.dispatcherId) throw new NotFoundException();
  }

  /** Signs in: session cookie, and only the public part of the user goes back (never the password hash). */
  private async startSession(res: Response, full: CrmUser) {
    const user: CrmUser = { id: full.id, email: full.email, name: full.name, picture: full.picture };
    const token = await this.store!.createSession(user.id);
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https://'), path: '/api/crm', maxAge: COOKIE_MAX_AGE_MS,
    });
    return { user };
  }
}

/** The board as compact text for the AI: one line per load (newest 1500), then carriers, trucks and dispatchers. */
export function boardText(st: { company: { name: string }; loads: Load[]; carriers: { id: number; name: string; mc: string; feeType: string; fee: number; factoring: string }[];
  trucks: { id: number; unit: string; driver: string; carrierId: number | null }[]; dispatchers: { id: number; name: string; percent: number }[] }): string {
  const name = <T extends { id: number }>(xs: T[], id: number | null, f: (x: T) => string) => (id == null ? '' : f(xs.find((x) => x.id === id) ?? ({} as T)) ?? '');
  const head = 'id|pickup|status|broker|load#|origin|destination|rate|detention|layover|tonu|other|lumper|loaded_mi|empty_mi|carrier|truck|dispatcher|invoiced_on|paid_on';
  const rows = st.loads.slice(0, 1500).map((l) => [l.id, l.date, l.status, l.broker, l.pro, l.origin, l.destination, l.rate, l.detention, l.layover, l.tonu, l.other, l.lumper,
    l.loadedMiles, l.emptyMiles, name(st.carriers, l.carrierId, (c) => c.name), name(st.trucks, l.truckId, (t) => t.unit), name(st.dispatchers, l.dispatcherId, (d) => d.name),
    l.invoicedOn ?? '', l.paidOn ?? ''].map((v) => String(v ?? '').replace(/[|\n]/g, ' ')).join('|'));
  return [
    `Company: ${st.company.name || '—'}. Today: ${new Date().toISOString().slice(0, 10)}.`,
    `LOADS (${st.loads.length}${st.loads.length > 1500 ? ', newest 1500 shown' : ''}):`, head, ...rows, '',
    'CARRIERS: ' + (st.carriers.map((c) => `${c.name} (MC ${c.mc || '—'}, fee ${c.feeType === 'flat' ? `$${c.fee}/week` : `${c.fee}%`}${c.factoring ? `, factoring ${c.factoring}` : ''})`).join('; ') || 'none'),
    'TRUCKS: ' + (st.trucks.map((t) => `#${t.unit || '—'} ${t.driver}`).join('; ') || 'none'),
    'DISPATCHERS: ' + (st.dispatchers.map((d) => `${d.name} ${d.percent}%`).join('; ') || 'none'),
  ].join('\n');
}

/** What the chat panel shows: the conversation and the actions waiting for a decision. */
function aiView(t: Thread) {
  return { threadId: t.id, title: t.title ?? 'New chat', items: t.display, pending: t.pending.map(actionView), actions: (t.actions ?? []).map(actionView) };
}

/** A Google Sheet shared "anyone with the link" → all its tabs as an .xlsx file. */
async function googleSheet(url: string): Promise<ImportFile> {
  const id = /docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/.exec(url)?.[1];
  if (!id) throw new BadRequestException('That is not a Google Sheets link');
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: 'follow', signal: AbortSignal.timeout(30_000) }).catch(() => null);
  const data = r?.ok ? Buffer.from(await r.arrayBuffer()) : null;
  if (!data || data.readUInt32LE(0) !== 0x04034b50) throw new BadRequestException('Can’t open this sheet — in Google Sheets set Share → “Anyone with the link can view”, then try again');
  if (data.length > 15 * 1024 * 1024) throw new BadRequestException('The sheet is over 15 MB');
  return { name: 'Google Sheet.xlsx', data };
}

/** "3,4" → [3, 4] */
const ids = (s: string) => s.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 20);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What a file really is, from its first bytes (not from what the browser says). */
function sniff(b: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export { invoiceData, PAY_TERMS_DAYS } from './invoice-send.js';

interface Scope { ws: number; user: CrmUser; role: 'owner' | 'dispatcher'; dispatcherId: number | null }

function found<T>(v: T | null): T {
  if (!v) throw new NotFoundException();
  return v;
}
