// The payouts page (signed agreements, pay and subscriptions, bios to Apply/Ignore, mailing lists), served at admin.inkhornreview.com/payouts
// behind the admin hub's password (admin-hub.cjs). Live from DocuSeal; refreshed every 30 seconds.
const L = require('./agreements-lib.cjs');
const B = require('./bios-lib.cjs');
const R = require('./refunds-lib.cjs');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// ---- payouts page: live signed/unsigned status, bios waiting for a decision, and the print mailing list (behind the admin password) ---------

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
    const choice = !signed || r.template === 'unpaid' ? '' : /subscription/i.test(String(vals['Payment choice'] || '')) ? 'Print subscription' : (vals['Payment choice'] ? 'Cash' : '');
    return { ...r, signed, choice, method: vals['Payment method'] || '', details: vals['Payment details'] || '', signed_at: sm && sm.completed_at ? sm.completed_at.slice(0, 10) : '',
      name_in_print: B.clean(vals['Name in print']), bio_signed: B.clean(vals['Bio']), address: String(vals['Mailing address'] || '').replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean).join(', ') };
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
const mailingRows = (rows, issue) => rows.filter((r) => r.issue === issue && r.signed && (r.address || r.name_in_print)).map((r) => ({ name: r.name_in_print || r.contributor, address: r.address, piece: r.title }));
function mailingCsv(rows, issue) { return ['Name in print,Address,Piece', ...mailingRows(rows, issue).map((m) => [m.name, m.address, m.piece].map(csvCell).join(','))].join('\n') + '\n'; }


