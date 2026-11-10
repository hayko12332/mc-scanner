// Telegram Mini App bridge (https://core.telegram.org/bots/webapps), loaded by index.html.

interface TelegramWebApp {
  initData: string
  ready(): void
  expand(): void
  openLink(url: string): void
  isVersionAtLeast(version: string): boolean
  /** Bot API 8.0+: asks the user to save a file from an https URL. */
  downloadFile?(params: { url: string; file_name: string }, callback?: (accepted: boolean) => void): void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

/** The Mini App object when the site runs inside Telegram, else null. */
export function telegramApp(): TelegramWebApp | null {
  const app = window.Telegram?.WebApp
  return app && app.initData ? app : null
}

/** Signed initData that the server verifies to know which Telegram user this is. */
export const telegramInitData = () => telegramApp()?.initData ?? ''

export function initTelegram(): void {
  const app = telegramApp()
  if (!app) return
  app.ready()
  app.expand()
  document.documentElement.classList.add('in-telegram')
}
