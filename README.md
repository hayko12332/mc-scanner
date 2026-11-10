# LeadHaul

Continuous FMCSA carrier lookup by MC number: walks MC, MC+1, MC+2 … and keeps authorized carriers
(not brokers) that have an email, with phone, authority, insurance and a live SAFER check.

The **Lookup** tab checks one company by MC, USDOT, email or phone: the full FMCSA record, live SAFER, insurance,
other companies sharing the same phone/email, the state business registration (built in for NY, CO, TX, OR and CT
from their open data; links for every other state), and links for UCC liens and federal court / bankruptcy records.

## Structure

- `backend/` — NestJS API, also serves the built frontend
  - `fmcsa/` — FMCSA open data on data.transportation.gov (Company Census, L&I, Motus): carrier scan and insurance
  - `safer/` — live SAFER snapshot lookup and parser, with a shared rate limit and automatic backoff after a 403 ban
  - `registry/` — state business registries published as Socrata open data (NY, CO, TX, OR, CT)
- `frontend/` — React + Vite app; `pages/ScannerPage.tsx` (scan loop in `hooks/useScanner.ts`) and `pages/LookupPage.tsx`

API (all under `/api`): `GET /carriers?from=&to=&mode=strict|lenient`, `GET /carriers/:mc/insurance`,
`GET /lookup?q=&type=auto|mc|dot|email|phone`, `GET /registry?state=&name=`,
`GET /safer/:mc`, `GET /safer/page/:dot`, `GET /health`.

## Run

```sh
npm run setup   # install backend + frontend
npm run build
npm start       # http://localhost:3000
```

Development: `npm run dev:backend` and `npm run dev:frontend` (Vite on :5173 proxies `/api` to :3000).
Tests: `npm test`.

SAFER only answers US IP addresses, so a local run needs a US VPN for SAFER checks; the Render deployment
does not.

## Usage analytics

Every user action is stored in the Postgres table `analytics_events`: page opened, scan started/stopped, lookup
(with the query), details opened, CSV export, copy, external link clicks, and Telegram bot `/start`. Each row has
the time, an anonymous visitor id (kept in the browser), session id, IP, user agent and, inside Telegram, the
verified Telegram user (id, username, name). Without `DATABASE_URL` events go to `backend/data/analytics.ndjson`.

## Telegram bot

Set `TELEGRAM_BOT_TOKEN` (from @BotFather). On start the server registers its webhook
(`/api/telegram/webhook`), a menu button and `/start`; `/start` answers with a button that opens the site as a
Telegram Mini App. Needs a public https address: `RENDER_EXTERNAL_URL` on Render, or `PUBLIC_URL`.

## Environment

`PORT`, `SAFER_RPS` (default 1.5), `SOCRATA_APP_TOKEN` (optional), `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`,
`PUBLIC_URL` (optional), `KEEP_ALIVE` (on by default on Render: pings the site every 10 minutes so the free
instance doesn't fall asleep; `0` turns it off).
