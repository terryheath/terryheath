#!/usr/bin/env node
/** Copies the four private Ghost-page stores into the WordPress network stores (run once before setting STORE_MODE=wp). Idempotent; needs WP_URL, INKHORN_IMPORT_TOKEN. */
const { execSync } = require('child_process');
const L = require('../agreements-lib.cjs');
process.env.WP_URL = process.env.WP_URL || 'https://inkhorn.press';
process.env.INKHORN_IMPORT_TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
const S = require('../store.cjs');
(async () => {
  const api = L.ghost();
  for (const key of ['agreements-tracker', 'podcast-guests', 'podcast-headshots', 'podcast-suggestions', 'admin-hub-auth']) {
    const r = await api.pages.browse({ filter: `slug:${key}`, limit: 1, fields: 'id,codeinjection_head' });
    if (!r.length) { console.log(key, ': no Ghost page, skipped'); continue; }
    const v = JSON.parse(r[0].codeinjection_head || 'null');
    const cur = await S.load(key);
    const ver = await S.save(key, v, cur.version);
    console.log(key, ': copied', Array.isArray(v) ? v.length + ' items' : 'object', 'version', ver);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
