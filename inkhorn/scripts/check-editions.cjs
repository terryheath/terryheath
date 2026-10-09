#!/usr/bin/env node
/**
 * Read-only check of the edition running-order files against Ghost.
 * Reports:
 *   - edition-file slugs that don't resolve to a post
 *   - pieces that aren't published yet
 *   - published inkhorn-1 / inkhorn-2 posts missing from the files
 * Usage: node inkhorn/scripts/check-editions.cjs
 */
const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const getKey = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const api = new GhostAdminAPI({ url: getKey('ghost-url-inkhorn'), key: getKey('ghost-admin-inkhorn'), version: 'v5.0' });
const dir = path.join(__dirname, '..', 'theme', 'partials', 'editions');
const editions = { 'autumn-2026': 'inkhorn-1', 'winter-2026': 'inkhorn-2' };

(async () => {
  const posts = [];
  for (let page = 1; ; page++) {
    const b = await api.posts.browse({ limit: 100, page, include: 'tags', filter: 'status:[draft,published,scheduled]' });
    posts.push(...b);
    if (b.length < 100) break;
  }
  let problems = 0;
  for (const [ed, pubTag] of Object.entries(editions)) {
    const slugs = [...fs.readFileSync(path.join(dir, `${ed}.hbs`), 'utf8').matchAll(/filter="slug:([^"]+)"/g)].map((m) => m[1]);
    console.log(`\n${ed}: ${slugs.length} lines in file`);
    const unresolved = slugs.filter((s) => !posts.find((p) => p.slug === s));
    const unpublished = slugs.map((s) => posts.find((p) => p.slug === s)).filter((p) => p && p.status !== 'published');
    const missing = posts.filter((p) => p.status === 'published' && p.tags.some((t) => t.slug === pubTag) && !slugs.includes(p.slug));
    console.log(`  slugs that don't resolve: ${unresolved.length ? unresolved.join(', ') : 'none'}`);
    console.log(`  pieces not published: ${unpublished.length}${unpublished.length ? '\n' + unpublished.map((p) => `    ${p.slug} (${p.status}${p.status === 'scheduled' ? ' ' + p.published_at : ''})`).join('\n') : ''}`);
    console.log(`  published ${pubTag} posts missing from the file: ${missing.length ? missing.map((p) => p.slug).join(', ') : 'none'}`);
    problems += unresolved.length + missing.length;
  }
  process.exitCode = problems ? 1 : 0;
})().catch((e) => { console.error(e.message || e); process.exit(2); });
