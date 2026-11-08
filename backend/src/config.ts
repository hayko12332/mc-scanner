import { fileURLToPath } from 'node:url';

const env = (name: string) => (process.env[name] ?? '').trim();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Optional Socrata app token: raises data.transportation.gov rate limits.
  socrataAppToken: env('SOCRATA_APP_TOKEN'),
  // SAFER's firewall bans an IP for a few minutes after ~430 requests in 90 s
  // (~5 req/s), so the whole server stays well below that.
  saferRequestsPerSecond: Number(process.env.SAFER_RPS ?? 1.5),

  // Analytics storage: Postgres when set (e.g. a free Neon database), else a local file.
  databaseUrl: env('DATABASE_URL'),
  analyticsFile: env('ANALYTICS_FILE') || fileURLToPath(new URL('../data/analytics.ndjson', import.meta.url)),

  // Telegram bot (token from @BotFather). It opens the site as a Telegram Mini App.
  telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
  // Invite link of the community group (https://t.me/...), shown in the bot and on the site.
  telegramGroupUrl: env('TELEGRAM_GROUP_URL'),
  // Public https address of the site; Render sets RENDER_EXTERNAL_URL automatically.
  publicUrl: (env('PUBLIC_URL') || env('RENDER_EXTERNAL_URL')).replace(/\/+$/, ''),
  // Render's free plan puts the service to sleep after 15 idle minutes and the next visitor (or Telegram
  // Mini App) waits ~1 minute for it to wake up. Pinging our own public URL keeps it awake; one service
  // running all month fits in the free 750 instance-hours. On by default on Render, KEEP_ALIVE=0 turns it off.
  keepAlive: env('KEEP_ALIVE') ? env('KEEP_ALIVE') !== '0' : env('RENDER') === 'true',
};
