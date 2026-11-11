#!/usr/bin/env node
// Archives a DocuSeal template ONLY if no submission on it is still pending. Archiving a template breaks every unsigned agreement
// sent from it ("the form has been deleted"), as happened on 2026-11-11. New wording: upload a new template with the same name
// (send-agreement uses the newest template of a name), leave the old one active until its submissions are signed, then archive it here.
// Usage: node inkhorn/scripts/archive-template.cjs <template id> [--yes]
const L = require('../agreements-lib.cjs');
(async () => {
  const id = process.argv[2];
  if (!id) throw new Error('template id required');
  const subs = (await L.ds('GET', '/submissions?limit=100&template_id=' + id)).data.filter((s) => (s.template && String(s.template.id) === String(id)));
  const pending = subs.filter((s) => !['completed', 'declined', 'expired'].includes(s.status) && !s.archived_at);
  if (pending.length) { console.error(`Refusing: ${pending.length} unsigned submission(s) still use template ${id}. Archive them or wait until they are signed.`); process.exit(1); }
  if (!process.argv.includes('--yes')) { console.log(`Template ${id} has no pending submissions; re-run with --yes to archive it.`); return; }
  console.log(JSON.stringify(await L.ds('DELETE', '/templates/' + id)));
})().catch((e) => { console.error(e.message); process.exit(1); });
