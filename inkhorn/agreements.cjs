#!/usr/bin/env node
/**
 * inkhorn/agreements.cjs — daily contributor-agreement check (Railway cron service "agreements").
 *
 * Runs at 8am Pacific (cron "0 15,16 * * *" UTC; the run that is not 8am Pacific exits). Each run:
 *   1. Updates every record's status from DocuSeal (sent -> signed) and reads the contributor's choice (cash or Print subscription).
 *   2. Three days before a deadline, emails hello@terryheath.com the list of unsigned pieces (once per record).
 *   3. After a deadline (the first run on a later date), for each still-unsigned piece:
 *        - on_deadline "pull" (unpublished pieces): sets the Ghost post to draft, then removes it from the running order:
 *          edits data/editions-2026.json and regenerates the partials, commits to GitHub (GITHUB_TOKEN, contents write on
 *          terryheath/terryheath), and uploads+activates the theme through the Admin API (the same two calls as theme/deploy.sh).
 *        - on_deadline "record-cash-default" (already published pieces): records "cash by default"; nothing is unpublished.
 *      It then emails the list. It never publishes anything.
 *   3a. A signed piece (not yet released, still a draft) is scheduled for its slot: noon Pacific on release day + (print position - 1) minutes.
 *   3b. Contributor reminders: DocuSeal re-sends the signature request 7 and 3 days before each deadline (once each).
 *   3c. Every Monday and Thursday: emails Terry the unsigned list per issue with days left (stops per issue once all are signed).
 *   4. A signed agreement with the subscription choice gets a complimentary Print membership (one year) in Ghost; the email asks
 *      Terry to add them to the print mailing list.
 * Env: GITHUB_TOKEN, DOCUSEAL_TOKEN (DOCUSEAL_URL optional), GHOST_API_URL, GHOST_ADMIN_KEY, GHOST_STAFF_TOKEN, optional NOTICE_EMAIL,
 *      AGREEMENTS_MODE=dry (print what would happen, change nothing), FORCE=1 (skip the 8am check).
 */
const L = require('./agreements-lib.cjs');
const DRY = (process.env.AGREEMENTS_MODE || '').toLowerCase() === 'dry';
const FORCE = process.env.FORCE === '1';
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function pacificHour() { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date())) % 24; }

async function updateStatuses(tracker, events) {
  const bySub = {};
  for (const r of tracker.records) if (r.status === 'sent') (bySub[r.submission_id] ||= []).push(r);
  for (const [id, recs] of Object.entries(bySub)) {
    let sub;
    try { sub = await L.ds('GET', `/submissions/${id}`); } catch (e) { console.error(e.message); continue; }
    const s = sub.submitters && sub.submitters[0];
    if (!s || s.status !== 'completed') continue;
    const vals = Object.fromEntries((s.values || []).map((v) => [v.field, v.value]));
    const pc = String(vals['Payment choice'] || '');
    for (const r of recs) {
      r.status = 'signed'; r.signed_at = s.completed_at;
      if (r.template !== 'unpaid') {
        r.choice = /subscription/i.test(pc) ? 'subscription' : (pc ? 'cash' : null);
        r.pay_method = vals['Payment method'] || null; r.pay_details = vals['Payment details'] || null;
      }
      events.signed.push(r);
    }
  }
}

async function grantComp(api, r, events) {
  const tiers = (await L.gfetch('GET', '/tiers/?limit=all')).tiers;
  const print = tiers.find((t) => t.name === 'Print' && t.active);
  if (!print) throw new Error('Print tier not found');
  const expiry = new Date(); expiry.setFullYear(expiry.getFullYear() + 1);
  const found = (await L.gfetch('GET', `/members/?filter=${encodeURIComponent(`email:'${r.email}'`)}`)).members;
  const tier = { id: print.id, expiry_at: expiry.toISOString() };
  if (found.length) await L.gfetch('PUT', `/members/${found[0].id}/`, { members: [{ tiers: [tier] }] });
  else await L.gfetch('POST', '/members/', { members: [{ email: r.email, name: r.contributor, newsletters: [], tiers: [tier] }] });
  r.comp_granted = true; r.comp_expires = expiry.toISOString().slice(0, 10);
  events.comps.push(r);
}

async function pullPost(api, r) {
  const found = await api.posts.browse({ filter: `slug:${r.slug}`, limit: 1, fields: 'id,status,updated_at' });
  if (!found.length) return 'not found in Ghost';
  if (found[0].status === 'draft') return 'already draft';
  await api.posts.edit({ id: found[0].id, updated_at: found[0].updated_at, status: 'draft' });
  return 'set to draft';
}

