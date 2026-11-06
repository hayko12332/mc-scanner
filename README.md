# MC Scanner

Continuous FMCSA carrier lookup by MC number: walks MC, MC+1, MC+2 … and keeps authorized carriers
(not brokers) that have an email, with phone, authority, insurance and a live SAFER check.

## Structure

- `backend/` — NestJS API, also serves the built frontend
  - `fmcsa/` — FMCSA open data on data.transportation.gov (Company Census, L&I, Motus): carrier scan and insurance
  - `safer/` — live SAFER snapshot lookup and parser, with a shared rate limit and automatic backoff after a 403 ban
- `frontend/` — React + Vite app; `hooks/useScanner.ts` drives the scan loop

API (all under `/api`): `GET /carriers?from=&to=&mode=strict|lenient`, `GET /carriers/:mc/insurance`,
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
does not. Environment: `PORT`, `SAFER_RPS` (default 1.5), `SOCRATA_APP_TOKEN` (optional).
