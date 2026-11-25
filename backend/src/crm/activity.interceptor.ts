import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { catchError, tap, throwError, type Observable } from 'rxjs';
import { requestContext } from '../analytics/analytics.controller.js';
import { AnalyticsService } from '../analytics/analytics.service.js';

// What signed-in users do in the TMS after they register, for the owner's analytics (stored in analytics_events,
// never shown on a page). Every change (POST/PATCH/DELETE) on the board is one event with a readable name, small
// facts about it (never message texts, emails, names or money details beyond counts), whether it worked and how
// long it took. The AI's own actions go through the same routes, so they count too.

/** The signed-in person, set by CrmController.auth() on the request. */
export interface ActivityScope { ws: number; user: { id: number }; role: string }
export type ScopedRequest = Request & { crmScope?: ActivityScope };

type Body = Record<string, unknown>;
const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const has = (v: unknown) => v != null && v !== '' && v !== false;

/** `METHOD route` → event name and the facts worth keeping (from the request body and the answer). */
const EVENTS: Record<string, [string, ((b: Body, p: Record<string, string>, out: unknown) => Record<string, unknown>)?]> = {
  'POST company': ['company_set', (b) => ({ type: b.type ?? '', fleet: b.fleetSize ?? '', mc: has(b.mc) })],
  'POST loads': ['load_create', (b) => ({ status: b.status ?? '', rate: has(b.rate) && Number(b.rate) > 0, truck: has(b.truckId), carrier: has(b.carrierId) })],
  'PATCH loads/:id': ['load_update', (b, p) => ({ id: Number(p.id), status: b.status ?? '' })],
  'DELETE loads/:id': ['load_delete', (_b, p) => ({ id: Number(p.id) })],
  'POST loads/import': ['loads_import', (b) => ({ rows: len(b.rows) })],
  'POST loads/:id/files': ['file_upload', (_b, p) => ({ load: Number(p.id) })],
  'PATCH files/:id': ['file_update'],
  'DELETE files/:id': ['file_delete'],
  'POST loads/:id/invoice': ['invoice_email', (b, p) => ({ load: Number(p.id), attachments: len(b.attach) })],
  'PATCH loads/:id/invoice': ['invoice_edit', (_b, p) => ({ load: Number(p.id) })],
  'POST loads/:id/factoring': ['factoring_send', (b, p) => ({ load: Number(p.id), attachments: len(b.attach) })],
  'POST loads/:id/tracking': ['tracking_link', (_b, p) => ({ load: Number(p.id) })],
  'POST carriers': ['carrier_create', (b) => ({ mc: has(b.mc), factoring: has(b.factoring) })],
  'PATCH carriers/:id': ['carrier_update'],
  'DELETE carriers/:id': ['carrier_delete'],
  'POST trucks': ['truck_create'],
  'PATCH trucks/:id': ['truck_update'],
  'DELETE trucks/:id': ['truck_delete'],
  'POST trucks/:id/driver-link': ['driver_link'],
  'DELETE trucks/:id/driver': ['driver_unlink'],
  'POST dispatchers': ['dispatcher_create'],
  'PATCH dispatchers/:id': ['dispatcher_update'],
  'DELETE dispatchers/:id': ['dispatcher_delete'],
  'POST invites': ['invite_create'],
  'DELETE invites/:id': ['invite_delete'],
  'DELETE members/:userId': ['member_remove'],
  'POST invites/accept': ['invite_accept'],
  'POST ai/chat': ['ai_message', (b) => ({ chars: String(b.text ?? '').length, file: has(b.file), load: has(b.loadId), new_chat: !has(b.threadId) })],
  'POST ai/chat/stream': ['ai_message', (b) => ({ chars: String(b.text ?? '').length, file: has(b.file), load: has(b.loadId), new_chat: !has(b.threadId) })],
  'POST ai/decide': ['ai_confirm', (b) => ({ approve: b.approve === true })],
  'POST ai/decide/stream': ['ai_confirm', (b) => ({ approve: b.approve === true })],
  'POST ai/undo': ['ai_undo'],
  'DELETE ai/thread/:id': ['ai_chat_delete'],
  'POST ai/ratecon': ['ai_ratecon_read'],
  'POST ai/doc': ['ai_doc_read', (_b, _p, out) => {
    const o = (out ?? {}) as { doc?: { kind?: string; signedByReceiver?: boolean; exceptions?: string }; match?: { loadId?: number | null } };
    return { kind: o.doc?.kind ?? '', signed: o.doc?.signedByReceiver === true, exceptions: has(o.doc?.exceptions), matched: o.match?.loadId != null };
  }],
  'POST loads/:id/carrier-ratecon': ['carrier_ratecon_send', (_b, p) => ({ load: Number(p.id) })],
  'POST ai/import': ['ai_import_preview', (b, _p, out) => {
    const o = (out ?? {}) as { loads?: unknown[]; carriers?: unknown[]; trucks?: unknown[]; dispatchers?: unknown[]; skipped?: unknown[] };
    const o2 = o as { brokers?: unknown[]; advice?: unknown[] };
    return { files: len(b.files), sheet: has(b.sheetUrl), loads: len(o.loads), carriers: len(o.carriers), trucks: len(o.trucks), dispatchers: len(o.dispatchers), brokers: len(o2.brokers), skipped: len(o.skipped), advice: len(o2.advice) };
  }],
  'POST ai/import/apply': ['ai_import_apply', (_b, _p, out) => {
    const o = (out ?? {}) as Record<string, unknown>;
    return { loads: Number(o.loads ?? 0), carriers: Number(o.carriers ?? 0), trucks: Number(o.trucks ?? 0), dispatchers: Number(o.dispatchers ?? 0), brokers: Number(o.brokers ?? 0) };
  }],
  'POST integrations/eld/:provider': ['integration_connect', (_b, p) => ({ provider: p.provider })],
  'POST integrations/eld/:provider/sync': ['integration_sync', (_b, p) => ({ provider: p.provider })],
  'DELETE integrations/:provider': ['integration_disconnect', (_b, p) => ({ provider: p.provider })],
  'POST integrations/quickbooks/connect': ['integration_connect', () => ({ provider: 'quickbooks' })],
  'POST integrations/quickbooks/sync': ['integration_sync', () => ({ provider: 'quickbooks' })],
  'PATCH integrations/eld/:provider/units/:vehicleId': ['eld_unit_link', (_b, p) => ({ provider: p.provider })],
  'PATCH inbox/settings': ['load_alerts_settings', (b) => ({ autopilot: b.autoEmail === true })],
  'POST inbox/postings/:id/email': ['load_alerts_email'],
  'POST inbox/postings/:id/dismiss': ['load_alerts_dismiss'],
  'POST inbox/paste': ['load_alerts_paste'],
  'POST auth/logout': ['sign_out'],
};

@Injectable()
export class CrmActivityInterceptor implements NestInterceptor {
  constructor(private readonly analytics: AnalyticsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<ScopedRequest>();
    if (req.method === 'GET') return next.handle();
    const route = String((req.route as { path?: string } | undefined)?.path ?? '').replace(/^\/api\/crm\//, '');
    const entry = EVENTS[`${req.method} ${route}`];
    if (!entry) return next.handle();
    const started = Date.now();
    const record = (ok: boolean, out: unknown, error?: string) => {
      const s = req.crmScope;
      if (!s) return; // not signed in (or sign-in failed)
      let props: Record<string, unknown> = {};
      try { props = entry[1]?.((req.body ?? {}) as Body, req.params as Record<string, string>, out) ?? {}; } catch { /* facts are optional */ }
      void this.analytics.recordAccount(`crm_${entry[0]}`, { ...props, ok, ms: Date.now() - started, ...(error ? { error: error.slice(0, 160) } : {}) },
        { uid: s.user.id, ws: s.ws, role: s.role }, requestContext(req));
    };
    return next.handle().pipe(
      tap((out) => record(true, out)),
      catchError((e: unknown) => {
        record(false, null, e instanceof Error ? e.message : String(e));
        return throwError(() => e);
      }),
    );
  }
}
