import { Body, Controller, ForbiddenException, Headers, HttpCode, Logger, NotFoundException, Post } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { TelegramService, type TgUpdate } from './telegram.service.js';

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private readonly telegram: TelegramService) {}

  /** POST /api/telegram/webhook — called by Telegram for every message to the bot. */
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: TgUpdate) {
    if (!this.telegram.enabled) throw new NotFoundException();
    const expected = Buffer.from(this.telegram.webhookSecret);
    const given = Buffer.from(secret ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ForbiddenException();
    try {
      await this.telegram.handle(update);
    } catch (e) {
      // Answer 200 anyway, otherwise Telegram keeps re-sending the same update.
      this.logger.error(`Update ${update?.update_id}: ${(e as Error).message}`);
    }
    return { ok: true };
  }
}
