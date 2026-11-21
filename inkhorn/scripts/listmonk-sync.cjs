#!/usr/bin/env node
/**
 * Final members sync Ghost -> listmonk (cutover). Sends nothing (confirmed subscriptions, API only).
 *  - new Ghost members: added on the lists they chose (as listmonk-import.cjs);
 *  - subscribers that came from the Ghost import: a list the member no longer has on Ghost is unsubscribed in listmonk; a list they now have is added;
 *  - subscribers from any other source (signed up in the new setup) are left alone; Ghost-suppressed addresses are blocklisted.
 * Paid and complimentary subscriptions are not touched (Stripe is the source). Muse's list is never touched.
 *   node inkhorn/scripts/listmonk-sync.cjs [--dry]
 */
const { execSync } = require('child_process');
const GhostAdminAPI = require('@tryghost/admin-api');
const L = require('../agreements-lib.cjs');
const LM = require('../listmonk.cjs');
const DRY = process.argv.includes('--dry');
const INKHORN_MAP = { 'inkhorn-review-digest': ['inkhorn-review'], 'white-rabbit': ['white-rabbit'], events: ['events'] };
const TH_MAP = { 'default-newsletter': ['writing', 'digest'] };
const MANAGED = ['inkhorn-review', 'white-rabbit', 'events', 'writing', 'digest'];
async function members(api) { const out = []; for (let p = 1; ; p++) { const b = await api.members.browse({ limit: 100, page: p, include: 'newsletters' }); out.push(...b); if (b.length < 100) break; } return out; }
(async () => {
  const listRows = (await LM.api('GET', '/lists?per_page=all')).results; const byTag = Object.fromEntries(listRows.map((l) => [(l.tags || [])[0], l.id])); const tagOf = Object.fromEntries(listRows.map((l) => [l.id, (l.tags || [])[0]]));
  const th = new GhostAdminAPI({ url: process.env.TH_GHOST_API_URL || 'https://terryheath.com', key: execSync('security find-generic-password -s ghost-admin-terryheath -w').toString().trim(), version: 'v5.0' });
  const want = new Map();
  for (const [api, map] of [[L.ghost(), INKHORN_MAP], [th, TH_MAP]]) {
    const nl = Object.fromEntries((await api.newsletters.browse({ limit: 'all' })).map((n) => [n.id, n]));
    for (const m of await members(api)) {
      const e = String(m.email).toLowerCase(); const cur = want.get(e) || { name: m.name || '', lists: new Set(), suppressed: false };
      for (const n of m.newsletters || []) { const f = nl[n.id]; if (!f || f.status !== 'active') continue; for (const l of map[f.slug] || []) cur.lists.add(l); }
      if (m.email_suppression && m.email_suppression.suppressed) cur.suppressed = true;
      want.set(e, cur);
    }
  }
  const have = new Map();
  for (let p = 1; ; p++) { const r = await LM.api('GET', `/subscribers?per_page=200&page=${p}`); r.results.forEach((s) => have.set(s.email.toLowerCase(), s)); if (r.results.length < 200) break; }
  const stat = { added: 0, listsAdded: 0, unsubscribed: 0, blocklisted: 0, untouched: 0 };
  for (const [email, v] of want) {
    const s = have.get(email);
    if (!s) { if (!DRY) await LM.api('POST', '/subscribers', { email, name: v.name || email.split('@')[0], status: v.suppressed ? 'blocklisted' : 'enabled', lists: [...v.lists].map((l) => byTag[l]).filter(Boolean), preconfirm_subscriptions: true, attribs: { source: 'ghost-import-2026-11' } }); console.log('new', email, [...v.lists].join(',') || '(no lists)'); stat.added++; continue; }
    if (v.suppressed && s.status !== 'blocklisted') { if (!DRY) await LM.api('PUT', `/subscribers/${s.id}/blocklist`, {}); console.log('blocklist', email); stat.blocklisted++; }
    if (!s.attribs || s.attribs.source !== 'ghost-import-2026-11') { stat.untouched++; continue; }
    const on = new Set((s.lists || []).filter((l) => l.subscription_status !== 'unsubscribed').map((l) => tagOf[l.id]).filter((t) => MANAGED.includes(t)));
    for (const t of MANAGED) {
      if (v.lists.has(t) && !on.has(t)) { if (!DRY) await LM.api('PUT', '/subscribers/lists', { ids: [s.id], action: 'add', target_list_ids: [byTag[t]], status: 'confirmed' }); console.log('add list', email, t); stat.listsAdded++; }
      if (!v.lists.has(t) && on.has(t)) { if (!DRY) await LM.api('PUT', '/subscribers/lists', { ids: [s.id], action: 'unsubscribe', target_list_ids: [byTag[t]] }); console.log('unsubscribe', email, t); stat.unsubscribed++; }
    }
  }
  console.log(DRY ? 'DRY RUN' : 'done', JSON.stringify(stat), 'ghost members', want.size, 'listmonk subscribers', have.size);
})().catch((e) => { console.error(e.message); process.exit(1); });
