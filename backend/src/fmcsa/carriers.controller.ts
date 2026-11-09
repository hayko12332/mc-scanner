import { BadRequestException, Controller, DefaultValuePipe, Get, Param, ParseEnumPipe, ParseIntPipe, Query } from '@nestjs/common';
import type { AuthorityMode } from './authority.mapper.js';
import { CarriersService } from './carriers.service.js';
import type { Insurance, LeadsDay, ScanResult } from './fmcsa.types.js';
import { InsuranceService } from './insurance.service.js';

const MAX_RANGE = 200;
const MODES = { strict: 'strict', lenient: 'lenient' } as const;

@Controller('carriers')
export class CarriersController {
  constructor(
    private readonly carriers: CarriersService,
    private readonly insurance: InsuranceService,
  ) {}

  /** GET /api/carriers?from=1000000&to=1000099&mode=lenient */
  @Get()
  scan(
    @Query('from', ParseIntPipe) from: number,
    @Query('to', ParseIntPipe) to: number,
    @Query('mode', new DefaultValuePipe('strict'), new ParseEnumPipe(MODES)) mode: AuthorityMode,
  ): Promise<ScanResult> {
    if (from < 1 || to < from || to - from >= MAX_RANGE) {
      throw new BadRequestException(`Need 1 <= from <= to and at most ${MAX_RANGE} MC numbers per request`);
    }
    return this.carriers.scan(from, to, mode);
  }

  /** GET /api/carriers/new?date=2026-11-09 — "New MC leads": carriers granted authority that day. */
  @Get('new')
  newOn(@Query('date') date: string): Promise<LeadsDay> {
    const t = Date.parse(date);
    const age = (Date.now() - t) / 86_400_000;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(t) || age < -1 || age > 366) {
      throw new BadRequestException('Need date=YYYY-MM-DD within the last year');
    }
    return this.carriers.newOn(date);
  }

  @Get(':mc/insurance')
  insuranceFor(@Param('mc', ParseIntPipe) mc: number): Promise<Insurance> {
    return this.insurance.forMc(mc);
  }
}
