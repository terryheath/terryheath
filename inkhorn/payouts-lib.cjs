// The payouts page (signed agreements, pay and subscriptions, bios to Apply/Ignore, mailing lists), served at admin.terryheath.com/payouts
// behind the admin hub's password (admin-hub.cjs). Live from DocuSeal; refreshed every 30 seconds.
const L = require('./agreements-lib.cjs');
const B = require('./bios-lib.cjs');
const R = require('./refunds-lib.cjs');
const UI = require('./hub-ui.cjs');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// ---- payouts page: live signed/unsigned status, bios waiting for a decision, and the print mailing list (behind the admin password) ---------

// One format for every address: a name repeated at the start of the address is dropped, and every "outside the U.S." spelling becomes "Outside the U.S.".
const OUTSIDE = /^(outside( of)?( the)?( u\.?s\.?a?\.?| united states| states)?\.?|international|non[- ]?u\.?s\.?)$/i;
function normalizeAddress(addr, names = []) {
  let a = String(addr || '').trim();
  for (const n of names.filter(Boolean)) { const re = new RegExp('^' + String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[,\\s]+', 'i'); a = a.replace(re, ''); }
  return OUTSIDE.test(a) ? 'Outside the U.S.' : a;
}
// True when the address is something a mailing label can use (not blank, not just "outside the U.S.").
const addressUsable = (a) => !!a && a !== 'Outside the U.S.' && /\d/.test(a) && a.length >= 12;

let payoutsCache = { at: 0, data: null };
async function payoutsData(force = false) {
  if (!force && payoutsCache.data && Date.now() - payoutsCache.at < 30000) return payoutsCache.data;
  const api = L.ghost();
  const tracker = await L.loadTracker(api);
  const subs = {};
  await Promise.all([...new Set(tracker.records.map((r) => r.submission_id))].map(async (id) => { try { subs[id] = await L.ds('GET', `/submissions/${id}`); } catch { subs[id] = null; } }));
  const rows = tracker.records.map((r) => {
    const sub = subs[r.submission_id]; const sm = sub && sub.submitters && sub.submitters[0];
    const vals = Object.fromEntries(((sm && sm.values) || []).map((v) => [v.field, v.value]));
    const signed = !!(sm && sm.status === 'completed');
    const choice = r.choice_override || (!signed || r.template === 'unpaid' ? '' : /subscription/i.test(String(vals['Payment choice'] || '')) ? 'Print subscription' : (vals['Payment choice'] ? 'Cash' : ''));
    return { ...r, signed, choice, method: vals['Payment method'] || '', details: vals['Payment details'] || '', signed_at: sm && sm.completed_at ? sm.completed_at.slice(0, 10) : '',
      name_in_print: B.clean(vals['Name in print']), bio_signed: B.clean(vals['Bio']), address: normalizeAddress(String(vals['Mailing address'] || '').replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean).join(', '), [r.contributor, B.clean(vals['Name in print'])]) };
  });
  // bios waiting: show what is there now next to what was signed
  let data = null;
  const pending = rows.filter((r) => r.signed && r.bio_state === 'pending');
  const waiting = [];
  if (pending.length) { try { data = await B.editionsLive(); } catch { data = null; } }
  for (const r of pending) {
    let cur = null; try { cur = data ? await B.currentFor(api, data, r) : null; } catch { cur = null; }
    waiting.push({ r, cur });
  }
  payoutsCache = { at: Date.now(), data: { rows, waiting } };
  return payoutsCache.data;
}
const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const mailingRows = (rows, issue) => rows.filter((r) => r.issue === issue && r.signed && r.choice !== 'Ebook' && (r.address || r.name_in_print)).map((r) => ({ name: r.name_in_print || r.contributor, address: r.address, piece: r.title }));
function mailingCsv(rows, issue) { return ['Name in print,Address,Piece', ...mailingRows(rows, issue).map((m) => [m.name, m.address, m.piece].map(csvCell).join(','))].join('\n') + '\n'; }


// The "Fee refund" cell: plain statuses (Refunded / Not eligible / Needs a decision), see refunds-lib.cjs. Charge ids sit behind a "details" link.
const refundOpen = (r) => !!(r.signed && !r.refund && !r.refund_dismissed && !r.refund_skipped && r.refund_flag);
function refundCell(r) {
  if (!r.signed) return '';
  const rid = esc(r.submission_id + '|' + r.title);
  if (r.refund) return `<span class="ok">Refunded $${(r.refund.amount / 100).toFixed(2)}</span><br><details><summary class="small">details</summary><small>Refund ${esc(r.refund.refund_id)} · ${esc(r.refund.date)}${r.refund.covered_by ? ' (one refund for this submission; see ' + esc(r.refund.covered_by) + ')' : ''}${r.refund.by === 'manual' ? ' · by hand' : ''}</small></details>`;
  if (r.refund_dismissed) return '<span class="small">Not eligible: no fee was paid</span>';
  if (r.refund_skipped) return `<span class="small">Not eligible: the fee was paid before the refund policy</span><br><details><summary class="small">details</summary><small>Charge ${esc(r.refund_skipped.charge)}</small></details>`;
  const fl = r.refund_flag;
  if (!fl) return '<span class="small">Not checked yet (the daily run checks it)</span>';
  const cands = fl.candidates || [];
  const pick = cands.length > 1 ? `<label class="small">Which charge? <select name="charge">${cands.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>` : cands.length ? `<input type="hidden" name="charge" value="${esc(cands[0])}"><small>Charge ${esc(cands[0])}</small>` : '<label class="small">Fee charge id <input name="charge" placeholder="ch_…" size="22"></label>';
  return `<strong class="bad" id="refund-${rid.replace(/[^A-Za-z0-9]/g, '')}">Needs a decision</strong><br><span class="small">${fl.kind === 'nocharge' ? 'No Duosuma fee found for this email. Usually a free call.' : 'Check before refunding.'} ${esc(fl.reason)}</span>
    <form method="post" action="/payouts/refund" class="act" onsubmit="return confirm('Refund this submission fee in full? This cannot be undone.')"><input type="hidden" name="rid" value="${rid}">${pick}<br><button name="do" value="refund">Refund the fee</button> <button name="do" value="dismiss" class="ghost">No fee was paid</button></form>`;
}
const pacificStamp = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date());
const bioBlock = ({ r, cur }) => `<div class="bio"><p><strong>${esc(r.title)}</strong> · ${esc(r.contributor)}</p>
    <div class="cols"><div><b>Now${cur ? ` (${esc(cur.author)})` : ''}</b>${cur ? `<p>In Ghost: ${esc(cur.ghost_bio || 'no bio yet')}</p><p>In the print file: ${esc(cur.json_bio || 'no bio yet')}</p>` : '<p>No bio on file yet. This piece is not in the print running order (editions-2026.json), so there is nothing to compare with and Apply cannot run until it is added.</p>'}</div>
    <div><b>Signed (name in print: ${esc(r.name_in_print || '—')})</b><p>${esc(r.bio_signed)}</p></div></div>
    <form method="post" action="/payouts/bio" class="act"><input type="hidden" name="rid" value="${esc(r.submission_id + '|' + r.title)}">
    ${cur ? '<button name="do" value="preview">Apply…</button> ' : ''}<button name="do" value="ignore" class="ghost">Ignore</button> <span class="hint">Apply… shows exactly what will change and asks you to confirm. The nomination line is kept, and you can undo an Apply.</span></form></div>`;

