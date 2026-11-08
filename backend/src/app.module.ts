import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { fileURLToPath } from 'node:url';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { FmcsaModule } from './fmcsa/fmcsa.module.js';
import { HealthController } from './health.controller.js';
import { RegistryModule } from './registry/registry.module.js';
import { SaferModule } from './safer/safer.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

@Module({
  imports: [
    // The built React app (frontend/dist), served from the same origin as the API.
    ServeStaticModule.forRoot({
      rootPath: fileURLToPath(new URL('../../frontend/dist', import.meta.url)),
      exclude: ['/api/{*path}'],
    }),
    FmcsaModule,
    SaferModule,
    RegistryModule,
    AnalyticsModule,
    TelegramModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
