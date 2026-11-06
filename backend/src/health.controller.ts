import { Controller, Get } from '@nestjs/common';
import { config } from './config.js';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { ok: true, saferRequestsPerSecond: config.saferRequestsPerSecond };
  }
}