async function payoutsHtml({ msg = '' } = {}) {
  const { rows, waiting } = await payoutsData();
  const today = L.todayPacific();
  const byIssue = {};
  for (const r of rows) (byIssue[r.issue] ||= []).push(r);
  const money = (n) => (n ? `$${n}` : '—');
  const nRefund = rows.filter(refundOpen).length;
  const noAddr = rows.filter((r) => r.signed && r.choice === 'Print subscription' && !addressUsable(r.address));
  const decisions = `<div class="status" id="decisions"><strong>Needs a decision:</strong> <a href="#bios">${waiting.length} bio${waiting.length === 1 ? '' : 's'} waiting</a> · <a href="#refunds">${nRefund} fee refund${nRefund === 1 ? '' : 's'} to check</a> · <a href="#noaddress">${noAddr.length} print subscriber${noAddr.length === 1 ? '' : 's'} with no street address</a></div>`;
  const noAddrBox = `<h2 id="noaddress">Print subscribers with no street address <small>${noAddr.length}</small></h2>${noAddr.length ? `<ul>${noAddr.map((r) => `<li><strong>${esc(r.contributor)}</strong> (${esc(L.issueName(r.issue))}), address on the agreement: "${esc(r.address || 'blank')}". Ask for a street address, or change the choice to Ebook if they ask for that.</li>`).join('')}</ul>` : '<p class="ok">Every print subscriber has an address.</p>'}`;
  const queue = `<h2 id="bios">Bios waiting for you <small>${waiting.length}</small></h2>${waiting.length ? waiting.map(bioBlock).join('') : '<p class="ok">No bios are waiting.</p>'}`;
  const refundList = nRefund ? `<h2 id="refunds">Fee refunds to check <small>${nRefund}</small></h2><ul>${rows.filter(refundOpen).map((r) => `<li><strong>${esc(r.contributor)}</strong>, "${esc(r.title)}" (${esc(L.issueName(r.issue))}): use the buttons in the Fee refund column of that issue's table.</li>`).join('')}</ul>` : '<h2 id="refunds">Fee refunds to check <small>0</small></h2><p class="ok">Nothing to check.</p>';
  const blocks = Object.entries(byIssue).map(([issue, rs]) => {
    rs.sort((a, b) => Number(b.signed) - Number(a.signed) || a.deadline.localeCompare(b.deadline) || a.contributor.localeCompare(b.contributor));
    const cashSigned = rs.filter((r) => r.signed && r.choice === 'Cash').reduce((n, r) => n + r.amount, 0);
    const cashPending = rs.filter((r) => !r.signed && r.status !== 'expired' && r.status !== 'withdrawn').reduce((n, r) => n + r.amount, 0);
    const tr = rs.map((r) => {
      const left = L.daysBetween(today, r.deadline);
      const status = r.signed ? `Signed ${esc(r.signed_at)}` : r.status === 'expired' ? 'Expired' : r.status === 'withdrawn' ? 'Withdrawn by the author' : left < 0 ? `Unsigned, ${-left} day(s) late` : `Unsigned, ${left} day(s) left`;
      const how = r.signed ? [r.choice, r.choice_override ? '(changed at the writer\'s request)' : '', r.method, r.details].filter(Boolean).map(esc).join(' · ') : '';
      const bio = !r.signed ? '' : { filled: 'Bio filled in', pending: 'Bio waiting', applied: 'Bio applied', ignored: 'Bio ignored', none: 'No bio typed' }[r.bio_state] || '';
      const undo = r.signed && r.bio_state === 'applied' && r.bio_prev ? `<form method="post" action="/payouts/bio" class="act" onsubmit="return confirm('Put the previous bio and name back?')"><input type="hidden" name="rid" value="${esc(r.submission_id + '|' + r.title)}"><button name="do" value="undo" class="ghost">Undo apply</button></form>` : '';
      return `<tr class="${r.signed ? 'ok' : 'open'}"><td data-label="Contributor">${esc(r.contributor)}${r.name_in_print && r.name_in_print !== r.contributor ? `<br><small>in print: ${esc(r.name_in_print)}</small>` : ''}</td><td data-label="Piece">${esc(r.title)}</td><td data-label="Pay">${money(r.amount)}</td><td data-label="Status">${status}</td><td data-label="Deadline">${esc(r.deadline)}</td><td data-label="Choice · method · details">${how}</td><td data-label="Mailing address">${esc(r.address)}</td><td data-label="Bio">${esc(bio)}${undo}</td><td data-label="Fee refund">${refundCell(r)}</td></tr>`;
    }).join('');
    const ml = mailingRows(rows, issue);
    const mailing = ml.length ? `<h3>Print mailing list, ${esc(L.issueName(issue))} <small>${ml.length} · <a href="/payouts.csv?issue=${esc(issue)}">Download CSV</a> · <a href="#" class="copy" data-t="mail-${esc(issue)}">Copy</a></small></h3>
      <pre id="mail-${esc(issue)}">${esc(ml.map((m) => `${m.name}\t${m.address}`).join('\n'))}</pre>` : '';
    return `<h2>${esc(L.issueName(issue))} <small>${rs.filter((r) => r.signed).length} of ${rs.length} signed · cash signed ${money(cashSigned)} · still to come ${money(cashPending)}</small></h2>
      ${UI.table(`<tr><th>Contributor</th><th>Piece</th><th>Pay</th><th>Status</th><th>Deadline</th><th>Choice · method · details</th><th>Mailing address</th><th>Bio</th><th>Fee refund</th></tr>${tr}`)}${mailing}`;
  }).join('');
  const extraBody = `<script>document.querySelectorAll('a.copy').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var t=document.getElementById(a.dataset.t).innerText;navigator.clipboard.writeText(t).then(function(){a.textContent='Copied'})})})</script>`;
  return UI.page('Payouts', `<h1>Payouts</h1>${msg ? `<p class="note" role="status"><strong>${esc(msg)}</strong></p>` : ''}<p class="why">Live from DocuSeal; refreshed every 30 seconds. Updated ${esc(pacificStamp())}.</p>${decisions}${queue}${refundList}${noAddrBox}${blocks || '<p>No agreements yet.</p>'}`, { here: 'payouts', extraBody, extraHead: '<style>tr.ok td:nth-child(4){color:#1a6b2a}tr.open td:nth-child(4){color:#a33}</style>' });
}
// The "Apply…" confirmation page: shows the final bio and name in print next to what is there now. Nothing changes until Confirm.
async function payoutsBioPreview(form) {
  const api = L.ghost();
  const tracker = await L.loadTracker(api);
  const rec = tracker.records.find((r) => `${r.submission_id}|${r.title}` === form.rid);
  if (!rec || rec.bio_state !== 'pending') return UI.page('Apply bio', '<h1>Nothing to apply</h1><p>This bio is no longer waiting. <a href="/payouts#bios">Back to payouts</a></p>', { here: 'payouts' });
  const signed = rec.signed_info || await B.readSigned(rec.submission_id);
  const data = await B.editionsLive();
  const cur = await B.currentFor(api, data, rec);
  if (!signed || !signed.bio) return UI.page('Apply bio', '<h1>No signed bio</h1><p>The contributor typed no bio. <a href="/payouts#bios">Back to payouts</a></p>', { here: 'payouts' });
  if (!cur) return UI.page('Apply bio', `<h1>Cannot apply yet</h1><p>"${esc(rec.title)}" is not in the print running order (editions-2026.json) for ${esc(L.issueName(rec.issue))}. Add it there first. <a href="/payouts#bios">Back to payouts</a></p>`, { here: 'payouts' });
  const name = signed.name_in_print || cur.author;
  return UI.page('Apply bio', `<h1>Apply this bio?</h1><p><strong>${esc(rec.title)}</strong> · ${esc(rec.contributor)}</p>
    <div class="cols"><div><h3>Now</h3><p><b>Name in print:</b> ${esc(cur.author)}</p><p><b>In Ghost:</b> ${esc(cur.ghost_bio || 'no bio yet')}</p><p><b>In the print file:</b> ${esc(cur.json_bio || 'no bio yet')}</p></div>
    <div><h3>After you confirm</h3><p><b>Name in print:</b> ${esc(name)}${name !== cur.author ? ' <span class="bad">(the byline changes; the theme is re-uploaded)</span>' : ''}</p><p><b>Bio, in Ghost and the print file:</b> ${esc(signed.bio)}</p><p class="small">The nomination line is kept.</p></div></div>
    <form method="post" action="/payouts/bio"><input type="hidden" name="rid" value="${esc(form.rid)}"><input type="hidden" name="confirmed" value="1"><button name="do" value="apply">Confirm: apply</button> <a href="/payouts#bios">Cancel</a></form><p class="small">After applying, an Undo button on the payouts page puts the previous bio and name back.</p>`, { here: 'payouts' });
}
async function payoutsBio(form) {
  const api = L.ghost();
  const tracker = await L.loadTracker(api);
  const rec = tracker.records.find((r) => `${r.submission_id}|${r.title}` === form.rid);
  const reset = () => { payoutsCache = { at: 0, data: null }; };
  if (form.do === 'undo') {
    if (!rec || rec.bio_state !== 'applied' || !rec.bio_prev) return 'nothing to undo';
    await B.applyBio(api, rec, {}, { restore: rec.bio_prev });
    rec.bio_state = 'pending'; delete rec.bio_prev;
    await L.saveTracker(api, tracker); reset();
    return 'undone: the previous bio and name are back, and this bio is waiting again';
  }
  if (!rec || rec.bio_state !== 'pending') return 'nothing to do';
  if (form.do === 'ignore') { rec.bio_state = 'ignored'; await L.saveTracker(api, tracker); reset(); return 'ignored'; }
  if (form.do !== 'apply') return 'unknown action';
  if (form.confirmed !== '1') return 'Use Apply… and confirm on the next page';
  const signed = rec.signed_info || await B.readSigned(rec.submission_id);
  if (!signed || !signed.bio) return 'no signed bio';
  const r = await B.applyBio(api, rec, signed);
  rec.bio_state = 'applied'; rec.bio_prev = r.prev;
  await L.saveTracker(api, tracker);
  reset();
  return `applied${r.nameChanged ? ' (name in print changed: partial committed, theme uploaded)' : ''}. Undo is on this page.`;
}


