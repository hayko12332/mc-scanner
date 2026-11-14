import { describe, expect, it } from 'vitest';
import { SEO_PAGES, seoHtml } from './seo.js';

const INDEX = `<html><head><title>HaulPanel — home</title>
<meta name="description" content="home text" /><link rel="canonical" href="https://haulpanel.com/" />
<meta property="og:url" content="https://haulpanel.com/" /><meta property="og:title" content="home" /><meta property="og:description" content="home" />
<meta name="twitter:title" content="home" /><meta name="twitter:description" content="home" /></head>
<body><div id="root"><main style="max-width: 760px">old text</main></div></body></html>`;

describe('Search pages', () => {
  it('give each path its own title, description, canonical URL and text', () => {
    const html = seoHtml(INDEX, '/new-mc-leads', SEO_PAGES['/new-mc-leads']);
    expect(html).toContain('<title>New MC Leads');
    expect(html).toContain('<link rel="canonical" href="https://haulpanel.com/new-mc-leads"');
    expect(html).toContain('og:url" content="https://haulpanel.com/new-mc-leads"');
    expect(html).toMatch(/name="description" content="New MC leads every day/);
    expect(html).toContain('<h1>New MC leads');
    expect(html).not.toContain('old text');
    expect(html).not.toContain('home text');
  });
  it('escapes text safely', () => {
    const html = seoHtml(INDEX, '/x', { title: 'A & <B>', description: 'say "hi"', h1: 'h', intro: 'i', points: [] });
    expect(html).toContain('<title>A &amp; &lt;B&gt;</title>');
    expect(html).toContain('content="say &quot;hi&quot;"');
  });
});
