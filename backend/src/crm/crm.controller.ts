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
  private readonly milesService = new MilesService();
  /** Sign-up, log-in and code checks per IP: enough for people, not for password guessing. */
  private readonly authLimiter = new RateLimiter(40, 10 * 60_000);
  /** Emails per address: one every 30 seconds, at most 6 an hour. */
  private readonly mailCooldown = new RateLimiter(1, 30_000);
  private readonly mailHourly = new RateLimiter(6, 3600_000);
  /** Miles are public (the demo uses them too), so each visitor gets a fair share of the free map services. */
  private readonly milesLimiter = new RateLimiter(150, 10 * 60_000);

  constructor() {
    const pool = db();
    this.store = pool ? new CrmStore(pool) : null;
  }

  @Get('config')
  settings() {
    return { googleClientId: config.googleClientId, devLogin: config.crmDevLogin, enabled: !!this.store, emailAuth: !!this.store && mailReady() };
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
    if (!company.name) throw new BadRequestException('Enter your company name');
    if (!company.type) throw new BadRequestException('Choose what your company does');
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
    const { user } = await this.auth(req);
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

  @Get('state')
  async state(@Req() req: Request) {
    const { ws, user } = await this.auth(req);
    return this.store!.state(ws, user);
  }

  // Dispatchers

  @Post('dispatchers')
  async addDispatcher(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    const d = dispatcherInput(body);
    return this.store!.addDispatcher(ws, d.name, d.percent);
  }

  @Patch('dispatchers/:id')
  async updateDispatcher(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    const d = dispatcherInput(body);
    return found(await this.store!.updateDispatcher(ws, id, d.name, d.percent));
  }

  @Delete('dispatchers/:id')
  async archiveDispatcher(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.auth(req);
    await this.store!.archiveDispatcher(ws, id);
    return { ok: true };
  }

  // Carriers

  @Post('carriers')
  async addCarrier(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    return this.store!.addCarrier(ws, carrierInput(body));
  }

  @Patch('carriers/:id')
  async updateCarrier(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    return found(await this.store!.updateCarrier(ws, id, carrierInput(body)));
  }

  @Delete('carriers/:id')
  async archiveCarrier(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.auth(req);
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
    const { ws } = await this.auth(req);
    await this.store!.archiveTruck(ws, id);
    return { ok: true };
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

  // Loads

  @Post('loads')
  async addLoad(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    return this.store!.addLoad(ws, loadInput(body));
  }

  @Patch('loads/:id')
  async updateLoad(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const { ws } = await this.auth(req);
    return found(await this.store!.updateLoad(ws, id, loadInput(body)));
  }

  @Delete('loads/:id')
  async deleteLoad(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { ws } = await this.auth(req);
    await this.store!.deleteLoad(ws, id);
    return { ok: true };
  }

  @Post('loads/import')
  async importLoads(@Req() req: Request, @Body() body: unknown) {
    const { ws } = await this.auth(req);
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

  private async auth(req: Request): Promise<{ ws: number; user: CrmUser }> {
    const s = await this.need().session(readCookie(req, COOKIE));
    if (!s) throw new UnauthorizedException('Please sign in');
    return { ws: s.workspaceId, user: s.user };
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

function found<T>(v: T | null): T {
  if (!v) throw new NotFoundException();
  return v;
}
