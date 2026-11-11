#!/usr/bin/env node
// Removes every tracker record marked pulled (agreement unsigned at the deadline) from inkhorn/data/editions-2026.json,
// renumbers the issue's positions and regenerates the edition partials. Then push and upload the theme the usual way.
// Usage: node inkhorn/scripts/apply-pulls.cjs [--dry]
const L = require('../agreements-lib.cjs');
const fs = require('fs');
const { execSync } = require('child_process');
(async () => {
  const api = L.ghost();
  const { records } = await L.loadTracker(api);
  const pulled = records.filter((r) => r.pulled && r.on_deadline === 'pull');
  const data = JSON.parse(fs.readFileSync(L.editionsPath, 'utf8'));
  const drop = new Set(pulled.map((r) => `${r.issue}:${r.slug}`));
  const before = data.pieces.length;
  data.pieces = data.pieces.filter((p) => !drop.has(`${p.edition}:${p.slug}`));
  const counters = {};
  for (const p of data.pieces) p.position = (counters[p.edition] = (counters[p.edition] || 0) + 1);
  console.log(`removed ${before - data.pieces.length} piece(s) from the running order`);
  if (process.argv.includes('--dry')) return;
  fs.writeFileSync(L.editionsPath, JSON.stringify(data, null, 2) + '\n');
  console.log(execSync('node inkhorn/scripts/gen-edition-partials.cjs', { cwd: require('path').join(__dirname, '..', '..') }).toString());
})().catch((e) => { console.error(e.message); process.exit(1); });
