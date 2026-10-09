#!/usr/bin/env node
// Step 8: tidy the Autumn catalog page and create the scheduled Winter catalog page.
const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const getKey = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const api = new GhostAdminAPI({ url: getKey('ghost-url-inkhorn'), key: getKey('ghost-admin-inkhorn'), version: 'v5.0' });
const LOG = path.join(__dirname, '..', 'build-log.md');
const log = (l) => { console.log(l); fs.appendFileSync(LOG, `- ${l}\n`); };

(async () => {
  const [autumn] = await api.pages.browse({ filter: 'slug:inkhorn-review-no-1-autumn-2026', formats: 'html' });
  await api.pages.edit(
    {
      id: autumn.id,
      updated_at: autumn.updated_at,
      html: '<p>Twenty-five pieces of poetry, fiction and nonfiction on what it costs to be seen, and what it costs not to be.</p>',
      custom_excerpt: 'What it costs to be seen, and what it costs not to be. Twenty-five pieces, in print for the first time.',
    },
    { source: 'html' }
  );
  log(`Step 8: Autumn catalog page ${autumn.id} body replaced with one paragraph; excerpt now says twenty-five (codeinjection_head untouched; old body in backups)`);

  const existing = await api.pages.browse({ filter: 'slug:inkhorn-review-no-2-winter-2026' });
  if (existing.length) return log('Winter catalog page already exists ' + existing[0].id);
  const tags = await api.tags.browse({ limit: 'all' });
  const id = (s) => ({ id: tags.find((t) => t.slug === s).id });
  const w = await api.pages.add(
    {
      title: 'Inkhorn Review No. 2 · Winter 2026',
      slug: 'inkhorn-review-no-2-winter-2026',
      html: '<p>Twenty-five pieces of poetry, fiction and nonfiction, online and in print on December 1.</p>',
      custom_excerpt: 'Twenty-five pieces.',
      featured: true,
      tags: [id('hash-catalog'), id('inkhorn-2'), id('winter-2026')],
      status: 'scheduled',
      published_at: '2026-12-01T15:59:00.000Z',
    },
    { source: 'html' }
  );
  log(`Step 8: created Winter catalog page "${w.title}" (${w.id}) ${w.status} ${w.published_at} (07:59 PST), featured, tags #catalog, inkhorn-2, winter-2026; no cover image yet; ${w.url}`);
})().catch((e) => { console.error(e.message || e, JSON.stringify(e.context || '')); process.exit(1); });