// Every Monday and Thursday: who has not signed yet, per issue, with the days left. An issue drops out once all of it is signed.
async function weeklyStatus(api, tracker, today) {
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date());
  if (!FORCE && dow !== 'Mon' && dow !== 'Thu') return;
  const byIssue = {};
  for (const r of tracker.records) (byIssue[r.issue] ||= []).push(r);
  const blocks = [];
  for (const [issue, recs] of Object.entries(byIssue)) {
    const open = recs.filter((r) => r.status === 'sent');
    if (!open.length) continue;
    const signed = recs.filter((r) => r.status === 'signed').length;
    open.sort((a, b) => a.deadline.localeCompare(b.deadline));
    blocks.push(`<h3>${esc(L.issueName(issue))}: ${open.length} unsigned, ${signed} signed</h3><ul>` + open.map((r) => {
      const left = L.daysBetween(today, r.deadline);
      return `<li><strong>${esc(r.contributor)}</strong> — ${esc(r.title)} — ${left < 0 ? `<strong>${-left} day(s) past the deadline</strong>` : `${left} day(s) left`} (due ${r.deadline})</li>`;
    }).join('') + '</ul>');
  }
  if (!blocks.length) { console.log('Weekly status: everything is signed; nothing to send.'); return; }
  console.log(`Weekly status (${dow}): ${blocks.length} issue(s) with unsigned agreements.`);
  if (!DRY) await L.notify(api, `Unsigned contributor agreements (${dow} ${today})`, blocks.join('') + '<p>Live view: the payouts page.</p>');
}

