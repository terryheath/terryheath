#!/usr/bin/env node
/**
 * Copies terryheath.com's Ghost into the network: posts and pages to the terryheath site, the 11 podcast episodes (with the same Ghost ids as GUIDs)
 * and their guests to the lifeonwords site. The podcast feed is served from the terryheath site at /podcast/rss/ by the Inkhorn plugin.
 *   node inkhorn/scripts/wp-import-terryheath.cjs [--dry]
 */
const { execSync } = require('child_process');
const GhostAdminAPI = require('@tryghost/admin-api');
const DRY = process.argv.includes('--dry');
const WP = (process.env.WP_URL || 'https://wordpress-production-754b3e08.up.railway.app').replace(/\/$/, '');
const kc = (s) => execSync(`security find-generic-password -s ${s} -w`).toString().trim();
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || kc('inkhorn-wp-import-token');
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function put(o) {
  if (DRY) { console.log('would import', o.site, o.type, o.slug); return { id: 0 }; }
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify(o) });
      const t = await r.text(); if (r.ok) return JSON.parse(t); last = `${r.status} ${t.slice(0, 200)}`;
    } catch (e) { last = e.message; }
    await new Promise((res) => setTimeout(res, 4000 * (i + 1)));
  }
  throw new Error(`${o.site}/${o.type}/${o.slug}: ${last}`);
}
const clean = (h) => String(h || '').replace(/<!--kg-card-(begin|end):[^>]*-->/g, '').trim();
(async () => {
  const api = new GhostAdminAPI({ url: process.env.TH_GHOST_API_URL || 'https://terryheath.com', key: kc('ghost-admin-terryheath'), version: 'v5.0' });
  const all = async (res, opts) => { const out = []; for (let p = 1; ; p++) { const b = await api[res].browse({ ...opts, limit: 100, page: p }); out.push(...b); if (b.length < 100) break; } return out; };
  const posts = await all('posts', { include: 'tags,authors', formats: 'html', filter: 'status:published' });
  const pages = await all('pages', { include: 'tags', formats: 'html', filter: 'status:published' });
  const eps = posts.filter((p) => (p.tags || []).some((t) => t.slug === 'podcast'));
  const other = posts.filter((p) => !eps.includes(p));
  console.log('episodes', eps.length, 'posts', other.length, 'pages', pages.length);

  const guests = new Map();
  for (const p of eps) {
    const gt = (p.tags || []).find((t) => t.visibility === 'public' && !/^life on words/i.test(t.name) && t.slug !== 'podcast');
    let gid = 0;
    if (gt) {
      if (!guests.has(gt.slug)) {
        const r = await put({ site: 'lifeonwords', type: 'ih_guest', slug: gt.slug, title: gt.name, content: '', status: 'publish', thumbnail_url: p.feature_image, meta: { ih_bio: gt.description || '' } });
        guests.set(gt.slug, r.id);
      }
      gid = guests.get(gt.slug);
    }
    const num = ((p.tags || []).map((t) => /No\. (\d+)/.exec(t.name)).find(Boolean) || [])[1];
    await put({ site: 'lifeonwords', type: 'ih_episode', slug: p.slug, title: p.title, content: clean(p.html), excerpt: p.custom_excerpt || p.excerpt || '', status: 'publish', date: p.published_at, thumbnail_url: p.feature_image,
      meta: { ih_guest_id: gid, ih_guid: p.id, ih_number: num ? Number(num) : 0, ih_categories: (p.tags || []).filter((t) => t.visibility === 'public').map((t) => t.name).join('|'), ih_creator: (p.authors && p.authors[0] && p.authors[0].name) || 'Terry Heath' } });
    process.stdout.write('e');
  }
  for (const p of other) { await put({ site: 'terryheath', type: 'post', slug: p.slug, title: p.title, content: clean(p.html), excerpt: p.custom_excerpt || '', status: 'publish', date: p.published_at, thumbnail_url: p.feature_image }); process.stdout.write('p'); }
  for (const p of pages) { await put({ site: 'terryheath', type: 'page', slug: p.slug, title: p.title, content: clean(p.html), status: 'publish' }); process.stdout.write('g'); }
  console.log('\ndone');
})().catch((e) => { console.error(e.message); process.exit(1); });
