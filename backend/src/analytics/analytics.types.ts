export interface TelegramUser {
  id: number;
  username: string;
  name: string;
}

/** One stored analytics event. */
export interface StoredEvent {
  at: string;
  visitorId: string;
  sessionId: string;
  event: string;
  props: Record<string, unknown>;
  path: string;
  ip: string;
  country: string;
  userAgent: string;
  referrer: string;
  tgUserId: number | null;
  tgUsername: string;
  tgName: string;
}

/** What the browser sends: a batch of events for one visitor and session. */
export interface EventBatch {
  visitorId: string;
  sessionId: string;
  referrer?: string;
  /** Telegram Mini App initData, verified server-side to identify the Telegram user. */
  tgInitData?: string;
  events: { event: string; props?: Record<string, unknown>; path?: string; at?: string }[];
}
