#!/usr/bin/env node
/**
 * (2026-11-11, second design) Duosuma does not URL-encode placeholders, so the link breaks at the first space in any value; only
 * {{TrackingLink}} arrives intact. Duotrope's tracking page is readable in a browser but sits behind a Cloudflare challenge, so this server
 * cannot read it. The link is therefore:
 *     https://agreements.inkhornreview.com/accept?track={{TrackingLink}}&note={{Comments}}
 * with `track` first. {{Comments}} survives only if typed without spaces, e.g. Spring2027, Spring2027-40, Spring2027-online; whatever
 * follows the first space is lost, which is harmless. The page asks the contributor for legal name, piece title and email, and offers a
 * dropdown of the next four issues (preselected from the comment when it was readable). Pay: from the comment when it holds 40 or
 * "online", else $25 and Terry's email says "pay not in link" so he can check the Duosuma page (the email links to it).
 *
 * inkhorn/agreements-accept.cjs — the page behind the link in the Duosuma acceptance letter. Railway service "agreements-accept",
 * https://agreements.inkhornreview.com/accept
 *
 * Link in the letter (Duosuma fills the placeholders; it may not URL-encode them, so the parser reads the raw query and splits on the
 * known keys, in this order, with the tracking link last because it carries its own ? and &):
 *   https://agreements.inkhornreview.com/accept?name={{FullName}}&piece={{AcceptedPiece}}&call={{CallName}}&note={{Comments}}&track={{TrackingLink}}
 *
 * GET /accept   shows the name, piece and issue prefilled (editable if the link could not be read) and asks for an email.
 * POST /accept  works out pay and deadline, sends the DocuSeal agreement (agreements-lib sendAgreement), records it in the tracker,
 *               and emails hello@terryheath.com one line. Duplicate piece+issue: one agreement. Unreadable issue: nothing is sent and
 *               Terry gets an email with the one-line command to send it by hand.
 * Pay: default $25; $40 only if the note says $40 or the call is art; "online" in the note means no pay (unpaid template).
 * Deadline: release date minus 30 days; if that has passed, 14 days from now (and Terry is told).
 * Env: PORT, GHOST_API_URL, GHOST_ADMIN_KEY, GHOST_STAFF_TOKEN, DOCUSEAL_TOKEN (DOCUSEAL_URL), optional NOTICE_EMAIL.
 */
const http = require('http');
const L = require('./agreements-lib.cjs');

