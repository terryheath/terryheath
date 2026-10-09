#!/usr/bin/env node
// Step 8 follow-up: give the Autumn catalog page the autumn-2026 season tag so edition-contents can pick its edition file.
const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const getKey = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const api = new GhostAdminAPI({ url: getKey('ghost-url-inkhorn'), key: getKey('ghost-admin-inkhorn'), version: 'v5.0' });
(async () => {
  const [pg] = await api.pages.browse({ filter: 'slug:inkhorn-review-no-1-autumn-2026', include: 'tags' });
  const [tag] = await api.tags.browse({ filter: 'slug:autumn-2026' });
  if (pg.tags.find((t) => t.slug === 'autumn-2026')) return console.log('already tagged');
  await api.pages.edit({ id: pg.id, updated_at: pg.updated_at, tags: [...pg.tags.map((t) => ({ id: t.id })), { id: tag.id }] });
  const line = `Step 8: added tag autumn-2026 to Autumn catalog page (${pg.id}) so edition-contents can pick the Autumn file by season tag; page URL unchanged`;
  console.log(line);
  fs.appendFileSync(path.join(__dirname, '..', 'build-log.md'), `- ${line}\n`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
