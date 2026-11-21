#!/usr/bin/env node
/**
 * Backup of the WordPress network and listmonk to a dated folder (replaces backup-ghost.cjs).
 *   node inkhorn/scripts/backup-network.cjs [YYYY-MM-DD]
 * Writes content.json (every site's posts, pages and Inkhorn types with fields), subscribers.json and campaigns.json (listmonk), and the stores
 * (agreements tracker, podcast guests, ...). The databases themselves are also covered by Railway volume backups.
 */
const fs = require('fs'), path = require('path');
const { execSync } = require('child_process');
const LM = require('../listmonk.cjs');
const WP = (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const out = path.join(process.env.BACKUP_DIR || path.join(require('os').homedir(), 'inkhorn-backups'), date + '-network'); // outside the repo: subscriber and contributor emails fs.mkdirSync(out, { recursive: true });
const wp = async (p) => { const r = await fetch(WP + '/wp-json/inkhorn/v1' + p, { headers: { 'X-Import-Token': TOKEN } }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
(async () => {
  const content = await wp('/export'); fs.writeFileSync(path.join(out, 'content.json'), JSON.stringify(content, null, 2));
  const subs = []; for (let p = 1; ; p++) { const r = await LM.api('GET', `/subscribers?per_page=500&page=${p}`); subs.push(...r.results); if (r.results.length < 500) break; }
  fs.writeFileSync(path.join(out, 'subscribers.json'), JSON.stringify(subs, null, 2));
  fs.writeFileSync(path.join(out, 'campaigns.json'), JSON.stringify(await LM.campaigns(), null, 2));
  for (const k of ['agreements-tracker', 'podcast-guests', 'podcast-headshots']) { try { fs.writeFileSync(path.join(out, k + '.json'), JSON.stringify((await wp('/store/' + k)).value, null, 2)); } catch (e) { console.log(k, 'skipped:', e.message); } }
  const n = Object.values(content).reduce((a, s) => a + s.items.length, 0);
  console.log(`items ${n}, subscribers ${subs.length} -> ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
