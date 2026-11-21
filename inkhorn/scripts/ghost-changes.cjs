#!/usr/bin/env node
/** Read-only: what has changed on the two Ghost sites since the first import into WordPress, and what exists on Ghost but not in WordPress. */
const { execSync } = require('child_process');
const crypto = require('crypto');
const kc = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const jwt = (key) => { const [id, secret] = key.split(':'); const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const iat = Math.floor(Date.now() / 1000); const i = `${b({ alg: 'HS256', kid: id, typ: 'JWT' })}.${b({ iat, exp: iat + 300, aud: '/admin/' })}`; return `${i}.${crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(i).digest('base64url')}`; };
const SINCE = process.argv[2] || '2026-11-18T00:00:00Z';
const WP = 'https://wordpress-production-754b3e08.up.railway.app';
async function ghost(url, key, path) { const out = []; for (let page = 1; ; page++) { const r = await fetch(`${url}/ghost/api/admin/${path}${path.includes('?') ? '&' : '?'}limit=100&page=${page}&fields=id,slug,title,status,updated_at,published_at,type`, { headers: { Authorization: `Ghost ${jwt(key)}`, 'Accept-Version': 'v5.0' } }); const d = await r.json(); const k = Object.keys(d).find((x) => Array.isArray(d[x])); out.push(...d[k]); if (!d.meta || page >= d.meta.pagination.pages) break; } return out; }
const wpSlugs = async (site, type) => { const s = new Set(); for (let p = 1; ; p++) { const r = await fetch(`${WP}${site}/wp-json/wp/v2/${type}?per_page=100&page=${p}&status=publish,future,draft&_fields=slug`); if (!r.ok) break; const d = await r.json(); d.forEach((x) => s.add(x.slug)); if (d.length < 100) break; } return s; };
(async () => {
  for (const [name, url, keyName, wpSites] of [['inkhorn.press', kc('ghost-url-inkhorn'), 'ghost-admin-inkhorn', [['/review', 'ih_piece'], ['', 'page'], ['/review', 'page']]], ['terryheath.com', 'https://terryheath.com', 'ghost-admin-terryheath', [['/terryheath', 'posts'], ['/terryheath', 'pages'], ['/lifeonwords', 'ih_episode']]]]) {
    const key = kc(keyName); const items = [...await ghost(url, key, 'posts/?filter=status:[published,scheduled,draft]'), ...await ghost(url, key, 'pages/')];
    const have = new Set(); for (const [site, type] of wpSites) for (const s of await wpSlugs(site, type)) have.add(s);
    const changed = items.filter((i) => i.updated_at > SINCE); const missing = items.filter((i) => !have.has(i.slug));
    console.log(`\n== ${name}: ${items.length} items on Ghost; ${changed.length} changed since ${SINCE}; ${missing.length} not found in WordPress by slug`);
    for (const i of changed) console.log('  changed', i.updated_at.slice(0, 16), i.status, i.slug);
    for (const i of missing.filter((x) => !changed.includes(x))) console.log('  missing', i.status, i.slug);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
