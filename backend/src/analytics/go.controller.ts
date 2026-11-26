import { Controller, Get, NotFoundException, Param, Query, Redirect } from '@nestjs/common';
import { partnerTarget } from '../site/partners.js';
import { AnalyticsService } from './analytics.service.js';

/** /api/go/<partner>: counts the click (which partner, from which page) and sends the person to the partner. */
@Controller('go')
export class GoController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':id')
  @Redirect()
  go(@Param('id') id: string, @Query('from') from?: string) {
    const url = partnerTarget(String(id).toLowerCase());
    if (!url) throw new NotFoundException('Unknown partner');
    void this.analytics.recordServer('partner_click', { partner: id, from: String(from ?? '').slice(0, 80) }, null).catch(() => undefined);
    return { url, statusCode: 302 };
  }
}
