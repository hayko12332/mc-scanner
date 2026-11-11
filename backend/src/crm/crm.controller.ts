import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, Req, Res,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { carrierInput, dispatcherInput, importRows, loadInput } from './crm.input.js';
import { CrmStore } from './crm.store.js';
import type { CrmUser } from './crm.types.js';
import { verifyGoogleIdToken } from './google-auth.js';

const COOKIE = 'lh_crm';
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

  constructor() {
    const pool = db();
    this.store = pool ? new CrmStore(pool) : null;
  }

  @Get('config')
  settings() {
    return { googleClientId: config.googleClientId, devLogin: config.crmDevLogin, enabled: !!this.store };
  }

  @Post('auth/google')
  @HttpCode(200)
  async google(@Body() body: { credential?: string }, @Res({ passthrough: true }) res: Response) {
    const store = this.need();
    const profile = await verifyGoogleIdToken(String(body?.credential ?? ''), config.googleClientId);
    if (!profile) throw new UnauthorizedException('Google sign-in failed, please try again');
    return this.startSession(res, await store.signIn(profile));
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

  private async auth(req: Request): Promise<{ ws: number; user: CrmUser }> {
    const s = await this.need().session(readCookie(req, COOKIE));
    if (!s) throw new UnauthorizedException('Please sign in');
    return { ws: s.workspaceId, user: s.user };
  }

  private async startSession(res: Response, user: CrmUser) {
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
