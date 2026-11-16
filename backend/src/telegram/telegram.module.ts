import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';

/** Telegram bot: /start replies with a button that opens the site as a Mini App. */
@Module({
  imports: [AnalyticsModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  // The dispatch board makes the driver links (t.me/<bot>?start=drv_…).
  exports: [TelegramService],
})
export class TelegramModule {}
