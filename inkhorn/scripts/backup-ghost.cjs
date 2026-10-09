#!/usr/bin/env node
/**
 * Export every post, page and tag from Inkhorn's Ghost to a dated backup folder.
 * Usage: node inkhorn/scripts/backup-ghost.js <YYYY-MM-DD>
 * Credentials come from macOS Keychain (see CLAUDE.md).
 */
const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const getKey = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();

const api = new GhostAdminAPI({ url: getKey('ghost-url-inkhorn'), key: getKey('ghost-admin-inkhorn'), version: 'v5.0' });
const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const out = path.join(__dirname, '..', 'backups', date);
fs.mkdirSync(out, { recursive: true });

async function all(resource, opts) {
  const res = [];
  for (let page = 1; ; page++) {
    const batch = await api[resource].browse({ ...opts, limit: 100, page });
    res.push(...batch);
    if (batch.length < 100) break;
  }
  return res;
}

(async () => {
  const posts = await all('posts', { formats: 'html,lexical', include: 'tags,authors', filter: 'status:[draft,published,scheduled,sent]' });
  const pages = await all('pages', { formats: 'html,lexical', include: 'tags,authors', filter: 'status:[draft,published,scheduled]' });
  const tags = await all('tags', { include: 'count.posts' });
  fs.writeFileSync(path.join(out, 'posts.json'), JSON.stringify(posts, null, 2));
  fs.writeFileSync(path.join(out, 'pages.json'), JSON.stringify(pages, null, 2));
  fs.writeFileSync(path.join(out, 'tags.json'), JSON.stringify(tags, null, 2));
  fs.copyFileSync(path.join(__dirname, '..', 'redirects.yaml'), path.join(out, 'redirects.yaml'));
  console.log(`posts ${posts.length}, pages ${pages.length}, tags ${tags.length} -> ${out}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
