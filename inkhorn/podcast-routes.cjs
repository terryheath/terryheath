// Life on Words guest system: web routes served on admin.inkhornreview.com (admin-hub.cjs calls these).
//   public (no password):  /podcast/book?token=...        the gate to the hidden Cal.com event (signed agreement required)
//                          /podcast/webhook/<secret>      Cal.com webhook (PODCAST_WEBHOOK_SECRET env var is the <secret>)
//   behind the hub login:  /podcast                       guests, agreements, bookings, reminders, buttons
//                          POST /podcast/add, /podcast/act, /podcast/send-batch;  GET /podcast/pdf?id=...
const P = require('./podcast-lib.cjs');
const L = require('./agreements-lib.cjs');
const crypto = require('crypto');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.5 Georgia,serif;color:#222;background:#fff}main{max-width:72rem;margin:0 auto;padding:1.5rem 1rem 4rem}h1{font-size:1.5rem}h2{font-size:1.15rem;margin:1.8rem 0 .3rem;border-bottom:1px solid #ccc}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.3rem .5rem;text-align:left;vertical-align:top;font-size:.9rem}th{background:#f4f1ea}.warn{background:#fdecea;border:1px solid #e0a09a;padding:.5rem 1rem}.ok{color:#1a6b2a}.bad{color:#a33}
input,select,textarea{font:inherit;padding:.3rem;margin:.15rem 0}button{font:inherit;padding:.25rem .7rem;margin:.1rem}.pre{white-space:pre-wrap;background:#f7f7f7;border:1px solid #ddd;padding:.5rem;font:13px/1.4 ui-monospace,Menlo,monospace}.small{font-size:.85rem;color:#555}details{margin:.3rem 0}</style></head><body><main>${body}</main></body></html>`;
const send = (res, code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); };
const redirect = (res, to, code = 303) => { res.writeHead(code, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
const readBody = (req) => new Promise((res, rej) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 200000) { req.destroy(); rej(new Error('too large')); } }); req.on('end', () => res(b)); });

// ---- public ----------------------------------------------------------------------------------------------------------------
async function publicRoute(req, res, path, query) {
  if (path === '/podcast/book') {
    const token = query.get('token') || '';
    const store = await P.load();
    const g = token.length > 10 ? store.guests.find((x) => eq(x.token, token)) : null;
    if (!g) return send(res, 200, page('Life on Words', `<h1>Life on Words</h1><p>This booking link isn't recognized. Please use the link in your invitation, or reply to that email and I'll send a new one.</p>`)), true;
    await P.refreshAgreement(g);
    await P.save(store);
    if (g.agreement && g.agreement.status === 'signed') {
      const u = new URL(P.CAL_EVENT_URL); u.searchParams.set('name', g.name); u.searchParams.set('email', g.email);
      return redirect(res, u.toString(), 302), true;
    }
    const a = g.agreement ? `<p><a href="${esc(g.agreement.url)}">Sign the guest agreement</a>, then come back to this link to pick a time.</p>` : '<p>Please reply to your invitation email and I will send the agreement.</p>';
    return send(res, 200, page('Life on Words', `<h1>One thing first</h1><p>Hello ${esc(P.firstName(g.name))}, the Life on Words guest agreement isn't signed yet, so I can't show you times.</p>${a}`)), true;
  }
  if (path.startsWith('/podcast/webhook/')) {
    const secret = process.env.PODCAST_WEBHOOK_SECRET || '';
    if (!secret || !eq(path.slice('/podcast/webhook/'.length), secret) || req.method !== 'POST') return send(res, 404, page('Not found', '<h1>Not found</h1>')), true;
    let ev; try { ev = JSON.parse(await readBody(req)); } catch { return send(res, 400, 'bad json'), true; }
    let out; try { out = await P.handleCal(ev); } catch (e) { console.error('cal webhook failed', e); return send(res, 500, 'error'), true; }
    console.log('CAL WEBHOOK', ev.triggerEvent, out);
    return send(res, 200, 'ok'), true;
  }
  return false;
}