(async () => {
  if (!FORCE && pacificHour() !== 8) { console.log(`Not 8am Pacific (hour ${pacificHour()}); nothing to do.`); return; }
  const api = L.ghost();
  const tracker = await L.loadTracker(api);
  if (!tracker.records.length) { console.log('No agreements recorded yet.'); return; }
  const today = L.todayPacific();
  const events = { signed: [], reminders: [], pulled: [], cashDefault: [], comps: [], contribReminders: [], scheduled: [] };

  await updateStatuses(tracker, events);

  for (const r of tracker.records) {
    if (r.status === 'signed' && r.choice === 'subscription' && !r.comp_granted && !DRY) {
      try { await grantComp(api, r, events); } catch (e) { console.error('comp failed for', r.email, e.message); }
    }
  }
  for (const r of tracker.records) {
    if (r.status !== 'sent') continue;
    if (today > r.deadline) {
      if (r.on_deadline === 'pull') {
        const how = DRY ? 'dry run' : await pullPost(api, r);
        r.status = 'expired'; r.pulled = true; r.pulled_at = today; events.pulled.push({ ...r, how });
      } else {
        r.status = 'expired'; r.choice = 'cash by default'; events.cashDefault.push(r);
      }
    } else if (!r.reminded && L.addDays(today, 3) >= r.deadline) {
      r.reminded = true; events.reminders.push(r);
    }
  }

  // Pulled pieces leave the running order: edit editions-2026.json + the partials, commit to GitHub, upload the theme.
  const toApply = tracker.records.filter((r) => r.pulled && !r.applied && r.on_deadline === 'pull');
  if (toApply.length && !DRY) {
    try {
      const res = await L.applyPulls(toApply);
      for (const r of toApply) r.applied = true;
      events.applied = { ...res, count: toApply.length };
    } catch (e) { console.error('running-order update failed:', e.message); events.applyError = e.message; }
  }

  // A piece whose agreement is signed gets scheduled at its slot on release day: noon Pacific plus (print position - 1) minutes. Unsigned pieces
  // stay drafts. Only draft pieces of issues that have not released yet are touched, and only if the slot is still in the future.
  if (!DRY && process.env.SCHEDULE_SIGNED === 'on') { // OFF unless SCHEDULE_SIGNED=on on the Railway `agreements` service (held 2026-11-11 pending Terry's say-so on release times)
    const editions = JSON.parse(require('fs').readFileSync(L.editionsPath, 'utf8')).pieces;
    for (const r of tracker.records) {
      if (r.status !== 'signed' || r.on_deadline !== 'pull' || !r.slug || r.scheduled) continue;
      const piece = editions.find((p) => p.edition === r.issue && L.findPiece(r.issue, p.title) && L.findPiece(r.issue, p.title).slug === r.slug);
      if (!piece) continue;
      const slot = new Date(L.noonPacific(L.ymd(L.releaseDate(r.issue))).getTime() + (piece.position - 1) * 60000);
      if (slot.getTime() < Date.now() + 5 * 60000) continue;
      try {
        const got = await api.posts.browse({ filter: `slug:${r.slug}`, fields: 'id,status,updated_at', limit: 1 });
        if (!got.length) continue;
        if (got[0].status === 'draft') {
          await api.posts.edit({ id: got[0].id, updated_at: got[0].updated_at, status: 'scheduled', published_at: slot.toISOString() });
          events.scheduled.push({ ...r, slot: slot.toISOString() });
        }
        r.scheduled = true;
      } catch (e) { console.error('scheduling failed for', r.slug, e.message); }
    }
  }

  // Contributor reminders from DocuSeal at 7 and at 3 days before the deadline (once each; one email per submission).
  const remindedSubs = new Set();
  for (const r of tracker.records) {
    if (r.status !== 'sent' || r.on_deadline === undefined) continue;
    const left = L.daysBetween(today, r.deadline);
    if (left < 0 || left > 7) continue;
    const due3 = left <= 3 && !r.remind3, due7 = left > 3 && !r.remind7;
    if (!due3 && !due7) continue;
    if (remindedSubs.has(r.submission_id)) { if (due3) r.remind3 = r.remind7 = true; else r.remind7 = true; continue; }
    try {
      if (!DRY && await L.remindSubmission(r, left)) { remindedSubs.add(r.submission_id); events.contribReminders.push({ ...r, left }); }
      if (due3) r.remind3 = r.remind7 = true; else r.remind7 = true;
    } catch (e) { console.error('reminder failed for', r.email, e.message); }
  }

  const list = (rs, extra = () => '') => '<ul>' + rs.map((r) => `<li><strong>${esc(r.title)}</strong> (${esc(r.contributor)}, ${esc(r.email)}, ${esc(r.issue)}; deadline ${r.deadline})${extra(r)}</li>`).join('') + '</ul>';
  const parts = [];
  if (events.reminders.length) parts.push(`<h3>Unsigned, deadline within 3 days</h3>${list(events.reminders)}`);
  if (events.pulled.length) parts.push(`<h3>Pulled (not signed by the deadline)</h3>${list(events.pulled, (r) => ` — Ghost post ${r.how}`)}`);
  if (events.applied) parts.push(`<h3>Running order updated</h3><p>Removed ${events.applied.removed.map((t) => `<em>${esc(t)}</em>`).join(', ')} from the winter running order, committed to GitHub (${events.applied.sha ? events.applied.sha.slice(0, 7) : 'no commit'}) and uploaded the theme.</p>`);
  if (events.applyError) parts.push(`<h3>Running order NOT updated</h3><p>${esc(events.applyError)}. It will retry at the next run; or run <code>node inkhorn/scripts/apply-pulls.cjs</code> and deploy by hand.</p>`);
  if (events.cashDefault.length) parts.push(`<h3>Already published; no choice made by the deadline — recorded "cash by default"</h3>${list(events.cashDefault)}`);
  if (events.comps.length) parts.push(`<h3>Chose the Print subscription — complimentary Print membership granted</h3>${list(events.comps, (r) => ` — through ${r.comp_expires}`)}<p>Add them to the print mailing list.</p>`);
  if (events.contribReminders.length) parts.push(`<h3>Reminders sent to contributors</h3>${list(events.contribReminders, (r) => ` — ${r.left} day(s) left`)}`);
  if (events.scheduled.length) parts.push(`<h3>Signed: scheduled for release day</h3>${list(events.scheduled, (r) => ` — scheduled ${r.slot.replace('T', ' ').slice(0, 16)} UTC`)}`);
  if (events.signed.length) parts.push(`<h3>Signed since the last check</h3>${list(events.signed, (r) => r.choice ? ` — choice: ${esc(r.choice)}${r.pay_method ? ' (' + esc(r.pay_method) + ')' : ''}` : '')}`);
  console.log(`signed ${events.signed.length}, reminders ${events.reminders.length}, pulled ${events.pulled.length}, cash-default ${events.cashDefault.length}, comps ${events.comps.length}${DRY ? ' (dry run: nothing saved or sent)' : ''}`);
  if (DRY) return;
  await L.saveTracker(api, tracker);
  if (parts.length) await L.notify(api, 'Inkhorn contributor agreements', parts.join(''));
  await weeklyStatus(api, tracker, today);
})().catch((e) => { console.error(e.message); process.exit(1); });
