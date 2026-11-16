import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, HttpException, NotFoundException, Param, ParseIntPipe, Patch,
  Post, Query, Req, Res, ServiceUnavailableException, UnauthorizedException,
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
import { aiEnabled, askBoard, readRateCon, type AskTurn } from './ai.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { FILE_KINDS, type FileKind } from './crm.store.js';
import { buildInvoicePdf, invoiceTotal, type InvoiceData } from './invoice.js';
import type { Load } from './crm.types.js';
import { emailOk as validEmail } from './password.js';
import { PlacesService } from './places.js';

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

  constructor(private readonly checks: CompanyCheckService, private readonly telegram: TelegramService) {
    const pool = db();
    this.store = pool ? new CrmStore(pool) : null;
  }

  @Get('config')
  settings() {
    return { googleClientId: config.googleClientId, devLogin: config.crmDevLogin, enabled: !!this.store, emailAuth: !!this.store && mailReady(), ai: aiEnabled() };
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

  /** A question about the board, answered from the board's own data (an invited dispatcher's view only has their loads). */
  @Post('ai/ask')
  @HttpCode(200)
  async aiAsk(@Req() req: Request, @Body() b: { question?: string; history?: unknown }) {
    const s = await this.auth(req);
    if (!aiEnabled()) throw new ServiceUnavailableException('AI is not switched on');
    const question = text(b?.question, 1000);
    if (!question) throw new BadRequestException('Ask a question');
    if (!this.aiLimiter.take(`ws:${s.ws}`)) throw new HttpException('Too many AI requests this hour, try again later', 429);
    const history = (Array.isArray(b?.history) ? b.history : []).slice(-8)
      .map((t: { role?: string; text?: unknown }): AskTurn => ({ role: t?.role === 'assistant' ? 'assistant' : 'user', text: text(t?.text, 4000) }))
      .filter((t) => t.text);
    try {
      return { answer: await askBoard(boardText(await this.scopedState(s)), history, question) };
    } catch (e) {
      throw new ServiceUnavailableException((e as Error).message);
    }
  }

  /** The board as this person may see it: the owner sees everything, an invited dispatcher only their own loads. */
  private async scopedState(s: Scope) {
    const st = await this.store!.state(s.ws, s.user);
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

  // Team (owner only)

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
    const { data, files } = await this.invoiceParts(ws, user, id, ids(attach));
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
    const { ws, user } = scope;
    const to = normEmail(String(b.to ?? ''));
    if (!validEmail(to)) throw new BadRequestException('Enter the broker’s billing email');
    const cc = (Array.isArray(b.cc) ? b.cc : []).map((x) => normEmail(String(x))).filter(validEmail).slice(0, 3);
    if (!this.mailHourly.take(`invoice:${ws}`)) throw new HttpException('Too many invoices this hour, try again later', 429);
    const { load, data, files } = await this.invoiceParts(ws, user, id, (Array.isArray(b.attach) ? b.attach : []).map(Number).filter(Number.isInteger));
    const pdf = await buildInvoicePdf(data, files);
    const note = text(b.note, 1000);
    const lane = `${data.load.origin || '—'} → ${data.load.destination || '—'}`;
    const total = invoiceTotal(data).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const docs = files.map((f) => f.kind === 'pod' ? 'POD' : f.kind === 'bol' ? 'BOL' : f.kind === 'ratecon' ? 'rate confirmation' : f.name);
    await sendMail({
      to, cc, fromName: `${data.from.name} via HaulPanel`, replyTo: user.email,
      subject: `Invoice ${data.number} · Load ${load.pro || load.id} · ${data.from.name}`,
      text: `Hello,\n\nPlease find attached invoice ${data.number} for load ${load.pro || load.id} (${lane}), ${total}, due ${data.due}.${docs.length ? `\nAttached in the same PDF: ${docs.join(', ')}.` : ''}${note ? `\n\n${note}` : ''}${data.remitTo ? `\n\nPlease remit payment to ${data.remitTo}.` : ''}\n\nThank you,\n${user.name || data.from.name}\n${data.from.name}${data.from.phone ? ` · ${data.from.phone}` : ''}`,
      html: `<p>Hello,</p><p>Please find attached invoice <b>${esc(data.number)}</b> for load <b>${esc(load.pro || String(load.id))}</b> (${esc(lane)}), <b>${total}</b>, due ${esc(data.due)}.${docs.length ? `<br>Attached in the same PDF: ${esc(docs.join(', '))}.` : ''}</p>${note ? `<p>${esc(note).replace(/\n/g, '<br>')}</p>` : ''}${data.remitTo ? `<p>Please remit payment to <b>${esc(data.remitTo)}</b>.</p>` : ''}<p>Thank you,<br>${esc(user.name || data.from.name)}<br>${esc(data.from.name)}${data.from.phone ? ` · ${esc(data.from.phone)}` : ''}</p>`,
      attachments: [{ filename: `Invoice-${data.number}.pdf`, content: pdf }],
    });
    await this.store!.invoiceSent(ws, load, data.number, to, b.remind !== false, new Date().toISOString().slice(0, 10));
    return { ok: true, number: data.number };
  }

  @Patch('loads/:id/invoice')
  async invoiceReminders(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() b: { remind?: boolean }) {
    const scope = await this.auth(req);
    await this.loadAccess(scope, id);
    const { ws } = scope;
    await this.store!.setReminders(ws, id, b?.remind !== false);
    return { ok: true };
  }

  /** What goes on a load's invoice: the carrier (or this company) bills the broker; the carrier's factoring gets paid. */
  private async invoiceParts(ws: number, user: CrmUser, id: number, attach: number[]) {
    const state = await this.store!.state(ws, user);
    const load = found(state.loads.find((l) => l.id === id) ?? null);
    const carrier = state.carriers.find((c) => c.id === load.carrierId);
    const truck = state.trucks.find((t) => t.id === load.truckId);
    const data = invoiceData(load, {
      from: carrier
        ? { name: carrier.name, mc: carrier.mc.replace(/\D/g, ''), phone: carrier.phone, email: carrier.email }
        : { name: state.company.name || user.name, mc: state.company.mc, phone: state.company.phone, email: user.email },
      remitTo: carrier?.factoring || undefined, truck: truck?.unit, driver: truck?.driver,
      billEmail: state.brokerEmails[load.broker.trim().toLowerCase()],
    });
    const files = await this.store!.filesOf(ws, id, attach);
    return { load, data, files };
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
    return { ws: s.workspaceId, user: s.user, role: s.role, dispatcherId: s.dispatcherId };
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

export const PAY_TERMS_DAYS = 30;

/** The invoice of one load: number, dates (net 30 from the invoice date), parties and charges. */
export function invoiceData(load: Load, o: { from: InvoiceData['from']; remitTo?: string; truck?: string; driver?: string; billEmail?: string }, today = new Date()): InvoiceData {
  const date = load.invoicedOn ?? today.toISOString().slice(0, 10);
  const due = new Date(date + 'T12:00:00Z');
  due.setUTCDate(due.getUTCDate() + PAY_TERMS_DAYS);
  const lines = [
    { label: 'Linehaul', amount: load.rate },
    { label: 'Detention', amount: load.detention },
    { label: 'Layover', amount: load.layover },
    { label: 'Truck order not used (TONU)', amount: load.tonu },
    { label: 'Other charges', amount: load.other },
    { label: 'Lumper (reimbursement, receipt attached)', amount: load.lumper },
  ].filter((l) => l.amount > 0);
  return {
    number: `INV-${String(load.id).padStart(5, '0')}`, date, due: due.toISOString().slice(0, 10), termsDays: PAY_TERMS_DAYS,
    from: o.from, remitTo: o.remitTo, billTo: { name: load.broker, mc: load.brokerMc || undefined, email: o.billEmail },
    load: { pro: load.pro, pickupDate: load.date, origin: load.origin, destination: load.destination, miles: load.loadedMiles, truck: o.truck, driver: o.driver },
    lines: lines.length ? lines : [{ label: 'Linehaul', amount: 0 }],
  };
}

interface Scope { ws: number; user: CrmUser; role: 'owner' | 'dispatcher'; dispatcherId: number | null }

function found<T>(v: T | null): T {
  if (!v) throw new NotFoundException();
  return v;
}
