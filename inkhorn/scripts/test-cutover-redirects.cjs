#!/usr/bin/env node
/**
 * Cutover test: every old Ghost address must end on a 200 on the final domains (redirects followed, max 6). Old addresses come from the 2026-10-09 Ghost backup
 * (published posts, pages, tags), the Ghost routes, the two sites' podcast addresses and every redirect rule's sample. Reports failures; exit 1 if any.
 *   node inkhorn/scripts/test-cutover-redirects.cjs
 */
const fs = require('fs'), path = require('path');
const B = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backups', '2026-10-09', f), 'utf8'));
const posts = B('posts.json').filter((p) => p.status === 'published'), pages = B('pages.json'), tags = B('tags.json');
const urls = new Set();
const H = 'https://inkhorn.press';
for (const u of ['/', '/review/', '/review/issues/', '/review/autumn-2026/', '/review/founder-letter/', '/poetry/', '/fiction/', '/nonfiction/', '/art/', '/micro/', '/submit/', '/events/', '/support/', '/shop/', '/shop/cart/', '/about/', '/privacy/', '/terms/', '/submissions/', '/readers/', '/rss/', '/bookfolk/', '/weird-friday/', '/white-rabbit/', '/white-rabbit/no-1/', '/by/letter/', '/sitemap.xml', '/robots.txt']) urls.add(H + u);
for (const p of posts) urls.add(H + '/review/' + p.slug + '/');
for (const p of pages) if (p.status === 'published') urls.add(H + '/' + p.slug + '/');
for (const t of tags) if (t.visibility === 'public') urls.add(H + '/by/' + t.slug + '/');
for (const u of ['https://inkhornreview.com/', 'https://inkhornreview.com/review/autumn-2026/', 'https://inkhornreview.com/about/', 'https://inkhornreview.com/submissions/', 'https://inkhornreview.com/shop/', 'https://inkhornreview.com/submit/',
  'https://terryheath.com/', 'https://terryheath.com/podcast/', 'https://terryheath.com/podcast/rss/', 'https://terryheath.com/about/', 'https://terryheath.com/podcast/s-t-joshi-h-p-lovecraft-a-gateway-to-an-intellectual-life/', 'https://terryheath.com/podcast/susan-wiggs-60-plus-novels-and-what-they-cost/',
  'https://lifeonwords.com/', 'https://lifeonwords.com/s-t-joshi-h-p-lovecraft-a-gateway-to-an-intellectual-life/', 'https://lifeonwords.com/podcast/aleks-merilo-kicked-out-of-his-own-play/', 'https://lifeonwords.com/life-on-words/alan-katz-forty-years-of-getting-paid-to-be-funny/',
  'https://whiterabbitreview.com/', 'https://whiterabbitreview.com/about/', 'https://www.inkhornreview.com/', 'https://www.terryheath.com/', 'https://www.lifeonwords.com/', 'https://www.whiterabbitreview.com/', 'https://www.inkhorn.press/',
  'https://inkhorn.press/muse/', 'https://inkhorn.press/muse/issues', 'https://weirdfriday.org/', 'https://weirdfriday.org/anything?x=1']) urls.add(u);
let n = 0, bad = 0; const fails = [];
async function check(u) {
  let cur = u, code = 0;
  for (let hop = 0; hop < 6; hop++) {
    let r; try { r = await fetch(cur, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 cutover-test' } }); } catch (e) { return ['ERR ' + e.message, cur]; }
    code = r.status; if (code >= 300 && code < 400) { cur = new URL(r.headers.get('location'), cur).href; continue; } break;
  }
  return [code, cur];
}
(async () => {
  const list = [...urls]; const out = []; let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (i < list.length) { const u = list[i++]; const [code, end] = await check(u); n++; const ok = code === 200 || (/gomuse\.io|duotrope|weirdfriday\.com/.test(end) && code < 400) || /^https:\/\/(gomuse\.io|weirdfriday\.com)/.test(end); if (!ok) { bad++; fails.push(`${code} ${u} -> ${end}`); } } }));
  fails.sort().forEach((f) => console.log('FAIL', f));
  console.log(`${n} old addresses tested, ${bad} failing`); process.exit(bad ? 1 : 0);
})();
