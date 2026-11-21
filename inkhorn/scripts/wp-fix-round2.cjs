#!/usr/bin/env node
/**
 * One-off data fixes for the 2026-11-20 build list round 2 (idempotent): one product per title, Winter 2026 not public before its release,
 * guest bios taken from what each episode already says about the guest, Terry Heath's own pieces linked to a contributor, and placeholders where
 * copy is still to come. No site copy is written here.
 */
const { execSync } = require('child_process');
const WP = (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
const put = async (o) => { const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify(o) }); const t = await r.text(); if (!r.ok) throw new Error(o.slug + ' ' + r.status + ' ' + t.slice(0, 120)); return JSON.parse(t); };
const get = async (u) => (await fetch(WP + u)).json();
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#8217;/g, '’').replace(/&#8211;/g, '–').replace(/&#8212;/g, '—').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
(async () => {
  console.log('dedupe', JSON.stringify(await put({ site: 'hub', action: 'dedupe_books' })));
  const win = (await get('/review/wp-json/wp/v2/ih_issue?slug=winter-2026&_fields=title,meta'))[0];
  if (win) console.log('winter', JSON.stringify(await put({ site: 'review', type: 'ih_issue', slug: 'winter-2026', title: strip(win.title.rendered), content: '', status: 'future', date: '2026-12-01T12:00:00Z' })));
  // guest bios: the first paragraph of the guest's episode (it already describes the guest)
  const guests = await get('/lifeonwords/wp-json/wp/v2/ih_guest?per_page=100&_fields=id,slug,title');
  const eps = await get('/lifeonwords/wp-json/wp/v2/ih_episode?per_page=100&_fields=content,meta');
  for (const g of guests) {
    const ep = eps.find((e) => Number(e.meta.ih_guest_id) === g.id); if (!ep) continue;
    const paras = [...ep.content.rendered.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => strip(m[1])).filter((t) => t.length > 60 && !/^[▶►]/.test(t) && !/^Timestamps/i.test(t));
    if (paras[0]) { await put({ site: 'lifeonwords', type: 'ih_guest', slug: g.slug, meta_only: true, meta: { ih_bio: paras[0] } }); console.log('bio', g.slug, paras[0].slice(0, 50)); }
  }
  // Terry Heath's own pieces get a contributor
  await put({ site: 'hub', type: 'ih_contributor', slug: 'terry-heath', title: 'Terry Heath', content: '', status: 'publish', meta: { ih_bio: '' } });
  for (const s of ['drive-by-submissions', 'institutionalized']) console.log('link', s, JSON.stringify(await put({ site: 'review', type: 'ih_piece', slug: s, meta_only: true, meta: { ih_contributors: 'terry-heath' } })));
  // copy still to come: marked placeholder, not new wording
  await put({ site: 'review', type: 'page', slug: 'about', title: 'About Inkhorn Review', content: '<p class="ih-ph"><span class="ih-ph-tag">PLACEHOLDER</span> About Inkhorn Review</p>', status: 'publish' });
  await put({ site: 'muse', type: 'page', slug: 'about', title: 'About Muse', content: '', status: 'draft' });
})().catch((e) => { console.error(e.message); process.exit(1); });
