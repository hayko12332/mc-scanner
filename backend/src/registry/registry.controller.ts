import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RegistryService } from './registry.service.js';
import type { RegistryResult } from './registry.types.js';

@Controller('registry')
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  /** GET /api/registry?state=TX&name=H%26B%20EXPRESS%20LLC */
  @Get()
  search(@Query('state') state = '', @Query('name') name = ''): Promise<RegistryResult> {
    const st = state.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(st)) throw new BadRequestException('state must be a 2-letter code');
    if (name.trim().length < 2 || name.length > 200) throw new BadRequestException('name must be 2-200 characters');
    return this.registry.search(st, name.trim());
  }
}
