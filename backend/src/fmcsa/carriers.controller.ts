import { BadRequestException, Controller, DefaultValuePipe, Get, Param, ParseEnumPipe, ParseIntPipe, Query } from '@nestjs/common';
import type { AuthorityMode } from './authority.mapper.js';
import { CarriersService } from './carriers.service.js';
import type { Insurance, ScanResult } from './fmcsa.types.js';
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

  @Get(':mc/insurance')
  insuranceFor(@Param('mc', ParseIntPipe) mc: number): Promise<Insurance> {
    return this.insurance.forMc(mc);
  }
}
