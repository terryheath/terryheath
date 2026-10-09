#!/usr/bin/env node
// Append winter-2026 as the last (non-primary) tag on the four Winter pieces that live under /autumn-2026/.
const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const getKey = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const api = new GhostAdminAPI({ url: getKey('ghost-url-inkhorn'), key: getKey('ghost-admin-inkhorn'), version: 'v5.0' });
const slugs = ['pigment', 'metal-storm', 'the-incredible-shrinking-coffee-shop-of-paris', 'how-now-brown-cow'];
(async () => {
  const [tag] = await api.tags.browse({ filter: 'slug:winter-2026' });
  for (const slug of slugs) {
    const [p] = await api.posts.browse({ filter: `slug:${slug}`, include: 'tags' });
    if (p.tags.some((t) => t.slug === 'winter-2026')) { console.log('already', slug); continue; }
    const e = await api.posts.edit({ id: p.id, updated_at: p.updated_at, tags: [...p.tags.map((t) => ({ id: t.id })), { id: tag.id }] });
    const line = `Winter tag: appended winter-2026 (last, non-primary) to "${p.title}" (${p.id}); primary ${e.primary_tag.slug}, url ${e.url}, 2nd tag ${e.tags[1].slug}`;
    console.log(line);
    fs.appendFileSync(path.join(__dirname, '..', 'build-log.md'), `- ${line}\n`);
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
