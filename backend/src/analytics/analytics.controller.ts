import { Body, Controller, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { EventBatch, FeedbackInput } from './analytics.types.js';
import { AnalyticsService, type RequestContext } from './analytics.service.js';
import { RateLimiter } from './rate-limiter.js';

export function requestContext(req: Request): RequestContext {
  const header = (name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  // Render (and most hosts) put the client address first in X-Forwarded-For.
  const ip = header('x-forwarded-for').split(',')[0].trim() || req.socket.remoteAddress || '';
  return {
    ip: ip.replace(/^::ffff:/, ''),
    country: header('cf-ipcountry').slice(0, 2).toUpperCase(),
    userAgent: header('user-agent'),
  };
}

@Controller('analytics')
export class AnalyticsController {
  // 600 events per IP per 10 minutes is far above real use and stops a flood from filling the database.
  private readonly limiter = new RateLimiter(600, 10 * 60_000);

  constructor(private readonly analytics: AnalyticsService) {}

  /** POST /api/analytics/events — called by the frontend (fetch or sendBeacon). */
  @Post('events')
  @HttpCode(204)
  async events(@Body() batch: EventBatch, @Req() req: Request): Promise<void> {
    const ctx = requestContext(req);
    const count = Array.isArray(batch?.events) ? Math.min(batch.events.length, 50) : 0;
    if (!count || !this.limiter.take(ctx.ip, count)) return;
    await this.analytics.recordBatch(batch, ctx);
  }
}

@Controller('feedback')
export class FeedbackController {
  // A person writes a suggestion or two; this stops a script from filling the table.
  private readonly limiter = new RateLimiter(5, 10 * 60_000);

  constructor(private readonly analytics: AnalyticsService) {}

  /** POST /api/feedback — "what would you like to see?" */
  @Post()
  @HttpCode(204)
  async create(@Body() input: FeedbackInput, @Req() req: Request): Promise<void> {
    const ctx = requestContext(req);
    if (!this.limiter.take(ctx.ip)) {
      throw new HttpException('Thanks! You have sent several suggestions already — please try again later.', 429);
    }
    await this.analytics.recordFeedback(input, ctx);
  }
}