// The "Fee refund" cell: what was refunded, or why it is flagged with a button to refund after checking (see refunds-lib.cjs).
function refundCell(r) {
  if (!r.signed) return '';
  const rid = esc(r.submission_id + '|' + r.title);
  if (r.refund) return `<span class="ok">Refunded $${(r.refund.amount / 100).toFixed(2)}</span><br><small>${esc(r.refund.refund_id)} · ${esc(r.refund.date)}${r.refund.covered_by ? ' (one refund for this submission; see ' + esc(r.refund.covered_by) + ')' : ''}${r.refund.by === 'manual' ? ' · by hand' : ''}</small>`;
  if (r.refund_dismissed) return '<small>No fee (dismissed)</small>';
  if (r.refund_skipped) return `<small>Not refunded: fee paid before the refund policy (${esc(r.refund_skipped.charge)})</small>`;
  const fl = r.refund_flag;
  if (!fl) return '<small>Not checked</small>';
  const cands = fl.candidates || [];
  const pick = cands.length > 1 ? `<select name="charge">${cands.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>` : cands.length ? `<input type="hidden" name="charge" value="${esc(cands[0])}"><small>${esc(cands[0])}</small>` : '<input name="charge" placeholder="ch_… fee charge" size="22">';
  return `<span class="${fl.kind === 'nocharge' ? 'hint' : 'bad'}">${fl.kind === 'nocharge' ? 'No fee charge found' : 'Check before refunding'}</span><br><small>${esc(fl.reason)}</small>
    <form method="post" action="/payouts/refund" class="act" onsubmit="return confirm('Refund this submission fee in full? This cannot be undone.')"><input type="hidden" name="rid" value="${rid}">${pick}<br><button name="do" value="refund">Refund fee</button> <button name="do" value="dismiss" class="ghost">No fee</button></form>`;
}
async function payoutsHtml() {
  const { rows, waiting } = await payoutsData();
  const today = L.todayPacific();
  const byIssue = {};
  for (const r of rows) (byIssue[r.issue] ||= []).push(r);
  const money = (n) => (n ? `$${n}` : '—');
  const queue = waiting.length ? `<h2>Bios waiting for you <small>${waiting.length}</small></h2>` + waiting.map(({ r, cur }) => `<div class="bio"><p><strong>${esc(r.title)}</strong> · ${esc(r.contributor)}</p>
    <div class="cols"><div><b>Now${cur ? ` (${esc(cur.author)})` : ''}</b><p>Ghost: ${esc(cur ? cur.ghost_bio || '(blank)' : '(piece not in editions-2026.json)')}</p><p>editions-2026.json: ${esc(cur ? cur.json_bio || '(blank)' : '')}</p></div>
    <div><b>Signed (name in print: ${esc(r.name_in_print || '—')})</b><p>${esc(r.bio_signed)}</p></div></div>
    <form method="post" action="/payouts/bio" class="act"><input type="hidden" name="rid" value="${esc(r.submission_id + '|' + r.title)}">
    <button name="do" value="apply">Apply</button> <button name="do" value="ignore" class="ghost">Ignore</button> <span class="hint">Apply replaces the bio and name in print in Ghost and editions-2026.json; the nomination line is kept.</span></form></div>`).join('') : '';
  const blocks = Object.entries(byIssue).map(([issue, rs]) => {
    rs.sort((a, b) => Number(b.signed) - Number(a.signed) || a.deadline.localeCompare(b.deadline) || a.contributor.localeCompare(b.contributor));
    const cashSigned = rs.filter((r) => r.signed && r.choice === 'Cash').reduce((n, r) => n + r.amount, 0);
    const cashPending = rs.filter((r) => !r.signed && r.status !== 'expired' && r.status !== 'withdrawn').reduce((n, r) => n + r.amount, 0);
    const tr = rs.map((r) => {
      const left = L.daysBetween(today, r.deadline);
      const status = r.signed ? `Signed ${esc(r.signed_at)}` : r.status === 'expired' ? 'Expired' : r.status === 'withdrawn' ? 'Withdrawn by the author' : left < 0 ? `Unsigned, ${-left} day(s) late` : `Unsigned, ${left} day(s) left`;
      const how = r.signed ? [r.choice, r.method, r.details].filter(Boolean).map(esc).join(' · ') : '';
      const bio = !r.signed ? '' : { filled: 'Bio filled in', pending: 'Bio waiting', applied: 'Bio applied', ignored: 'Bio ignored', none: 'No bio typed' }[r.bio_state] || '';
      return `<tr class="${r.signed ? 'ok' : 'open'}"><td>${esc(r.contributor)}${r.name_in_print && r.name_in_print !== r.contributor ? `<br><small>in print: ${esc(r.name_in_print)}</small>` : ''}</td><td>${esc(r.title)}</td><td>${money(r.amount)}</td><td>${status}</td><td>${esc(r.deadline)}</td><td>${how}</td><td>${esc(r.address)}</td><td>${esc(bio)}</td><td>${refundCell(r)}</td></tr>`;
    }).join('');
    const ml = mailingRows(rows, issue);
    const mailing = ml.length ? `<h3>Print mailing list, ${esc(L.issueName(issue))} <small>${ml.length} · <a href="/payouts.csv?issue=${esc(issue)}">Download CSV</a> · <a href="#" class="copy" data-t="mail-${esc(issue)}">Copy</a></small></h3>
      <pre id="mail-${esc(issue)}">${esc(ml.map((m) => `${m.name}\t${m.address}`).join('\n'))}</pre>` : '';
    return `<h2>${esc(L.issueName(issue))} <small>${rs.filter((r) => r.signed).length} of ${rs.length} signed · cash signed ${money(cashSigned)} · still to come ${money(cashPending)}</small></h2>
      <table><tr><th>Contributor</th><th>Piece</th><th>Pay</th><th>Status</th><th>Deadline</th><th>Choice · method · details</th><th>Mailing address</th><th>Bio</th><th>Fee refund</th></tr>${tr}</table>${mailing}`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Payouts</title>
<style>body{margin:0;background:#faf7f2;color:#222;font:15px/1.45 Georgia,serif}main{max-width:72rem;margin:0 auto;padding:2rem 1rem 4rem}h1{font-weight:normal}h2{font-weight:normal;margin:2rem 0 .5rem}h3{font-weight:normal;margin:1.2rem 0 .3rem}h2 small,h3 small{font-size:.75rem;color:#666}
table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #ddd;padding:.35rem .5rem;text-align:left;vertical-align:top}th{background:#f0ebe2}tr.ok td:nth-child(4){color:#1a6b2a}tr.open td:nth-child(4){color:#a33}
pre{background:#fff;border:1px solid #ddd;padding:.6rem;white-space:pre-wrap;font:13px/1.4 ui-monospace,Menlo,monospace}.bio{background:#fff;border:1px solid #ddd;padding:.7rem 1rem;margin:.6rem 0}.cols{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.cols p{margin:.2rem 0}
button{padding:.35rem .9rem;background:#222;color:#faf7f2;border:0;font:inherit;cursor:pointer}button.ghost{background:#fff;color:#222;border:1px solid #888}.hint{color:#666;font-size:.85rem;margin-left:.5rem}.act{margin-top:.5rem}</style></head>
<body><main><h1>Payouts</h1><p>Live from DocuSeal; refreshed every 30 seconds. Updated ${esc(new Date().toISOString().replace('T', ' ').slice(0, 16))} UTC.</p>${queue}${blocks || '<p>No agreements yet.</p>'}</main>
<script>document.querySelectorAll('a.copy').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var t=document.getElementById(a.dataset.t).innerText;navigator.clipboard.writeText(t).then(function(){a.textContent='Copied'})})})</script></body></html>`;
}
async function payoutsBio(form) {
  const api = L.ghost();
  const tracker = await L.loadTracker(api);
  const rec = tracker.records.find((r) => `${r.submission_id}|${r.title}` === form.rid);
  if (!rec || rec.bio_state !== 'pending') return 'nothing to do';
  if (form.do === 'ignore') { rec.bio_state = 'ignored'; await L.saveTracker(api, tracker); payoutsCache = { at: 0, data: null }; return 'ignored'; }
  if (form.do !== 'apply') return 'unknown action';
  const signed = rec.signed_info || await B.readSigned(rec.submission_id);
  if (!signed || !signed.bio) return 'no signed bio';
  const r = await B.applyBio(api, rec, signed);
  rec.bio_state = 'applied';
  await L.saveTracker(api, tracker);
  payoutsCache = { at: 0, data: null };
  return `applied${r.nameChanged ? ' (name in print changed: partial committed, theme uploaded)' : ''}`;
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

module.exports = { payoutsRefund, payoutsData, payoutsHtml, payoutsBio, mailingCsv, mailingRows, resetCache: () => { payoutsCache = { at: 0, data: null }; } };
