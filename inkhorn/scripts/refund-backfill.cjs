#!/usr/bin/env node
// Applies the fee-refund rule (refunds-lib.cjs) to contributors who already signed. DRY RUN unless --live is given.
//   node inkhorn/scripts/refund-backfill.cjs [--issue winter-2026] [--live]
// Refunds only a Duosuma "Fee for ..." charge matched by the contributor's email, once per submission; anything uncertain is flagged on /payouts
// (a "Refund fee" button there). Never emails a writer. Needs the Ghost and DocuSeal Keychain items and a Stripe key (Keychain `stripe-inkhorn-press`
// or STRIPE_SECRET_KEY, e.g. under `railway run`).
const L = require('../agreements-lib.cjs');
const R = require('../refunds-lib.cjs');
(async () => {
  const live = process.argv.includes('--live');
  const i = process.argv.indexOf('--issue');
  const issue = i > -1 ? process.argv[i + 1] : 'winter-2026';
  const api = L.ghost();
  const tracker = await L.loadTracker(api);
  const todo = [];
  for (const r of tracker.records) {
    if (r.issue !== issue || r.status === 'withdrawn') continue;
    let signed = r.status === 'signed';
    if (!signed && r.status === 'sent') { try { const s = await L.ds('GET', `/submissions/${r.submission_id}`); signed = !!(s.submitters && s.submitters[0] && s.submitters[0].status === 'completed'); if (signed) { r.status = 'signed'; r.signed_at = s.submitters[0].completed_at; } } catch { /* leave unsigned */ } }
    if (signed) todo.push(r);
  }
  console.log(`${live ? 'LIVE' : 'DRY RUN'}: ${todo.length} signed ${issue} records`);
  const out = await R.processRecords(tracker.records, todo, { dry: !live });
  for (const o of out) console.log([o.rec.contributor, o.rec.email, o.rec.title, o.action.toUpperCase(), o.detail].join(' | '));
  if (live) { await L.saveTracker(api, tracker); console.log('tracker saved'); }
})().catch((e) => { console.error(e.message); process.exit(1); });
