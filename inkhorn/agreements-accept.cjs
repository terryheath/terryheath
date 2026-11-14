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
const hub = require('./admin-hub.cjs');

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


const readBody = (req) => new Promise((res, rej) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 20000) { req.destroy(); rej(new Error('too large')); } }); req.on('end', () => res(b)); });
const send = (res, code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(html); };

const server = http.createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const [path, ...qs] = req.url.split('?');
  const raw = qs.join('?');
  try {
    const host = (req.headers.host || '').toLowerCase();
    // admin.inkhornreview.com moved to admin.terryheath.com (2026-11-13): reads redirect with the path kept; writes (the Cal.com webhook, until its URL is updated) are still served.
    if (host.startsWith('admin.inkhornreview.com') && (req.method === 'GET' || req.method === 'HEAD')) { res.writeHead(301, { Location: 'https://admin.terryheath.com' + req.url }); return res.end(); }
    if (/^admin\./i.test(host)) return await hub.handle(req, res, ip); // admin.terryheath.com: the admin hub
    if (path === '/health') return send(res, 200, 'ok');
    if (path === '/payouts' || path === '/payouts.csv' || path === '/payouts/') { // retired: the payouts page lives at admin.terryheath.com/payouts
      res.writeHead(301, { Location: 'https://admin.terryheath.com/payouts' }); return res.end();
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
