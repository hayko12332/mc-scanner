export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Optional Socrata app token: raises data.transportation.gov rate limits.
  socrataAppToken: process.env.SOCRATA_APP_TOKEN ?? '',
  // SAFER's firewall bans an IP for a few minutes after ~430 requests in 90 s
  // (~5 req/s), so the whole server stays well below that.
  saferRequestsPerSecond: Number(process.env.SAFER_RPS ?? 1.5),
};
