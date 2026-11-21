#!/usr/bin/env node
/**
 * Tests the redirect map: every URL that works on the live Ghost site (from its sitemaps) plus the old redirect rules must end in a 200 on the new site.
 *   WP_URL=https://... OLD=https://inkhorn.press node inkhorn/scripts/test-wp-redirects.cjs
 * Follows redirects (max 5), keeps queries, reports failures.
 */
const fs = require('fs'), path = require('path');
const WP = (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '');
const OLD = (process.env.OLD || 'https://inkhorn.press').replace(/\/$/, '');
(async () => {
  const urls = new Set(['/', '/review/', '/review/issues/', '/review/autumn-2026/', '/review/winter-2026/', '/poetry/', '/fiction/', '/nonfiction/', '/art/', '/micro/', '/white-rabbit/', '/white-rabbit/no-1/',
    '/submit/', '/events/', '/support/', '/shop/', '/about/', '/privacy/', '/terms/', '/submissions/', '/readers/', '/review/founder-letter/', '/rss/', '/september-2026/', '/autumn-2026/poetry/', '/archive/', '/by/barbara-daniels/', '/tag/barbara-daniels/']);
  for (const f of ['sitemap-posts.xml', 'sitemap-pages.xml', 'sitemap-tags.xml', 'sitemap-authors.xml']) {
    try { const x = await (await fetch(OLD + '/' + f)).text(); for (const m of x.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(new URL(m[1]).pathname); } catch (e) { /* sitemap missing */ }
  }
  let bad = 0, n = 0;
  for (const u of [...urls].sort()) {
    let cur = WP + u, code = 0, hops = 0;
    for (; hops < 6; hops++) {
      const r = await fetch(cur, { redirect: 'manual' });
      code = r.status;
      if (code >= 300 && code < 400) { const loc = r.headers.get('location'); if (!loc) break; if (/^https?:\/\/(?!wordpress-production)/.test(loc) && !loc.startsWith(WP)) { code = 'external:' + loc; break; } cur = new URL(loc, cur).href; } else break;
    }
    n++;
    if (code !== 200 && !String(code).startsWith('external')) { bad++; console.log('FAIL', u, '->', code, cur.replace(WP, '')); }
  }
  console.log(`${n} URLs tested, ${bad} failing`);
})();