// Refund fee / No fee buttons on the payouts page. Refunds exactly one fee charge (never a tip, never one already refunded), once per submission.
async function payoutsRefund(form) {
  const api = L.ghost();
  const tracker = await L.loadTracker(api);
  const rec = tracker.records.find((r) => `${r.submission_id}|${r.title}` === form.rid);
  if (!rec) return 'record not found';
  const done = async (msg) => { await L.saveTracker(api, tracker); payoutsCache = { at: 0, data: null }; return msg; };
  if (form.do === 'dismiss') { if (rec.refund) return 'already refunded'; rec.refund_dismissed = true; rec.refund_flag = undefined; return done('dismissed'); }
  if (form.do !== 'refund') return 'unknown action';
  if (rec.refund) return 'already refunded';
  const sib = tracker.records.find((x) => x !== rec && x.submission_id === rec.submission_id && x.refund && !x.refund.covered_by);
  if (sib) { rec.refund = { ...sib.refund, covered_by: sib.title }; rec.refund_flag = undefined; return done('same submission already refunded'); }
  const chargeId = String(form.charge || '').trim();
  if (!/^ch_[A-Za-z0-9]+$/.test(chargeId)) return 'enter a Stripe charge id (ch_...)';
  const claimed = tracker.records.find((x) => x.refund && x.refund.charge === chargeId);
  if (claimed) return `charge ${chargeId} was already refunded for ${claimed.title}`;
  rec.refund = await R.refundCharge(chargeId, { how: 'manual' });
  rec.refund_flag = undefined;
  return done(`refunded ${rec.refund.refund_id}`);
}

module.exports = { payoutsRefund, payoutsData, payoutsHtml, payoutsBio, payoutsBioPreview, normalizeAddress, addressUsable, mailingCsv, mailingRows, resetCache: () => { payoutsCache = { at: 0, data: null }; } };