// ---- admin page ------------------------------------------------------------------------------------------------------------------
const fmt = (iso, tz) => (iso ? P.when(new Date(iso), tz) : '');
function row(g) {
  const a = g.agreement, b = g.booking;
  const ag = a ? `${esc(a.status)}<br><span class="small">sent ${esc((a.sent_at || '').slice(0, 10))}${a.viewed_at ? `, viewed ${esc(a.viewed_at.slice(0, 10))}` : ''}${a.signed_at ? `, signed ${esc(a.signed_at.slice(0, 10))}` : ''}</span>` : '<span class="small">not sent yet</span>';
  const bk = b ? `${esc(fmt(b.start, P.PACIFIC))} <span class="small">(Pacific)</span><br>${b.tz && b.tz !== P.PACIFIC ? `${esc(fmt(b.start, b.tz))}<br>` : ''}<span class="${b.status === 'booked' ? 'ok' : 'bad'}">${esc(b.status)}</span>` : '<span class="small">no booking</span>';
  const rem = Object.keys(g.reminders || {}).filter((k) => !/^(invite|keep_date|reschedule_notice|signed|booked|agreement_reminder)/.test(k) || /^(agreement_reminder)/.test(k)).map((k) => `${esc(k.split(':')[0])}`).join(', ');
  const sent = Object.keys(g.reminders || {}).map((k) => k.split(':')[0]).join(', ');
  const pl = ['new', 'booked', 'recorded', 'edited', 'published'].map((s) => `<option${g.pipeline === s ? ' selected' : ''}>${s}</option>`).join('');
  const act = (a2, label) => `<form method="post" action="/podcast/act" style="display:inline"><input type="hidden" name="id" value="${esc(g.id)}"><button name="do" value="${a2}">${label}</button></form>`;
  return `<tr><td><strong>${esc(g.name)}</strong><br><span class="small">${esc(g.email)}</span>${g.cancelled ? `<br><span class="bad">${g.cancel_reason === 'unsigned' ? 'Cancelled — unsigned' : 'CANCELLED'}</span>` : ''}${g.kind !== 'invite' ? `<br><span class="small">${esc(g.kind === 'keep_date' ? 'date stands' : g.kind === 'accepted' ? 'already said yes' : 'to reschedule (was ' + g.old_when + ')')}</span>` : ''}</td>
    <td>${ag}${(() => { const d = P.deadlineFor(g); return d && !(a && a.status === 'signed') ? `<br><span class="bad small">sign by ${esc(fmt(d.toISOString(), b.tz || P.PACIFIC))}</span>` : ''; })()}</td><td>${bk}</td><td class="small">${esc(sent)}</td><td>${g.reschedules || 0}</td>
    <td><form method="post" action="/podcast/act" style="display:inline"><input type="hidden" name="id" value="${esc(g.id)}"><select name="to">${pl}</select><button name="do" value="pipeline">Set</button></form><br>${act('recorded', 'Recorded')}${act('edited', 'Edited')}</td>
    <td>${g.cancel_reason === 'unsigned' ? act('resend_cancel', 'Resend cancellation email') : ''}${a && a.status !== 'signed' && !g.cancelled ? `<form method="post" action="/podcast/act" style="display:inline" onsubmit="return confirm('Archive the current agreement link for this guest and email a new one?')"><input type="hidden" name="id" value="${esc(g.id)}"><button name="do" value="updated_agreement">Send updated agreement</button></form>` : ''}${act('resend_invite', 'Resend invite')}${act('resend_book', 'Resend booking link')}${a && a.status === 'signed' ? `<a href="/podcast/pdf?id=${esc(g.id)}">Signed PDF</a>` : ''}</td></tr>`;
}
async function adminPage(msg) {
  const store = await P.load();
  for (const g of store.guests) await P.refreshAgreement(g);
  await P.save(store);
  const now = Date.now();
  const soon = store.guests.filter((g) => g.booking && g.booking.status === 'booked' && !g.cancelled && new Date(g.booking.start) - now < 2 * 86400000 && new Date(g.booking.start) > now - 3600e3 && !(g.agreement && g.agreement.status === 'signed'));
  const warn = soon.length ? `<div class="warn"><strong>Within 2 days and the agreement is NOT signed:</strong> ${soon.map((g) => `${esc(g.name)} (${esc(fmt(g.booking.start, P.PACIFIC))})`).join('; ')}</div>` : '';
  const pending = store.guests.filter((g) => g.pending_send);
  const batch = pending.length ? `<h2>Ready to send (${pending.length})</h2><p class="small">Nothing here has been sent. Read the emails, then send them all with one click.</p>${pending.map((g) => { const kind = P.firstKind(g); const m = P.render(kind, { ...g, agreement: { url: '(your agreement link)' } }); return `<details><summary><strong>${esc(g.name)}</strong> &lt;${esc(g.email)}&gt;: ${esc(m.subject)}</summary><div class="pre">${esc(m.text)}</div></details>`; }).join('')}<form method="post" action="/podcast/send-batch" onsubmit="return confirm('Send these ${pending.length} emails now?')"><button>Send these ${pending.length} emails</button></form>` : '';
  const rows = store.guests.filter((g) => !g.pending_send).map(row).join('');
  return page('Life on Words guests', `<p><a href="/">Admin home</a> · <a href="/payouts">Payouts</a> · <a href="/logout">Sign out</a></p><h1>Life on Words guests</h1>${msg ? `<p class="ok">${esc(msg)}</p>` : ''}${warn}
    <h2>Add guest</h2><form method="post" action="/podcast/add"><input name="name" placeholder="Name" required size="22"> <input name="email" type="email" placeholder="Email" required size="28"><br><textarea name="note" rows="2" cols="70" placeholder="Optional personal note, placed after the greeting and before the first line of the invitation (for example: Thanks for reaching out)"></textarea><br><label><input type="checkbox" name="accepted" value="1"> Add guest who already said yes (sends only the agreement, not the full invitation)</label><br><button>Add guest and send the email</button></form>
    ${batch}<h2>Guests (${store.guests.filter((g) => !g.pending_send).length})</h2>
    <table><tr><th>Guest</th><th>Agreement</th><th>Booked time</th><th>Emails sent</th><th>Resched.</th><th>Status</th><th></th></tr>${rows || '<tr><td colspan="7">No guests yet.</td></tr>'}</table>
    <p class="small">"Published" is set automatically when an episode in the feed carries the guest's name; setting a status by hand here overrides it. Reminders: one week before and two days before at 9:00 a.m. their time; the morning of at 7:00 a.m. their time (6:00 p.m. the evening before if the session starts before 9:00 a.m.).</p>`);
}

