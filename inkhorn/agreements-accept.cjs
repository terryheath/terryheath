#!/usr/bin/env node
/**
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
// Reads the raw query "name=..&piece=..&call=..&note=..&track=.." even when values hold spaces, quotes or stray & characters.
function parseQuery(raw) {
  const q = raw.startsWith('?') ? raw.slice(1) : raw;
  const keys = ['name', 'piece', 'call', 'note', 'track'];
  const pos = [];
  let from = 0;
  for (const k of keys) {
    const m = new RegExp(`(^|&)${k}=`, 'i').exec(q.slice(from));
    if (m) { const at = from + m.index + m[1].length; pos.push({ k, at, vs: at + k.length + 1 }); from = at + k.length + 1; }
  }
  const out = {};
  pos.forEach((p, i) => { const end = i + 1 < pos.length ? pos[i + 1].at - 1 : q.length; out[p.k] = dec(q.slice(p.vs, Math.max(p.vs, end))); });
  return out;
}
const SEASONS = { winter: 'winter', spring: 'spring', summer: 'summer', autumn: 'autumn', fall: 'autumn' };
// "Winter 2027", "winter '27", "Fall 2026 $40" ... -> 'winter-2027' (null when not readable)
function parseIssue(text) {
  const m = /\b(winter|spring|summer|autumn|fall)\b\W{0,3}(?:of\s+)?(?:'|’)?(\d{4}|\d{2})\b/i.exec(text || '');
  if (!m) return null;
  let y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${SEASONS[m[1].toLowerCase()]}-${y}`;
}
function parsePay(note, call) {
  const n = String(note || ''), c = String(call || '');
  if (/\bonline\b/i.test(n)) return { amount: 0, why: 'online-only' };
  const d = /\$\s*(\d{1,3})\b/.exec(n);
  if (d) return { amount: Number(d[1]), why: `note says $${d[1]}` };
  if (/\bart(work)?\b/i.test(c) || /\bart(work)?\b/i.test(n)) return { amount: 40, why: 'printed artwork' };
  return { amount: 25, why: 'default' };
}
function plan(f, today = L.todayPacific()) {
  const issue = parseIssue(f.note) || parseIssue(f.call);
  if (!issue) return { issue: null };
  const pay = parsePay(f.note, f.call);
  const rel = L.ymd(L.releaseDate(issue));
  let deadline = L.addDays(rel, -30), short = false;
  if (deadline <= today) { deadline = L.addDays(today, 14); short = true; }
  const released = rel <= today;
  return { issue, pay, rel, deadline, short, released };
}

// ---- guards ----------------------------------------------------------------------------------------------------------------
const hits = new Map(); // ip -> [timestamps]
let sendsToday = { day: '', n: 0 };
const limited = (ip) => { const now = Date.now(); const a = (hits.get(ip) || []).filter((t) => now - t < 3600e3); a.push(now); hits.set(ip, a); return a.length > 12; };
const dailyCap = () => { const d = L.todayPacific(); if (sendsToday.day !== d) sendsToday = { day: d, n: 0 }; return ++sendsToday.n > 60; };
let busy = Promise.resolve(); // one send at a time (tracker is one JSON document)

// ---- pages -----------------------------------------------------------------------------------------------------------------
const page = (body, title = 'Inkhorn Review') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;background:#faf7f2;color:#222;font:18px/1.55 Georgia,'Times New Roman',serif}main{max-width:34rem;margin:0 auto;padding:3rem 1.25rem 4rem}
h1{font-size:1.6rem;font-weight:normal;letter-spacing:.02em;margin:0 0 .25rem}.brand{font-variant:small-caps;letter-spacing:.12em;color:#666;margin-bottom:2rem}
label{display:block;margin:1.2rem 0 .25rem;font-size:.95rem;color:#444}input[type=text],input[type=email]{width:100%;box-sizing:border-box;padding:.6rem .7rem;border:1px solid #bbb;background:#fff;font:inherit}
.fact{margin:.2rem 0}.fact b{font-weight:normal;color:#666}.hp{position:absolute;left:-9999px}button{margin-top:1.8rem;padding:.7rem 1.6rem;background:#222;color:#faf7f2;border:0;font:inherit;cursor:pointer}
.note{color:#666;font-size:.92rem;margin-top:1.2rem}</style></head><body><main><div class="brand">Inkhorn Review</div>${body}</main></body></html>`;

function formPage(f, p) {
  const known = f.name && f.piece && p.issue;
  const issueText = p.issue ? L.issueName(p.issue) : '';
  const facts = known
    ? `<p class="fact"><b>Name</b> ${esc(f.name)}</p><p class="fact"><b>Piece</b> ${esc(f.piece)}</p><p class="fact"><b>Issue</b> ${esc(issueText)}</p>
       <input type="hidden" name="name" value="${esc(f.name)}"><input type="hidden" name="piece" value="${esc(f.piece)}"><input type="hidden" name="call" value="${esc(f.call)}"><input type="hidden" name="note" value="${esc(f.note)}">`
    : `<p class="note">We could not read everything from your link, so please fill in the details below.</p>
       <label>Name<input type="text" name="name" value="${esc(f.name)}" required></label><label>Piece<input type="text" name="piece" value="${esc(f.piece)}" required></label>
       <label>Issue (for example Winter 2027)<input type="text" name="note" value="${esc(f.note)}" required></label><input type="hidden" name="call" value="${esc(f.call)}">`;
  return page(`<h1>Confirm your acceptance</h1><p>Thank you. Confirm below and we will email your contributor agreement for signing.</p>
    <form method="post" action="/accept">${facts}
    <label>Your email address<input type="email" name="email" required autocomplete="email"></label>
    <label>Your legal name, if it differs from the name above (optional)<input type="text" name="legal" autocomplete="name"></label>
    <div class="hp"><label>Leave empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
    <button type="submit">Confirm</button></form>`, 'Confirm your acceptance');
}
const donePage = (msg) => page(`<h1>${esc(msg.h)}</h1><p>${esc(msg.p)}</p>`, msg.h);

// ---- handlers --------------------------------------------------------------------------------------------------------------
async function tell(subject, html) { try { await L.notify(L.ghost(), subject, html, NOTICE); } catch (e) { console.error('notify failed:', e.message); } }
const cmd = (f, email, issue, amount) => `node inkhorn/scripts/send-agreement.cjs --name "${f.legal || f.name}" --email "${email}" --titles "${f.piece}" --issue ${issue || 'winter-2027'} --amount ${amount} --allow-unknown`;

async function confirm(f, email) {
  const p = plan(f);
  const who = `${f.legal || f.name} <${email}>`;
  if (!p.issue) {
    console.log('UNREADABLE ISSUE', JSON.stringify(f));
    await tell('Acceptance confirmed — issue not readable', `<p>${esc(who)} confirmed "${esc(f.piece)}", but I could not read an issue from the comment ("${esc(f.note)}"). Nothing was sent.</p><p>Once you know the issue, send it with:<br><code>${esc(cmd(f, email, null, parsePay(f.note, f.call).amount))}</code></p>`);
    return { h: 'Thank you', p: 'We have your confirmation. Your agreement will follow shortly.' };
  }
  try {
    const r = await L.sendAgreement({
      name: f.legal || f.name, email, issue: p.issue, titles: [f.piece], amount: p.pay.amount, noPull: p.released, greeting: (f.legal || f.name).split(' ')[0],
      deadlineDays: p.short ? 14 : undefined, allowUnknown: true,
    });
    const amt = p.pay.amount ? `$${p.pay.amount}` : 'unpaid (online-only)';
    console.log(`SENT ${f.piece} / ${p.issue} / ${amt} / ${email}`);
    await tell(`Agreement sent: ${f.piece}`, `<p>${esc(who)} confirmed "${esc(f.piece)}" for ${esc(L.issueName(p.issue))}; ${esc(amt)}; agreement sent, due ${r.deadline}.${p.short ? ' <strong>The 30-day deadline had already passed, so they have 14 days from today.</strong>' : ''}</p>`);
    return { h: 'Thank you', p: 'Your contributor agreement is on its way to your inbox. Please sign it by the date in the email.' };
  } catch (e) {
    if (e.duplicate) {
      console.log('DUPLICATE', f.piece, p.issue);
      await tell(`Duplicate confirmation: ${f.piece}`, `<p>${esc(who)} confirmed "${esc(f.piece)}" for ${esc(L.issueName(p.issue))} again. An agreement was already sent (${esc(e.duplicate.contributor)}, ${esc(e.duplicate.email)}); nothing new was sent.</p>`);
      return { h: 'Thank you', p: 'We already have your confirmation, and your agreement has been sent. Please check your inbox (and spam folder).' };
    }
    console.error('SEND FAILED', e.message);
    await tell(`Acceptance confirmed — send FAILED: ${f.piece}`, `<p>${esc(who)} confirmed "${esc(f.piece)}" (${esc(L.issueName(p.issue))}) but sending failed: ${esc(e.message)}</p><p>Send it by hand:<br><code>${esc(cmd(f, email, p.issue, p.pay.amount))}</code></p>`);
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
    if (path === '/health') return send(res, 200, 'ok');
    if (path !== '/accept' && path !== '/accept/') return send(res, 404, page('<h1>Not found</h1>'));
    if (req.method === 'GET') {
      console.log('GET /accept raw=', JSON.stringify(raw).slice(0, 600));
      const f = parseQuery(raw);
      return send(res, 200, formPage(f, plan(f)));
    }
    if (req.method === 'POST') {
      if (limited(ip)) return send(res, 429, donePage({ h: 'Please try again later', p: 'Too many requests.' }));
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      if (form.website) return send(res, 200, donePage({ h: 'Thank you', p: 'Done.' })); // honeypot
      const email = String(form.email || '').trim();
      const f = { name: String(form.name || '').trim(), piece: String(form.piece || '').trim(), call: String(form.call || '').trim(), note: String(form.note || '').trim(), legal: String(form.legal || '').trim() };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !f.name || !f.piece) return send(res, 400, donePage({ h: 'Something is missing', p: 'Please go back and fill in your email address.' }));
      if (dailyCap()) { await tell('Acceptance page: daily cap reached', `<p>More than 60 confirmations today; ignoring ${esc(email)} / ${esc(f.piece)}.</p>`); return send(res, 200, donePage({ h: 'Thank you', p: 'We have your confirmation.' })); }
      const out = await (busy = busy.then(() => confirm(f, email), () => confirm(f, email)));
      return send(res, 200, donePage(out));
    }
    send(res, 405, page('<h1>Not allowed</h1>'));
  } catch (e) { console.error('request error', e.message); send(res, 500, donePage({ h: 'Something went wrong', p: 'Please try again in a few minutes.' })); }
});

if (require.main === module) server.listen(PORT, () => console.log('agreements-accept listening on', PORT));
module.exports = { parseQuery, parseIssue, parsePay, plan };
