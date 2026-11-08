import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';

/** Telegram bot: /start replies with a button that opens the site as a Mini App. */
@Module({
  imports: [AnalyticsModule],
  controllers: [TelegramController],
  providers: [TelegramService],
})
export class TelegramModule {}
