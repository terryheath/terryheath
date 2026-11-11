#!/usr/bin/env node
/**
 * Sends a contributor agreement from DocuSeal and records it in the tracker.
 *
 * Usage:
 *   node inkhorn/scripts/send-agreement.cjs --name "Full Name" --email a@b.com --titles "Title 1|Title 2" \
 *        --issue winter-2026 --amount 25 [--deadline-days 14] [--no-pull] [--allow-unknown] [--greeting First] [--dry] [--preview]
 *
 *   --work "poem|prose:1200|art" works out the amount (one entry per title: poem/micro/flash $25, prose up to 1,000 words $25, prose over
 *   1,000 words $40, printed art $40; add :online or `art:online` for online-only work, which is unpaid). --amount overrides it.
 *   --amount 0 sends the unpaid template; > 0 sends the paid template with that amount (total for all titles).
 *   Deadline: release date minus 30 days, or --deadline-days N from today (Winter 2026 uses 14).
 *   --no-pull: the piece is already published, so a missed deadline never unpublishes it (cron records "cash by default"); uses the
 *   "(Paid, Already Published)" template, which has no withdrawal clause.
 *   --preview: prints only the email subject and body.
 *   --dry: prints what would be sent and changes nothing.
 * Needs the Keychain items docuseal-inkhorn-token, ghost-url-inkhorn, ghost-admin-inkhorn (or env DOCUSEAL_TOKEN, GHOST_*).
 */
const L = require('../agreements-lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };

(async () => {
  const name = arg('name'), email = arg('email'), issue = arg('issue');
  const titles = String(arg('titles', '')).split('|').map((s) => s.trim()).filter(Boolean);
  const work = arg('work');
  const amount = arg('amount') !== undefined ? Number(arg('amount')) : work ? String(work).split('|').reduce((n, w) => n + L.payFor(w), 0) : 0;
  const r = await L.sendAgreement({
    name, email, issue, titles, amount, deadlineDays: arg('deadline-days'), noPull: !!arg('no-pull'), greeting: arg('greeting'),
    allowUnknown: !!arg('allow-unknown'), dry: !!arg('dry'), preview: !!arg('preview'),
  });
  if (arg('preview')) { console.log(`Subject: ${r.mail.subject}\n\n${r.mail.body}`); return; }
  console.log(JSON.stringify({ name, email, template: r.template, values: r.values, deadline: r.deadline, noPull: r.noPull }, null, 1));
  if (!arg('dry')) console.log(`Sent submission ${r.submission_id} to ${email}; deadline ${r.deadline}; ${r.records} record(s) added.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
