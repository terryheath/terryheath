#!/usr/bin/env node
// Sends the updated Life on Words guest agreement (email `agreement_updated`) to every guest whose agreement is unsigned: archives the old
// DocuSeal submission, creates a new one from the current template, keeps the original sent_at/deadline/reminder record. Same as the
// "Send updated agreement" button on /podcast. Needs the Ghost + DocuSeal Keychain items and SMTP_USERNAME/SMTP_PASSWORD (e.g. `railway run`).
//   node inkhorn/scripts/send-updated-agreement.cjs [--dry]
const P = require('../podcast-lib.cjs');
(async () => {
  const dry = process.argv.includes('--dry');
  const store = await P.load();
  for (const g of store.guests) await P.refreshAgreement(g);
  const todo = store.guests.filter((g) => !g.pending_send && !g.cancelled && g.agreement && g.agreement.status !== 'signed');
  console.log(`${todo.length} unsigned guests${dry ? ' (dry run)' : ''}`);
  for (const g of todo) {
    if (dry) { console.log(`would send: ${g.name} <${g.email}> (old #${g.agreement.submission_id})`); continue; }
    try { const r = await P.sendUpdatedAgreement(g); console.log(`${r}: ${g.name} <${g.email}> new #${g.agreement.submission_id}`); }
    catch (e) { console.log(`FAILED: ${g.name} <${g.email}>: ${e.message}`); }
    await P.save(store);
  }
})().catch((e) => { console.error(e); process.exit(1); });
