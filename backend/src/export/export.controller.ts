import { BadRequestException, Controller, Get, HttpException, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RateLimiter } from '../analytics/rate-limiter.js';
import { ExportStore, MAX_FILE_BYTES, safeName } from './export.store.js';

/** Temporary download links for exports made inside the Telegram Mini App. */
@Controller('export')
export class ExportController {
  private readonly store = new ExportStore();
  private readonly limiter = new RateLimiter(30, 10 * 60_000);

  /** Body: the raw file (application/octet-stream). Returns the path to download it from. */
  @Post()
  async upload(@Req() req: Request, @Query('name') rawName = '') {
    const name = safeName(rawName);
    if (!name) throw new BadRequestException('Unsupported file');
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '';
    if (!this.limiter.take(ip)) throw new HttpException('Too many exports, try again in a few minutes', 429);
    const data = await readBody(req);
    if (!data.length) throw new BadRequestException('Empty file');
    const id = this.store.put(name, data);
    return { path: `/api/export/${id}/${encodeURIComponent(name)}` };
  }

  @Get(':id/:name')
  download(@Param('id') id: string, @Res() res: Response) {
    const f = this.store.get(id);
    if (!f) throw new NotFoundException('This download link has expired — export again');
    res.set({
      'Content-Type': f.type,
      'Content-Disposition': `attachment; filename="${f.name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(f.data);
  }
}

function readBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_FILE_BYTES) {
        reject(new BadRequestException('File too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
