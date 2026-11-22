import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { fileURLToPath } from 'node:url';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { CompanyCheckService } from './crm/company-check.service.js';
import { InvoiceRemindersService } from './crm/invoice-reminders.service.js';
import { EldSyncService } from './crm/integrations/eld-sync.service.js';
import { QboService } from './crm/integrations/qbo.service.js';
import { InboxService } from './crm/inbox/inbox.service.js';
import { InboundController } from './crm/inbox/inbound.controller.js';
import { CrmController } from './crm/crm.controller.js';
import { ExportController } from './export/export.controller.js';
import { FmcsaModule } from './fmcsa/fmcsa.module.js';
import { HealthController } from './health.controller.js';
import { KeepAliveService } from './keep-alive.service.js';
import { RegistryModule } from './registry/registry.module.js';
import { SaferModule } from './safer/safer.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

@Module({
  imports: [
    // The built React app (frontend/dist), served from the same origin as the API.
    ServeStaticModule.forRoot({
      rootPath: fileURLToPath(new URL('../../frontend/dist', import.meta.url)),
      exclude: ['/api/{*path}'],
      serveStaticOptions: {
        // Built files have a content hash in their name: cache them for a year. Pictures and icons for a day.
        setHeaders: (res: { setHeader: (k: string, v: string) => void }, path: string) => {
          if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else if (/\.(png|jpe?g|svg|ico|mp4|webp)$/.test(path)) res.setHeader('Cache-Control', 'public, max-age=86400');
        },
      },
    }),
    FmcsaModule,
    SaferModule,
    RegistryModule,
    AnalyticsModule,
    TelegramModule,
  ],
  controllers: [HealthController, ExportController, CrmController, InboundController],
  providers: [KeepAliveService, CompanyCheckService, InvoiceRemindersService, EldSyncService, QboService, InboxService],
})
export class AppModule {}
