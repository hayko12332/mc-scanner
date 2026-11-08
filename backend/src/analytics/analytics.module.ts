import { Module } from '@nestjs/common';
import { AnalyticsController, FeedbackController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

/** Records what users do on the site (and in the Telegram bot), and their suggestions. */
@Module({
  controllers: [AnalyticsController, FeedbackController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
