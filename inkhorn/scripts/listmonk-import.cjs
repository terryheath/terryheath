#!/usr/bin/env node
/**
 * Imports the Ghost members of both sites into listmonk (idempotent; NEVER sends anything: subscriptions are pre-confirmed, so no opt-in email goes out).
 *   node inkhorn/scripts/listmonk-import.cjs [--dry]
 * Each member joins the lists that match the ACTIVE Ghost newsletters they are subscribed to today:
 *   inkhorn.press: "Inkhorn Review: the weekly piece" -> inkhorn-review, "White Rabbit" -> white-rabbit, "Inkhorn Press events" -> events
 *   terryheath.com: its one newsletter -> writing and digest (it carries new posts and the monthly letter; "New books" starts empty)
 * Members with no active newsletter are imported with no lists. Suppressed (bounced / complained) addresses are blocklisted. Names are kept.
 */
const { execSync } = require('child_process');
const GhostAdminAPI = require('@tryghost/admin-api');
const L = require('../agreements-lib.cjs');
const LM = require('../listmonk.cjs');
const DRY = process.argv.includes('--dry');
const INKHORN_MAP = { 'inkhorn-review-digest': ['inkhorn-review'], 'white-rabbit': ['white-rabbit'], events: ['events'] };
const TH_MAP = { 'default-newsletter': ['writing', 'digest'] };
async function members(api) { const out = []; for (let p = 1; ; p++) { const b = await api.members.browse({ limit: 100, page: p, include: 'newsletters' }); out.push(...b); if (b.length < 100) break; } return out; }
(async () => {
  const lists = Object.fromEntries((await LM.api('GET', '/lists?per_page=all')).results.map((l) => [(l.tags || [])[0], l.id]));
  const th = new GhostAdminAPI({ url: process.env.TH_GHOST_API_URL || 'https://terryheath.com', key: execSync('security find-generic-password -s ghost-admin-terryheath -w').toString().trim(), version: 'v5.0' });
  const sources = [
    ['inkhorn', L.ghost(), INKHORN_MAP], ['terryheath', th, TH_MAP],
  ];
  const want = new Map(); // email -> {name, lists:Set, suppressed}
  for (const [label, api, map] of sources) {
    const nl = Object.fromEntries((await api.newsletters.browse({ limit: 'all' })).map((n) => [n.id, n]));
    const ms = await members(api);
    let on = 0;
    for (const m of ms) {
      const e = String(m.email).toLowerCase();
      const cur = want.get(e) || { name: m.name || '', lists: new Set(), suppressed: false };
      if (m.name && !cur.name) cur.name = m.name;
      for (const n of m.newsletters || []) { const full = nl[n.id]; if (!full || full.status !== 'active') continue; for (const l of map[full.slug] || []) cur.lists.add(l); }
      if (m.email_suppression && m.email_suppression.suppressed) cur.suppressed = true;
      if ((m.newsletters || []).length) on++;
      want.set(e, cur);
    }
    console.log(label, ms.length, 'members;', on, 'subscribed to something');
  }
  const have = new Set();
  for (let p = 1; ; p++) { const r = await LM.api('GET', `/subscribers?per_page=200&page=${p}`); r.results.forEach((s) => have.add(s.email.toLowerCase())); if (r.results.length < 200) break; }
  let made = 0, skipped = 0;
  for (const [email, v] of want) {
    if (have.has(email)) { skipped++; continue; }
    const body = { email, name: v.name || email.split('@')[0], status: v.suppressed ? 'blocklisted' : 'enabled', lists: [...v.lists].map((l) => lists[l]).filter(Boolean), preconfirm_subscriptions: true, attribs: { source: 'ghost-import-2026-11' } };
    if (DRY) { console.log('would add', email, [...v.lists].join(',') || '(no lists)', v.suppressed ? 'BLOCKLISTED' : ''); continue; }
    await LM.api('POST', '/subscribers', body); made++;
  }
  const per = {}; for (const v of want.values()) for (const l of v.lists) per[l] = (per[l] || 0) + 1;
  console.log(`added ${made}, already there ${skipped}, total ${want.size}; members per list:`, per);
})().catch((e) => { console.error(e.message); process.exit(1); });