const PORT = process.env.PORT || 3000;
const NOTICE = process.env.NOTICE_EMAIL || 'hello@terryheath.com';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- parsing ---------------------------------------------------------------------------------------------------------------
const dec = (v) => { try { return decodeURIComponent(String(v).replace(/\+/g, ' ')).trim(); } catch { return String(v).replace(/\+/g, ' ').trim(); } };
// The tracking link is https://duotrope.com/duosuma/submissions/?tok=XXXX ; only the token matters (and is the duplicate key).
function parseTrack(raw) {
  const m = /[?&]tok=([A-Za-z0-9_-]{8,64})/.exec(raw) || /(?:^|&)tok=([A-Za-z0-9_-]{8,64})/.exec(raw);
  return m ? m[1] : '';
}
// note= is whatever {{Comments}} produced up to its first space/ampersand (the link breaks there).
function parseNote(raw) {
  const m = /(?:^|[?&])note=([^&\s]*)/i.exec(raw);
  return m ? dec(m[1]) : '';
}
const SEASONS = { winter: 'winter', spring: 'spring', summer: 'summer', autumn: 'autumn', fall: 'autumn' };
// "Winter 2027", "Spring2027", "spring-27-40", "Fall 2026 $40" ... -> 'winter-2027' (null when not readable)
function parseIssue(text) {
  const m = /(winter|spring|summer|autumn|fall)[\W_]{0,3}(?:of\s+)?(?:'|’)?(\d{4}|\d{2})(?!\d)/i.exec(text || '');
  if (!m) return null;
  const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${SEASONS[m[1].toLowerCase()]}-${y}`;
}
// Amount from the comment: "online" = unpaid; a bare 40 (or $40) = $40; otherwise $25 (known=false: the link did not say).
function parsePay(note, call) {
  const n = String(note || ''), c = String(call || '');
  if (/online/i.test(n)) return { amount: 0, known: true, why: 'online-only' };
  const rest = n.replace(/(winter|spring|summer|autumn|fall)[\W_]{0,3}(?:'|’)?\d{2,4}/i, ' ');
  const d = /\$?\s*(\d{2,3})\b/.exec(rest);
  if (d && [25, 40].includes(Number(d[1]))) return { amount: Number(d[1]), known: true, why: `comment says ${d[1]}` };
  if (/\bart(work)?\b/i.test(c) || /\bart(work)?\b/i.test(rest)) return { amount: 40, known: true, why: 'printed artwork' };
  return { amount: 25, known: false, why: 'not in the link' };
}
// The next four issues by release date (Dec 1, Mar 1, Jun 1, Sep 1), counting from today. Slug year = release year.
function nextIssues(today = L.todayPacific(), n = 4) {
  const out = [];
  const [ty] = today.split('-').map(Number);
  const names = [['spring', 3], ['summer', 6], ['autumn', 9], ['winter', 12]];
  for (let y = ty; out.length < n && y <= ty + 2; y++) {
    for (const [season, m] of names) {
      const rel = `${y}-${String(m).padStart(2, '0')}-01`;
      if (rel >= today && out.length < n) out.push({ slug: `${season}-${y}`, label: `${L.issueName(`${season}-${y}`)} — releases ${L.pretty(rel)}` });
    }
  }
  return out;
}
function plan(f, today = L.todayPacific()) {
  const issue = f.issue || parseIssue(f.note) || parseIssue(f.call);
  if (!issue || !/^(winter|spring|summer|autumn)-\d{4}$/.test(issue)) return { issue: null };
  const pay = parsePay(f.note, f.call);
  const rel = L.ymd(L.releaseDate(issue));
  let deadline = L.addDays(rel, -30), short = false;
  if (deadline <= today) { deadline = L.addDays(today, 14); short = true; }
  return { issue, pay, rel, deadline, short, released: rel <= today };
}

// ---- guards ----------------------------------------------------------------------------------------------------------------
const hits = new Map(); // ip -> [timestamps]
let sendsToday = { day: '', n: 0 };
const limited = (ip) => { const now = Date.now(); const a = (hits.get(ip) || []).filter((t) => now - t < 3600e3); a.push(now); hits.set(ip, a); return a.length > 12; };
const dailyCap = () => { const d = L.todayPacific(); if (sendsToday.day !== d) sendsToday = { day: d, n: 0 }; return ++sendsToday.n > 60; };
let busy = Promise.resolve(); // one send at a time (the tracker is one JSON document)

// ---- pages -----------------------------------------------------------------------------------------------------------------
const page = (body, title = 'Inkhorn Review') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;background:#faf7f2;color:#222;font:18px/1.55 Georgia,'Times New Roman',serif}main{max-width:34rem;margin:0 auto;padding:3rem 1.25rem 4rem}
h1{font-size:1.6rem;font-weight:normal;letter-spacing:.02em;margin:0 0 .25rem}.brand{font-variant:small-caps;letter-spacing:.12em;color:#666;margin-bottom:2rem}
label{display:block;margin:1.2rem 0 .25rem;font-size:.95rem;color:#444}input[type=text],input[type=email],select{width:100%;box-sizing:border-box;padding:.6rem .7rem;border:1px solid #bbb;background:#fff;font:inherit}
.hp{position:absolute;left:-9999px}button{margin-top:1.8rem;padding:.7rem 1.6rem;background:#222;color:#faf7f2;border:0;font:inherit;cursor:pointer}
.note{color:#666;font-size:.92rem;margin-top:1.2rem}</style></head><body><main><div class="brand">Inkhorn Review</div>${body}</main></body></html>`;

function formPage(f) {
  const pre = f.issue || parseIssue(f.note) || '';
  const opts = nextIssues().map((i) => `<option value="${esc(i.slug)}"${i.slug === pre ? ' selected' : ''}>${esc(i.label)}</option>`).join('');
  return page(`<h1>Confirm your acceptance</h1><p>Thank you. Confirm below and we will email your contributor agreement for signing.</p>
    <form method="post" action="/accept">
    <label>Your name, as it should appear on the agreement<input type="text" name="legal" required autocomplete="name"></label>
    <label>Title of the piece we accepted<input type="text" name="piece" required></label>
    <label>The issue named in your acceptance letter<select name="issue" required>${pre ? '' : '<option value="">Choose…</option>'}${opts}</select></label>
    <label>Your email address<input type="email" name="email" required autocomplete="email"></label>
    <input type="hidden" name="track" value="${esc(f.track)}"><input type="hidden" name="note" value="${esc(f.note)}">
    <div class="hp"><label>Leave empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
    <button type="submit">Confirm</button></form>`, 'Confirm your acceptance');
}
const donePage = (msg) => page(`<h1>${esc(msg.h)}</h1><p>${esc(msg.p)}</p>`, msg.h);

// ---- handlers --------------------------------------------------------------------------------------------------------------
async function tell(subject, html) { try { await L.notify(L.ghost(), subject, html, NOTICE); } catch (e) { console.error('notify failed:', e.message); } }
const trackUrl = (tok) => (tok ? `https://duotrope.com/duosuma/submissions/?tok=${tok}` : '');
const trackLine = (tok) => (tok ? `<p>Duosuma page (check name, piece, call and pay): <a href="${esc(trackUrl(tok))}">${esc(trackUrl(tok))}</a></p>` : '<p>(No Duosuma tracking link arrived with this confirmation.)</p>');
const cmd = (f, issue, amount) => `node inkhorn/scripts/send-agreement.cjs --name "${f.legal}" --email "${f.email}" --titles "${f.piece}" --issue ${issue || 'spring-2027'} --amount ${amount} --allow-unknown`;

async function confirm(f) {
  const p = plan(f);
  const who = `${f.legal} <${f.email}>`;
  if (!p.issue) {
    console.log('UNREADABLE ISSUE', JSON.stringify({ ...f, track: f.track && '[token]' }));
    await tell('Acceptance confirmed — issue not chosen', `<p>${esc(who)} confirmed "${esc(f.piece)}" but no issue was chosen. Nothing was sent.</p>${trackLine(f.track)}<p>Once you know the issue:<br><code>${esc(cmd(f, null, p.pay ? p.pay.amount : parsePay(f.note).amount))}</code></p>`);
    return { h: 'Thank you', p: 'We have your confirmation. Your agreement will follow shortly.' };
  }
  try {
    const r = await L.sendAgreement({
      name: f.legal, email: f.email, issue: p.issue, titles: [f.piece], amount: p.pay.amount, noPull: p.released, greeting: f.legal.split(' ')[0],
      deadlineDays: p.short ? 14 : undefined, allowUnknown: true, duosumaTok: f.track || undefined,
    });
    const amt = p.pay.amount ? `$${p.pay.amount}` : 'unpaid (online-only)';
    console.log(`SENT ${f.piece} / ${p.issue} / ${amt} / pay ${p.pay.why}`);
    await tell(`Agreement sent: ${f.piece}`, `<p>${esc(who)} confirmed "${esc(f.piece)}" for ${esc(L.issueName(p.issue))}; ${esc(amt)}${p.pay.known ? '' : ' <strong>(pay not in the link: $25 assumed; if this should be $40 or unpaid, tell me or re-send)</strong>'}; agreement sent, due ${r.deadline}.${p.short ? ' <strong>The 30-day deadline had already passed, so they have 14 days from today.</strong>' : ''}</p>${trackLine(f.track)}`);
    return { h: 'Thank you', p: 'Your contributor agreement is on its way to your inbox. Please sign it by the date in the email.' };
  } catch (e) {
    if (e.duplicate) {
      console.log('DUPLICATE', f.piece, p.issue);
      await tell(`Duplicate confirmation: ${f.piece}`, `<p>${esc(who)} confirmed "${esc(f.piece)}" for ${esc(L.issueName(p.issue))} again. An agreement was already sent (${esc(e.duplicate.contributor)}, ${esc(e.duplicate.email)}); nothing new was sent.</p>${trackLine(f.track)}`);
      return { h: 'Thank you', p: 'We already have your confirmation, and your agreement has been sent. Please check your inbox (and spam folder).' };
    }
    console.error('SEND FAILED', e.message);
    await tell(`Acceptance confirmed — send FAILED: ${f.piece}`, `<p>${esc(who)} confirmed "${esc(f.piece)}" (${esc(L.issueName(p.issue))}) but sending failed: ${esc(e.message)}</p>${trackLine(f.track)}<p>Send it by hand:<br><code>${esc(cmd(f, p.issue, p.pay.amount))}</code></p>`);
    return { h: 'Thank you', p: 'We have your confirmation. Your agreement will follow shortly.' };
  }
}


// ---- payouts page: live signed/unsigned status, bios waiting for a decision, and the print mailing list (behind a secret key) ---------
const B = require('./bios-lib.cjs');
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

async function payoutsHtml(key) {
  const { rows, waiting } = await payoutsData();
  const today = L.todayPacific();
  const ek = esc(encodeURIComponent(key));
  const byIssue = {};
  for (const r of rows) (byIssue[r.issue] ||= []).push(r);
  const money = (n) => (n ? `$${n}` : '—');
  const queue = waiting.length ? `<h2>Bios waiting for you <small>${waiting.length}</small></h2>` + waiting.map(({ r, cur }) => `<div class="bio"><p><strong>${esc(r.title)}</strong> · ${esc(r.contributor)}</p>
    <div class="cols"><div><b>Now${cur ? ` (${esc(cur.author)})` : ''}</b><p>Ghost: ${esc(cur ? cur.ghost_bio || '(blank)' : '(piece not in editions-2026.json)')}</p><p>editions-2026.json: ${esc(cur ? cur.json_bio || '(blank)' : '')}</p></div>
    <div><b>Signed (name in print: ${esc(r.name_in_print || '—')})</b><p>${esc(r.bio_signed)}</p></div></div>
    <form method="post" action="/payouts/bio" class="act"><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="rid" value="${esc(r.submission_id + '|' + r.title)}">
    <button name="do" value="apply">Apply</button> <button name="do" value="ignore" class="ghost">Ignore</button> <span class="hint">Apply replaces the bio and name in print in Ghost and editions-2026.json; the nomination line is kept.</span></form></div>`).join('') : '';
  const blocks = Object.entries(byIssue).map(([issue, rs]) => {
    rs.sort((a, b) => Number(b.signed) - Number(a.signed) || a.deadline.localeCompare(b.deadline) || a.contributor.localeCompare(b.contributor));
    const cashSigned = rs.filter((r) => r.signed && r.choice === 'Cash').reduce((n, r) => n + r.amount, 0);
    const cashPending = rs.filter((r) => !r.signed && r.status !== 'expired').reduce((n, r) => n + r.amount, 0);
    const tr = rs.map((r) => {
      const left = L.daysBetween(today, r.deadline);
      const status = r.signed ? `Signed ${esc(r.signed_at)}` : r.status === 'expired' ? 'Expired' : left < 0 ? `Unsigned, ${-left} day(s) late` : `Unsigned, ${left} day(s) left`;
      const how = r.signed ? [r.choice, r.method, r.details].filter(Boolean).map(esc).join(' · ') : '';
      const bio = !r.signed ? '' : { filled: 'Bio filled in', pending: 'Bio waiting', applied: 'Bio applied', ignored: 'Bio ignored', none: 'No bio typed' }[r.bio_state] || '';
      return `<tr class="${r.signed ? 'ok' : 'open'}"><td>${esc(r.contributor)}${r.name_in_print && r.name_in_print !== r.contributor ? `<br><small>in print: ${esc(r.name_in_print)}</small>` : ''}</td><td>${esc(r.title)}</td><td>${money(r.amount)}</td><td>${status}</td><td>${esc(r.deadline)}</td><td>${how}</td><td>${esc(r.address)}</td><td>${esc(bio)}</td></tr>`;
    }).join('');
    const ml = mailingRows(rows, issue);
    const mailing = ml.length ? `<h3>Print mailing list, ${esc(L.issueName(issue))} <small>${ml.length} · <a href="/payouts.csv?key=${ek}&amp;issue=${esc(issue)}">Download CSV</a> · <a href="#" class="copy" data-t="mail-${esc(issue)}">Copy</a></small></h3>
      <pre id="mail-${esc(issue)}">${esc(ml.map((m) => `${m.name}\t${m.address}`).join('\n'))}</pre>` : '';
    return `<h2>${esc(L.issueName(issue))} <small>${rs.filter((r) => r.signed).length} of ${rs.length} signed · cash signed ${money(cashSigned)} · still to come ${money(cashPending)}</small></h2>
      <table><tr><th>Contributor</th><th>Piece</th><th>Pay</th><th>Status</th><th>Deadline</th><th>Choice · method · details</th><th>Mailing address</th><th>Bio</th></tr>${tr}</table>${mailing}`;
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

const readBody = (req) => new Promise((res, rej) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 20000) { req.destroy(); rej(new Error('too large')); } }); req.on('end', () => res(b)); });
const send = (res, code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(html); };

const server = http.createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const [path, ...qs] = req.url.split('?');
  const raw = qs.join('?');
  try {
    if (path === '/health') return send(res, 200, 'ok');
    if (path === '/payouts' || path === '/payouts.csv' || path === '/payouts/bio') {
      const key = process.env.PAYOUTS_KEY;
      let form = null;
      if (req.method === 'POST' && path === '/payouts/bio') form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      const given = form ? form.key : dec((/(?:^|&)key=([^&]*)/.exec(raw) || [])[1] || '');
      if (!key || given !== key) return send(res, 404, page('<h1>Not found</h1>'));
      if (path === '/payouts/bio') {
        if (!form) return send(res, 405, page('<h1>Not allowed</h1>'));
        const out = await payoutsBio(form);
        console.log('PAYOUTS BIO', form.do, out);
        res.writeHead(303, { Location: `/payouts?key=${encodeURIComponent(key)}` }); return res.end();
      }
      if (path === '/payouts.csv') {
        const issue = dec((/(?:^|&)issue=([^&]*)/.exec(raw) || [])[1] || '');
        const { rows } = await payoutsData();
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="mailing-list-${issue.replace(/[^a-z0-9-]/g, '')}.csv"`, 'Cache-Control': 'no-store' });
        return res.end(mailingCsv(rows, issue));
      }
      return send(res, 200, await payoutsHtml(key));
    }
    if (path !== '/accept' && path !== '/accept/') return send(res, 404, page('<h1>Not found</h1>'));
    if (req.method === 'GET') {
      console.log('GET /accept raw=', JSON.stringify(raw).slice(0, 600));
      return send(res, 200, formPage({ track: parseTrack(raw), note: parseNote(raw) }));
    }
    if (req.method === 'POST') {
      if (limited(ip)) return send(res, 429, donePage({ h: 'Please try again later', p: 'Too many requests.' }));
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      if (form.website) return send(res, 200, donePage({ h: 'Thank you', p: 'Done.' })); // honeypot
      const f = {
        legal: String(form.legal || '').trim(), piece: String(form.piece || '').trim(), email: String(form.email || '').trim(),
        issue: String(form.issue || '').trim(), note: String(form.note || '').trim().slice(0, 80), track: /^[A-Za-z0-9_-]{8,64}$/.test(form.track || '') ? form.track : '', call: '',
      };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) || !f.legal || !f.piece) return send(res, 400, donePage({ h: 'Something is missing', p: 'Please go back and fill in every field.' }));
      if (dailyCap()) { await tell('Acceptance page: daily cap reached', `<p>More than 60 confirmations today; ignoring ${esc(f.email)} / ${esc(f.piece)}.</p>`); return send(res, 200, donePage({ h: 'Thank you', p: 'We have your confirmation.' })); }
      const out = await (busy = busy.then(() => confirm(f), () => confirm(f)));
      return send(res, 200, donePage(out));
    }
    send(res, 405, page('<h1>Not allowed</h1>'));
  } catch (e) { console.error('request error', e.message); send(res, 500, donePage({ h: 'Something went wrong', p: 'Please try again in a few minutes.' })); }
});

if (require.main === module) server.listen(PORT, () => console.log('agreements-accept listening on', PORT));
module.exports = { parseTrack, parseNote, parseIssue, parsePay, plan, nextIssues };