async function adminRoute(req, res, path, query) {
  if (path === '/podcast' && req.method === 'GET') return send(res, 200, await adminPage(query.get('msg') || '')), true;
  if (path === '/podcast/pdf') {
    const store = await P.load(); const g = store.guests.find((x) => x.id === query.get('id'));
    const url = g && (await P.signedPdfUrl(g));
    return url ? redirect(res, url, 302) : send(res, 404, page('Not found', '<h1>No signed PDF yet</h1>')), true;
  }
  if (req.method !== 'POST') return false;
  const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
  const store = await P.load();
  if (path === '/podcast/add') {
    const email = String(f.email || '').trim().toLowerCase(), name = String(f.name || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) return redirect(res, '/podcast?msg=' + encodeURIComponent('Name and a valid email are required.')), true;
    if (store.guests.find((g) => g.email === email)) return redirect(res, '/podcast?msg=' + encodeURIComponent(`${email} is already on the list.`)), true;
    const g = P.newGuest({ name, email, note: String(f.note || '').trim(), kind: f.accepted ? 'accepted' : 'invite' });
    store.guests.push(g);
    await P.invite(g); await P.save(store);
    return redirect(res, '/podcast?msg=' + encodeURIComponent((g.kind === 'accepted' ? `Agreement sent to ${name}.` : `Invitation sent to ${name}.`))), true;
  }
  if (path === '/podcast/send-batch') {
    const pend = store.guests.filter((g) => g.pending_send);
    let n = 0; const errs = [];
    for (const g of pend) { try { await P.sendFirst(g); g.pending_send = false; n++; await P.save(store); } catch (e) { errs.push(`${g.name}: ${e.message}`); } }
    return redirect(res, '/podcast?msg=' + encodeURIComponent(`Sent ${n} of ${pend.length}.${errs.length ? ' Problems: ' + errs.join('; ') : ''}`)), true;
  }
  if (path === '/podcast/act') {
    const g = store.guests.find((x) => x.id === f.id);
    if (!g) return redirect(res, '/podcast?msg=' + encodeURIComponent('Guest not found.')), true;
    let msg = '';
    if (f.do === 'recorded' || f.do === 'edited') { g.pipeline = f.do; g.pipeline_manual = true; msg = `${g.name}: ${f.do}.`; }
    else if (f.do === 'pipeline') { g.pipeline = f.to; g.pipeline_manual = true; msg = `${g.name}: ${f.to}.`; }
    else if (f.do === 'resend_invite') { const kind = P.firstKind(g); const m = P.render(kind, g); await P.sendMail(g.email, m.subject, m.text); g.log.push(`${new Date().toISOString().slice(0, 16)} resent ${kind}`); msg = `Resent to ${g.name}.`; }
    else if (f.do === 'updated_agreement') { try { await P.sendUpdatedAgreement(g); msg = `Updated agreement sent to ${g.name}; the old link no longer works.`; } catch (e) { msg = `${g.name}: ${e.message}`; } }
    else if (f.do === 'resend_cancel') { const m = P.render('cancelled_unsigned', g); await P.sendMail(g.email, m.subject, m.text); g.log.push(`${new Date().toISOString().slice(0, 16)} resent cancellation`); msg = `Cancellation email resent to ${g.name}.`; }
    else if (f.do === 'resend_book') { const m = P.render('signed', g); await P.sendMail(g.email, m.subject, m.text); g.log.push(`${new Date().toISOString().slice(0, 16)} resent booking link`); msg = `Booking link resent to ${g.name}.`; }
    await P.save(store);
    return redirect(res, '/podcast?msg=' + encodeURIComponent(msg)), true;
  }
  return false;
}
module.exports = { publicRoute, adminRoute };
