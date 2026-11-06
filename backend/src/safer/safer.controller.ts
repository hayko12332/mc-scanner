import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { SaferSnapshot } from './safer.parser.js';
import { SaferService } from './safer.service.js';

@Controller('safer')
export class SaferController {
  constructor(private readonly safer: SaferService) {}

  // Declared before :mc so "page" isn't parsed as an MC number.
  @Get('page/:dot')
  async page(@Param('dot', ParseIntPipe) dot: number, @Res({ passthrough: true }) res: Response): Promise<Buffer> {
    const html = await this.safer.pageByDot(dot);
    res.type('text/html; charset=iso-8859-1'); // only on success, so errors stay JSON
    return Buffer.from(html, 'latin1');
  }

  @Get(':mc')
  snapshot(@Param('mc', ParseIntPipe) mc: number): Promise<SaferSnapshot> {
    return this.safer.snapshotByMc(mc);
  }
}
