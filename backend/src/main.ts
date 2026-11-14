import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { config } from './config.js';
import { indexHtml, SEO_PAGES, seoHtml } from './seo.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Spreadsheet imports into the CRM can be larger than the default 100 kB.
  app.useBodyParser('json', { limit: '5mb' });
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
