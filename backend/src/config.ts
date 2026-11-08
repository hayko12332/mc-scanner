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
  // Public https address of the site; Render sets RENDER_EXTERNAL_URL automatically.
  publicUrl: (env('PUBLIC_URL') || env('RENDER_EXTERNAL_URL')).replace(/\/+$/, ''),
};
