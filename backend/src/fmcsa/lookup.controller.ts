import { BadRequestException, Controller, DefaultValuePipe, Get, ParseEnumPipe, Query } from '@nestjs/common';
import type { LookupResult } from './fmcsa.types.js';
import { parseLookupQuery, type LookupType } from './lookup.query.js';
import { LookupService } from './lookup.service.js';

const TYPES = { auto: 'auto', mc: 'mc', dot: 'dot', email: 'email', phone: 'phone' } as const;

@Controller('lookup')
export class LookupController {
  constructor(private readonly lookup: LookupService) {}

  /** GET /api/lookup?q=MC-1650101 | 2952744 | info@acme.com | (614) 555-1234 [&type=mc|dot|email|phone] */
  @Get()
  find(
    @Query('q', new DefaultValuePipe('')) q: string,
    @Query('type', new DefaultValuePipe('auto'), new ParseEnumPipe(TYPES)) type: LookupType,
  ): Promise<LookupResult> {
    const parsed = q.length <= 200 ? parseLookupQuery(q, type) : null;
    if (!parsed) {
      throw new BadRequestException(
        type === 'auto'
          ? 'Enter an MC number, USDOT number, email or 10-digit phone number'
          : `"${q.trim()}" is not a valid ${type === 'dot' ? 'USDOT number' : type === 'mc' ? 'MC number' : type}`,
      );
    }
    return this.lookup.lookup(q, parsed);
  }
}
