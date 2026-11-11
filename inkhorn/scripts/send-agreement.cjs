#!/usr/bin/env node
/**
 * Sends a contributor agreement from DocuSeal and records it in the tracker.
 *
 * Usage:
 *   node inkhorn/scripts/send-agreement.cjs --name "Full Name" --email a@b.com --titles "Title 1|Title 2" \
 *        --issue winter-2026 --amount 25 [--deadline-days 14] [--no-pull] [--dry]
 *
 *   --amount 0 sends the unpaid template; > 0 sends the paid template with that amount (total for all titles).
 *   Deadline: release date minus 30 days, or --deadline-days N from today (Winter 2026 uses 14).
 *   --no-pull: the piece is already published, so a missed deadline never unpublishes it (cron records "cash by default").
 *   --dry: prints what would be sent and changes nothing.
 * Needs the Keychain items docuseal-inkhorn-token, ghost-url-inkhorn, ghost-admin-inkhorn (or env DOCUSEAL_TOKEN, GHOST_*).
 */
const L = require('../agreements-lib.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };

(async () => {
  const name = arg('name'), email = arg('email'), issue = arg('issue');
  const titles = String(arg('titles', '')).split('|').map((s) => s.trim()).filter(Boolean);
  const amount = Number(arg('amount', 0));
  if (!name || !email || !issue || !titles.length) throw new Error('--name, --email, --issue and --titles are required');
  const paid = amount > 0;
  const rel = L.ymd(L.releaseDate(issue));
  const today = L.todayPacific();
  const dlDays = arg('deadline-days');
  const deadline = dlDays ? L.addDays(today, Number(dlDays)) : L.addDays(rel, -30);
  const noPull = !!arg('no-pull');
  const pieces = titles.map((t) => { const p = L.findPiece(issue, t); if (!p) throw new Error(`"${t}" is not in editions-2026.json for ${issue}`); return p; });
  const templateName = paid ? 'Inkhorn Review Contributor Agreement (Paid)' : 'Inkhorn Review Contributor Agreement';
  const tpls = await L.ds('GET', '/templates?limit=100');
  const tpl = tpls.data.find((t) => t.name === templateName);
  if (!tpl) throw new Error('template not found in DocuSeal: ' + templateName);
  const values = {
    'Legal name': name, 'Piece titles': titles.join('; '), 'Issue': L.issueName(issue), 'Issue release date': L.pretty(rel), 'Signing deadline': L.pretty(deadline),
    ...(paid ? { Amount: '$' + amount } : {}),
  };
  console.log(JSON.stringify({ name, email, template: templateName, values, deadline, noPull }, null, 1));
  if (arg('dry')) return;
  const api = L.ghost();
  const tracker = await L.loadTracker(api);
  const dup = tracker.records.find((r) => r.email.toLowerCase() === email.toLowerCase() && r.issue === issue && pieces.some((p) => p.slug === r.slug) && r.status !== 'expired');
  if (dup) throw new Error(`already sent to ${email} for ${dup.title} (submission ${dup.submission_id}); not sending again`);
  const subs = await L.ds('POST', '/submissions', {
    template_id: tpl.id, send_email: true,
    message: {
      subject: `Your Inkhorn Review contributor agreement (${L.issueName(issue)})`,
      body: `Hello ${name.split(' ')[0]},\n\nThank you for contributing to Inkhorn Review. Please read and sign your contributor agreement for ${titles.join('; ')} by ${L.pretty(deadline)}. Inkhorn Review cannot publish a piece without the signed agreement.\n\n{{submitter.link}}\n\nQuestions? Reply to this email.\n\nInkhorn Review`,
    },
    submitters: [{ role: 'Contributor', email, name, values }],
  });
  const sub = subs[0];
  for (const p of pieces) {
    tracker.records.push({
      issue, slug: p.slug, title: p.title, contributor: name, email, template: paid ? 'paid' : 'unpaid', amount: paid ? amount : 0,
      submission_id: sub.submission_id, submitter_slug: sub.slug, sent: today, deadline, status: 'sent', choice: null, pay_method: null,
      on_deadline: noPull ? 'record-cash-default' : 'pull', reminded: false, pulled: false, comp_granted: false,
    });
  }
  await L.saveTracker(api, tracker);
  console.log(`Sent submission ${sub.submission_id} to ${email}; deadline ${deadline}; ${pieces.length} record(s) added.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
