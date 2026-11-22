import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { config } from './config.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexHtml, SEO_PAGES, seoHtml } from './seo.js';

const DIST = fileURLToPath(new URL('../../frontend/dist', import.meta.url));

async function bootstrap() {
  // rawBody: webhooks (Resend receiving) are checked against the exact bytes that were signed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Spreadsheet imports and AI file uploads (base64) can be larger than the default 100 kB.
  app.useBodyParser('json', { limit: '40mb' });
  // Load documents (PDF, photos) are uploaded as raw bytes.
  app.useBodyParser('raw', { type: 'application/octet-stream', limit: '12mb' });
  app.setGlobalPrefix('api');
  // The site lives on its own domain now: pages opened on the old Render address move there for good.
  // The API stays reachable on both (old bot buttons, keep-alive), and so do Google's verification files.
  const home = config.canonicalHost;
  if (home) {
    app.use((req: { method: string; hostname: string; originalUrl: string }, res: { redirect: (code: number, url: string) => void }, next: () => void) => {
      const page = (req.method === 'GET' || req.method === 'HEAD') && !req.originalUrl.startsWith('/api/') && !/^\/google[0-9a-f]+\.html$/.test(req.originalUrl);
      if (page && req.hostname.endsWith('.onrender.com')) return res.redirect(301, `https://${home}${req.originalUrl}`);
      next();
    });
  }
  // One address per page for search engines: "/mc-number-lookup/" → "/mc-number-lookup"; addresses that don't exist
  // answer 404 (with the app, so a person still lands on the home page) instead of a "soft 404" 200.
  app.use((req: { method: string; path: string; originalUrl: string }, res: {
    redirect: (code: number, url: string) => void; status: (c: number) => { type: (t: string) => { send: (b: string) => void } }
  }, next: () => void) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/') || req.path === '/') return next();
    if (req.path.length > 1 && req.path.endsWith('/')) {
      return res.redirect(301, req.path.replace(/\/+$/, '') + req.originalUrl.slice(req.path.length));
    }
    if (SEO_PAGES[req.path] || /^\/google[0-9a-f]+\.html$/.test(req.path)) return next();
    let file = req.path;
    try { file = decodeURIComponent(req.path); } catch { /* keep as typed */ }
    if (!file.includes('..') && existsSync(DIST + file)) return next();
    const html = indexHtml();
    if (/\.[a-z0-9]{2,5}$/i.test(req.path) || !html) return res.status(404).type('text').send('Not found');
    res.status(404).type('html').send(html.replace(/<meta name="robots" content="[^"]*"/, '<meta name="robots" content="noindex"'));
  });
  // Search pages (/new-mc-leads, /mc-number-lookup, /mc-scanner): the app with their own title and text.
  app.use((req: { method: string; path: string }, res: { type: (t: string) => { send: (b: string) => void } }, next: () => void) => {
    const page = (req.method === 'GET' || req.method === 'HEAD') ? SEO_PAGES[req.path.replace(/\/+$/, '')] : undefined;
    const html = page ? indexHtml() : null;
    if (!page || !html) return next();
    res.type('html').send(seoHtml(html, req.path.replace(/\/+$/, ''), page));
  });
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`HaulPanel on http://localhost:${config.port}`, 'Bootstrap');
}
await bootstrap();
