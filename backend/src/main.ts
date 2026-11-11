import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { config } from './config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Spreadsheet imports into the CRM can be larger than the default 100 kB.
  app.useBodyParser('json', { limit: '5mb' });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`LeadHaul on http://localhost:${config.port}`, 'Bootstrap');
}
await bootstrap();
