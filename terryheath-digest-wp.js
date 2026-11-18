#!/usr/bin/env node
/**
 * terryheath-digest-wp.js — monthly letter draft builder for terryheath.com, on WordPress (replaces terryheath-digest.js, which reads Ghost).
 * On the 1st of each month: creates a DRAFT post "Letter — <Month Year>" (the month just ended) on the terryheath site listing what was published
 * that month on terryheath.com, in the Inkhorn Review and on Life on Words, as plain titled links: raw notes for writing the letter.
 * Idempotent (upserts by slug). Env: WP_URL, INKHORN_IMPORT_TOKEN. DRY_RUN=1 logs only.
 */
const WP = (process.env.WP_URL || '').replace(/\/$/, ''), TOKEN = process.env.INKHORN_IMPORT_TOKEN || '', DRY = process.env.DRY_RUN === '1';
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
(async () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const h = { 'X-Import-Token': TOKEN, 'Content-Type': 'application/json' };
  const r = await fetch(`${WP}/wp-json/inkhorn/v1/month-notes?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`, { headers: h });
  if (!r.ok) throw new Error('WordPress ' + r.status);
  const d = await r.json();
  const list = (t, items) => `<h2>${t}</h2>` + (items && items.length ? '<ul>' + items.map((i) => `<li><a href="${esc(i.url)}">${esc(i.title)}</a></li>`).join('') + '</ul>' : '<p>None this month.</p>');
  const content = list('On terryheath.com', d.terryheath) + list('In Inkhorn Review', d.review) + list('On Life on Words', d.lifeonwords);
  console.log(`${label}: ${(d.terryheath || []).length} posts, ${(d.review || []).length} Review pieces, ${(d.lifeonwords || []).length} episodes`);
  if (DRY) return;
  const slug = 'letter-' + start.toISOString().slice(0, 7);
  const p = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: h, body: JSON.stringify({ site: 'terryheath', type: 'post', slug, title: `Letter — ${label}`, content, status: 'draft', skip_if_exists: true }) });
  if (!p.ok) throw new Error('draft failed: ' + p.status);
  const o = await p.json(); console.log(o.existed ? 'Draft already exists, left as is:' : 'Draft created:', o.url);
})().catch((e) => { console.error(e.message); process.exit(1); });
