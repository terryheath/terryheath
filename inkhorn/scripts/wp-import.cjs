#!/usr/bin/env node
/**
 * Copies the inkhorn.press Ghost site into the WordPress network (review, hub).
 *   node inkhorn/scripts/wp-import.cjs [--dry]
 * Needs: Ghost keychain items (as agreements-lib.cjs), WP_URL (default the Railway address) and Keychain inkhorn-wp-import-token.
 * Idempotent: every item is upserted by (site, type, slug).
 */
const { execSync } = require('child_process');
const L = require('../agreements-lib.cjs');
const fs = require('fs'), path = require('path');
const DRY = process.argv.includes('--dry');
const WP = (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function put(o) {
  if (DRY) { console.log('would import', o.site, o.type, o.slug); return { id: 0 }; }
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify(o) });
      const t = await r.text();
      if (r.ok) return JSON.parse(t);
      last = `${r.status} ${t.slice(0, 200)}`;
    } catch (e) { last = e.message; }
    await new Promise((res) => setTimeout(res, 4000 * (i + 1)));
  }
  throw new Error(`${o.site}/${o.type}/${o.slug}: ${last}`);
}

// The new stack and the new words (Newsletter, Donate, Subscriptions): applied to imported page text.
const WORDS = [
  [/Ghost \(website and memberships, hosted by PikaPods\)/g, 'WordPress (website, hosted by Railway)'],
  [/Mailgun \(email delivery\), Amazon SES \(order and agreement emails\)/g, 'listmonk (email lists), Amazon SES (email delivery)'],
  [/we use Ghost's built-in analytics, which counts visits and pages viewed without building a profile of you\. Cookies are used to keep members signed in\./g, 'we use no advertising trackers. A cookie is set only when you sign in to your account.'],
  [/Subscribe to the newsletter/g, 'Sign up for the newsletter'],
  [/Purchases, memberships and tips/g, 'Purchases, subscriptions and donations'],
  [/Subscribers and members/g, 'Newsletter readers and subscribers'],
  [/your membership tier/g, 'your subscription'],
  [/memberships/g, 'subscriptions'], [/Memberships/g, 'Subscriptions'], [/membership/g, 'subscription'], [/Membership/g, 'Subscription'],
];
const words = (h) => WORDS.reduce((t, [a, b]) => t.replace(a, b), String(h || ''));

/** Ghost html to WordPress content. Poems: one <p> per stanza with <br> line breaks and no empty paragraphs between. */
function clean(html) {
  return words(String(html || ''))
    .replace(/<!--kg-card-(begin|end):[^>]*-->/g, '')
    .replace(/<p>\s*(?:&nbsp;|<br\s*\/?>)?\s*<\/p>/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

(async () => {
  const api = L.ghost();
  const all = async (res, opts) => { const out = []; for (let p = 1; ; p++) { const b = await api[res].browse({ ...opts, limit: 100, page: p }); out.push(...b); if (b.length < 100) break; } return out; };
  const posts = await all('posts', { include: 'tags,authors', formats: 'html', filter: 'status:[published,scheduled]' });
  const pages = await all('pages', { include: 'tags', formats: 'html', filter: 'status:[published,scheduled,draft]' });
  const tags = await all('tags', {});
  const tagBySlug = Object.fromEntries(tags.map((t) => [t.slug, t]));
  const editions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'editions-2026.json'), 'utf8')).pieces;
  const postBySlug = Object.fromEntries(posts.map((p) => [p.slug, p]));

  // issues (Review site): cover from the catalog page, Autumn is the current issue until Winter releases
  const issueIds = {};
  for (const ed of [...new Set(editions.map((e) => e.edition))]) {
    const cat = pages.find((p) => (p.tags || []).some((t) => t.slug === 'hash-catalog') && new RegExp(ed.replace('-', '.*'), 'i').test(p.slug + ' ' + p.title));
    const label = ed.replace(/^(\w)/, (c) => c.toUpperCase()).replace('-', ' ');
    const r = await put({ site: 'review', type: 'ih_issue', slug: ed, title: label, content: '', status: 'publish', thumbnail_url: cat && cat.feature_image,
      meta: { ih_label: label, ih_release: L.ymd(L.releaseDate(ed)), ih_shop_url: cat ? 'shop/' + cat.slug + '/' : '', ih_current: ed === 'autumn-2026' } });
    issueIds[ed] = r.id; console.log('issue', ed, r.id, 'cover:', cat ? (cat.feature_image || 'none') : 'no catalog page', 'thumbnail:', r.thumbnail, r.thumb_error || '');
  }

  // shop: each catalog page (a book that can be bought) becomes a hub product page
  for (const cp of pages.filter((p) => (p.tags || []).some((t) => t.slug === 'hash-catalog'))) {
    const j = (/<script id="ih-book"[^>]*>([\s\S]*?)<\/script>/.exec(cp.codeinjection_head || '') || [])[1];
    let d = {}; try { d = JSON.parse(j); } catch (e) { /* no shop data on this page */ }
    await put({ site: 'hub', type: 'ih_book', slug: cp.slug, title: cp.title, content: '', excerpt: cp.custom_excerpt || '', status: cp.status === 'published' ? 'publish' : cp.status === 'scheduled' ? 'future' : 'draft', date: cp.published_at, thumbnail_url: cp.feature_image,
      meta: { ih_sku: d.sku || '', ih_isbn: d.isbn || '', ih_preorder: !!d.preorder } });
    console.log('book', cp.slug, d.sku);
  }

  // contributors (hub directory) and pieces (review site)
  const seen = new Set();
  for (const e of editions) {
    const gp = postBySlug[e.slug || L.resolvedSlug(e)] || null;
    const cslug = slugify(e.author);
    if (!seen.has(cslug)) {
      seen.add(cslug);
      await put({ site: 'hub', type: 'ih_contributor', slug: cslug, title: e.author, content: '', status: 'publish', meta: { ih_bio: e.bio || '' } });
    }
    const scheduled = gp ? gp.status === 'scheduled' : e.edition === 'winter-2026';
    await put({
      site: 'review', type: 'ih_piece', slug: e.slug || (gp && gp.slug) || slugify(e.title), title: e.title,
      content: clean(gp ? gp.html : ''), status: scheduled ? 'future' : 'publish', date: gp && gp.published_at, menu_order: e.position,
      terms: { ih_genre: [e.genre.charAt(0).toUpperCase() + e.genre.slice(1)] },
      meta: { ih_issue_id: issueIds[e.edition], ih_position: e.position, ih_author_name: e.author, ih_contributors: cslug, ih_bio: e.bio || '', ih_nomination: e.nomination_line || '', ih_online_only: !!e.online_only },
    });
    process.stdout.write('.');
  }
  console.log('\npieces done:', editions.length);

  // pages
  const keep = { about: ['hub', 'review'], privacy: ['hub'], terms: ['hub'], support: ['hub'], submissions: ['review'], readers: ['review'] };
  for (const p of pages) {
    for (const site of keep[p.slug] || []) {
      await put({ site, type: 'page', slug: p.slug, title: p.title, content: clean(p.html), status: 'publish' });
      console.log('page', site, p.slug);
    }
  }

  // posts outside the issue data (earlier online pieces): same type, no issue
  const covered = new Set(editions.map((e) => e.slug).filter(Boolean));
  const SKIP = ['hash-weekly-email', 'hash-digest', 'hash-catalog', 'podcast', 'digest', 'life-on-words'];
  const left = posts.filter((p) => !covered.has(p.slug) && !(p.tags || []).some((t) => SKIP.includes(t.slug)));
  const genres = ['fiction', 'poetry', 'nonfiction', 'art', 'micro'];
  for (const p of left) {
    const g = (p.tags || []).find((t) => genres.includes(t.slug));
    const by = (p.custom_excerpt || '').replace(/^by\s+/i, '') || (p.authors && p.authors[0] && p.authors[0].name) || '';
    const ct = (p.tags || []).find((t) => t.visibility === 'public' && slugify(t.name) === slugify(by));
    if (ct && !seen.has(ct.slug)) { seen.add(ct.slug); await put({ site: 'hub', type: 'ih_contributor', slug: ct.slug, title: by, content: '', status: 'publish', meta: { ih_bio: ct.description || '' } }); }
    await put({ site: 'review', type: 'ih_piece', slug: p.slug, title: p.title, content: clean(p.html), status: p.status === 'scheduled' ? 'future' : 'publish', date: p.published_at,
      terms: g ? { ih_genre: [g.name.charAt(0).toUpperCase() + g.name.slice(1)] } : {}, thumbnail_url: p.feature_image,
      meta: { ih_issue_id: 0, ih_author_name: by, ih_contributors: ct ? ct.slug : '', ih_bio: (ct && ct.description) || '' } });
    process.stdout.write('+');
  }
  console.log('\nearlier posts copied:', left.length);
  // static hub pages written for the new site (events, support, submit, ...)
  for (const pg of JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'wp-pages.json'), 'utf8'))) { await put({ site: pg.site, type: 'page', slug: pg.slug, title: pg.title, content: pg.content, status: 'publish' }); console.log('page', pg.site, pg.slug); }

  // every person tag becomes a contributor (even without a piece in the issue data); the other public tags are topics and redirect to the Review
  const people = new Set(seen);
  const topics = [];
  for (const t of tags) {
    if (t.visibility !== 'public' || t.slug.startsWith('hash-') || /^(autumn|winter|spring|summer)-20/.test(t.slug) || /^inkhorn-\d+$/.test(t.slug) || genres.includes(t.slug) || ['white-rabbit', 'white-rabbit-no-1', 'letter', 'podcast', 'digest', 'life-on-words'].includes(t.slug)) continue;
    if (people.has(t.slug)) continue;
    const byPerson = posts.some((p) => (p.tags || []).some((x) => x.slug === t.slug) && slugify((p.custom_excerpt || '').replace(/^by\s+/i, '')) === t.slug);
    if (byPerson) { people.add(t.slug); await put({ site: 'hub', type: 'ih_contributor', slug: t.slug, title: t.name, content: '', status: 'publish', meta: { ih_bio: t.description || '' } }); }
    else topics.push(t.slug);
  }
  const rp = path.join(__dirname, '..', '..', 'wp', 'mu-plugins', 'inkhorn-redirects.json');
  const rj = JSON.parse(fs.readFileSync(rp, 'utf8'));
  rj.rules = rj.rules.filter((r) => r._topics !== true);
  const idx = rj.rules.findIndex((r) => r.from.includes('(?:by|tag)/([^/]+)'));
  if (topics.length) rj.rules.splice(idx, 0, { _topics: true, from: '^/(?:by|tag)/(' + topics.join('|') + ')/?$', to: '/review/' });
  fs.writeFileSync(rp, JSON.stringify(rj, null, 2) + '\n');
  console.log('topic tags redirected to /review/:', topics.length, '; contributors:', people.size);
})().catch((e) => { console.error(e.message); process.exit(1); });