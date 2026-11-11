#!/usr/bin/env node
// Manual fallback for what the agreements cron does automatically: removes every pulled piece (tracker) from the running order,
// regenerates the partials locally and (without --no-upload) uploads the theme with theme/deploy.sh. Commit and push yourself.
// Usage: node inkhorn/scripts/apply-pulls.cjs [--dry] [--no-upload]
const L = require('../agreements-lib.cjs');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
(async () => {
  const { records } = await L.loadTracker(L.ghost());
  const pulled = records.filter((r) => r.pulled && r.on_deadline === 'pull');
  const { removed, files } = await L.applyPulls(pulled, { commit: false, upload: false });
  console.log(`would remove: ${removed.join(', ') || 'nothing'}`);
  if (process.argv.includes('--dry') || !removed.length) return;
  const root = path.join(__dirname, '..', '..');
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(root, f), text);
  if (!process.argv.includes('--no-upload')) execSync('./deploy.sh', { cwd: path.join(__dirname, '..', 'theme'), stdio: 'inherit' });
})().catch((e) => { console.error(e.message); process.exit(1); });
