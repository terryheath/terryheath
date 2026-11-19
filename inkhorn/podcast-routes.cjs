// Life on Words guest system: web routes served on admin.terryheath.com (admin-hub.cjs calls these).
//   public (no password):  /podcast/book?token=...        the gate to the hidden Cal.com event (signed agreement required)
//                          /podcast/webhook/<secret>      Cal.com webhook (PODCAST_WEBHOOK_SECRET env var is the <secret>)
//                          /podcast/headshot?g=<token>    guest headshot: GET {has}, POST the raw image (jpg/png/webp, 10 MB); called from the guest guide at
//                                                         terryheath.com/podcast/guests/ (CORS for that origin only); files live on the hub's /data volume
//   server to server:      /podcast/api/headshot?name=<guest name>   Authorization: Bearer HUB_API_SECRET (env var, shared with the podcast-import service):
//                                                         the headshot bytes + X-Photo-Credit (URL-encoded), or 404/409 JSON; riverside-to-ghost.js uses it
//   behind the hub login:  /podcast/headshot-file?id=<guest id>[&download=1]   the saved headshot (thumbnail, download, Remove headshot, photo credit on the guest's row)
//   behind the hub login:  /podcast                       guests, agreements, bookings, reminders, buttons
//                          POST /podcast/add, /podcast/act, /podcast/send-batch;  GET /podcast/pdf?id=...
const P = require('./podcast-lib.cjs');
const fs = require('fs');
const path_ = require('path');
const L = require('./agreements-lib.cjs');
const crypto = require('crypto');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const UI = require('./hub-ui.cjs');
const page = (title, body, here = '') => UI.page(title, body, { here });
const send = (res, code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); };
const redirect = (res, to, code = 303) => { res.writeHead(code, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
const readBody = (req) => new Promise((res, rej) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 200000) { req.destroy(); rej(new Error('too large')); } }); req.on('end', () => res(b)); });


// ---- headshots (guest guide, 2026-11-15) --------------------------------------------------------------------------------------
let HEADSHOT_DIR = '/data/headshots'; // the hub volume (hub-files-volume): the ONLY place guest headshots live
const _setHeadshotDir = (d) => { HEADSHOT_DIR = d; }; // tests only
const HEADSHOT_MAX = 10 * 1024 * 1024;
const GUIDE_ORIGIN = 'https://terryheath.com';
const sniff = (b) => (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png' : b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'webp' : null);
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const cors = (req) => (req.headers.origin === GUIDE_ORIGIN ? { 'Access-Control-Allow-Origin': GUIDE_ORIGIN, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' } : { Vary: 'Origin' });
const json = (req, res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) }); res.end(JSON.stringify(o)); };
const readRaw = (req, max) => new Promise((ok, no) => { const chunks = []; let n = 0, over = false; req.on('data', (c) => { n += c.length; if (n > max) over = true; else if (!over) chunks.push(c); }); req.on('end', () => (over ? no(new Error('too large')) : ok(Buffer.concat(chunks)))); req.on('error', no); }); // reads (and discards) an oversize body so the browser gets the friendly 413, not a dropped connection
// Startup sweep: delete every file in the headshot folder that no guest record points at (leftovers from removed guests or failed saves). Never runs
// when the guest list can't be read or is empty, and skips files younger than 10 minutes (an upload writes the file just before it saves the record).
async function sweepHeadshots(log = (m) => console.log(m)) {
  if (!fs.existsSync(HEADSHOT_DIR)) { log('headshot sweep: no folder yet, nothing to do'); return 0; }
  let store; try { store = await P.load(); } catch (e) { log(`headshot sweep: skipped, could not read the guest list (${e.message})`); return 0; }
  if (!store.page || !store.guests.length) { log('headshot sweep: skipped, guest list is empty or missing'); return 0; }
  let ex; try { ex = await loadExtras(); } catch (e) { log(`headshot sweep: skipped, could not read the by-name headshot list (${e.message})`); return 0; }
  const keep = new Set([...store.guests, ...ex.list].filter((g) => g.headshot && g.headshot.file).map((g) => path_.basename(g.headshot.file)));
  let n = 0;
  for (const f of fs.readdirSync(HEADSHOT_DIR)) {
    const fp = path_.join(HEADSHOT_DIR, f);
    let st; try { st = fs.statSync(fp); } catch { continue; }
    if (!st.isFile() || keep.has(f) || Date.now() - st.mtimeMs < 10 * 60 * 1000) continue;
    try { fs.unlinkSync(fp); n++; log(`headshot sweep: deleted ${f} (${st.size} bytes, not referenced by any guest)`); } catch (e) { log(`headshot sweep: could not delete ${f}: ${e.message}`); }
  }
  log(`headshot sweep: done, ${n} deleted, ${keep.size} kept, ${store.guests.length} guests, ${ex.list.length} by-name`);
  return n;
}
// Match a guest name from an episode title to one guest record: same name once case, accents, punctuation and "(...)" are ignored; failing that, every word of one
// name appears in order in the other. More than one match is ambiguous (the importer then treats the headshot as missing).
const norm = (s) => String(s || '').replace(/\(.*?\)/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
const subseq = (a, b) => { let i = 0; for (const t of a) { while (i < b.length && b[i] !== t) i++; if (i >= b.length) return false; i++; } return true; };
function matchGuest(guests, name) {
  const n = norm(name); if (!n) return { list: [] };
  let list = guests.filter((g) => norm(g.name) === n);
  if (!list.length) { const nt = n.split(' '); list = guests.filter((g) => { const gt = norm(g.name).split(' ').filter(Boolean); return gt.length && (subseq(nt, gt) || subseq(gt, nt)); }); }
  return { list };
}
async function headshotApi(req, res, query) {
  const secret = process.env.HUB_API_SECRET || '';
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const out = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (!secret || !got || !eq(got, secret)) return out(401, { ok: false, error: 'unauthorized' });
  if (req.method !== 'GET') return out(405, { ok: false, error: 'GET only' });
  const store = await P.load(); const ex = await loadExtras();
  const { list } = matchGuest([...store.guests, ...ex.list], query.get('name'));
  if (!list.length) return out(404, { ok: false, error: 'no guest with that name' });
  if (list.length > 1) return out(409, { ok: false, error: `ambiguous: ${list.map((g) => g.name).join(', ')}` });
  const g = list[0], fp = headshotFile(g);
  if (!fp || !fs.existsSync(fp)) return out(404, { ok: false, error: 'guest has no headshot', guest: g.name });
  const ext = path_.extname(fp).slice(1);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Photo-Credit': encodeURIComponent(g.photo_credit || ''), 'X-Guest-Name': encodeURIComponent(g.name) });
  res.end(fs.readFileSync(fp));
}
// Headshots for people who have no guest record (recorded without one): a separate private Ghost page, so they can never be emailed, counted as guests or
// touched by the hourly job. Shape: [{id, name, photo_credit, headshot:{file,bytes,type,uploaded_at}, created_at}]. Matched by name like guests.
const STORE = require('./store.cjs');
const EXTRA_PAGE = 'podcast-headshots';
async function loadExtras(api = L.ghost()) {
  if (STORE.wp()) { const r = await STORE.load(EXTRA_PAGE); return { page: { version: r.version }, list: Array.isArray(r.value) ? r.value : [] }; }
  const r = await api.pages.browse({ filter: `slug:${EXTRA_PAGE}`, limit: 1, fields: 'id,codeinjection_head,updated_at' });
  if (!r.length) return { page: null, list: [] };
  let list = []; try { list = JSON.parse(r[0].codeinjection_head || '[]'); } catch { list = []; }
  return { page: r[0], list };
}
async function saveExtras(ex, api = L.ghost()) {
  if (STORE.wp()) { ex.page = { version: await STORE.save(EXTRA_PAGE, ex.list, ex.page && ex.page.version) }; return; }
  const json = JSON.stringify(ex.list, null, 1);
  if (!ex.page) ex.page = await api.pages.add({ title: 'Life on Words headshots without a guest record (private)', slug: EXTRA_PAGE, status: 'draft', codeinjection_head: json });
  else ex.page = await api.pages.edit({ id: ex.page.id, updated_at: ex.page.updated_at, codeinjection_head: json });
}
// ---- guest suggestions ("who else should I talk to?" on the guest guide) -----------------------------------------------------
// Stored in the private draft Ghost page `podcast-suggestions` (JSON), like the headshot extras: no email address is ever mailed
// from here, nothing is sent to the person suggested, and a suggestion is NEVER a guest record. Terry reads them on /podcast and
// adds a guest by hand if he wants one.
const SUGGEST_PAGE = 'podcast-suggestions';
async function loadSuggestions(api = L.ghost()) {
  if (STORE.wp()) { const r = await STORE.load(SUGGEST_PAGE); return { page: { version: r.version }, list: Array.isArray(r.value) ? r.value : [] }; }
  const r = await api.pages.browse({ filter: `slug:${SUGGEST_PAGE}`, limit: 1, fields: 'id,codeinjection_head,updated_at' });
  if (!r.length) return { page: null, list: [] };
  let list = []; try { list = JSON.parse(r[0].codeinjection_head || '[]'); } catch { list = []; }
  return { page: r[0], list };
}
async function saveSuggestions(sg, api = L.ghost()) {
  if (STORE.wp()) { sg.page = { version: await STORE.save(SUGGEST_PAGE, sg.list, sg.page && sg.page.version) }; return; }
  const json = JSON.stringify(sg.list, null, 1);
  if (!sg.page) sg.page = await api.pages.add({ title: 'Life on Words guest suggestions (private)', slug: SUGGEST_PAGE, status: 'draft', codeinjection_head: json });
  else sg.page = await api.pages.edit({ id: sg.page.id, updated_at: sg.page.updated_at, codeinjection_head: json });
}
const SUGGEST_HITS = new Map(); // ip -> [timestamps]; in memory only, so a restart forgives
const suggestOk = (ip) => {
  const now = Date.now(), cut = now - 3600e3;
  const hits = (SUGGEST_HITS.get(ip) || []).filter((t) => t > cut);
  if (hits.length >= 6) { SUGGEST_HITS.set(ip, hits); return false; }
  hits.push(now); SUGGEST_HITS.set(ip, hits);
  if (SUGGEST_HITS.size > 5000) for (const [k, v] of SUGGEST_HITS) if (!v.some((t) => t > cut)) SUGGEST_HITS.delete(k);
  return true;
};
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
async function suggestRoute(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
  if (req.method !== 'POST') return json(req, res, 405, { ok: false, error: 'POST only' });
  let f; try { f = JSON.parse((await readRaw(req, 20000)).toString('utf8')); } catch { return json(req, res, 400, { ok: false, error: 'Something went wrong sending that. Please try again.' }); }
  if (clip(f.website, 80)) return json(req, res, 200, { ok: true, message: 'Thank you.' }); // honeypot: look successful, store nothing
  const who = clip(f.who, 200);
  if (!who) return json(req, res, 400, { ok: false, error: 'Please put in a name.' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  if (!suggestOk(ip)) return json(req, res, 429, { ok: false, error: "That's a few suggestions in a row — please try again later." });
  const sg = await loadSuggestions();
  sg.list.push({ id: 's' + crypto.randomBytes(6).toString('hex'), who, why: clip(f.why, 1200), how: clip(f.how, 400), from_name: clip(f.from_name, 120), from_email: clip(f.from_email, 160), at: new Date().toISOString() });
  if (sg.list.length > 500) sg.list = sg.list.slice(-500);
  await saveSuggestions(sg);
  return json(req, res, 200, { ok: true, message: 'Thank you — that goes straight to Terry.' });
}

// Write an uploaded image for a record (guest or extra): new file first, then the record, then the old file is deleted. Returns {replaced}.
function putHeadshot(rec, buf, ext, who) {
  fs.mkdirSync(HEADSHOT_DIR, { recursive: true });
  const old = headshotFile(rec);
  const file = `${rec.id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path_.join(HEADSHOT_DIR, file), buf);
  if (old && old !== path_.join(HEADSHOT_DIR, file)) { try { fs.unlinkSync(old); } catch {} }
  rec.headshot = { file, bytes: buf.length, type: MIME[ext], uploaded_at: new Date().toISOString() };
  if (rec.log) rec.log.push(`${rec.headshot.uploaded_at.slice(0, 16)} headshot uploaded${who ? ' ' + who : ''} (${ext}, ${Math.round(buf.length / 1024)} KB)`);
  return { replaced: !!old };
}
const headshotFile = (g) => (g.headshot && g.headshot.file ? path_.join(HEADSHOT_DIR, path_.basename(g.headshot.file)) : null);
async function headshotRoute(req, res, query) {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
  const token = query.get('g') || '';
  const store = await P.load();
  const g = token.length > 10 ? store.guests.find((x) => eq(x.token, token)) : null;
  if (!g) return json(req, res, 404, { ok: false, error: 'This link is not recognized. Please use the link in your booking email.' });
  if (req.method === 'GET') return json(req, res, 200, { ok: true, has: !!g.headshot, name: P.firstName(g.name) });
  if (req.method !== 'POST') return json(req, res, 405, { ok: false, error: 'Method not allowed' });
  let replaced = false;
  let buf; try { buf = await readRaw(req, HEADSHOT_MAX); } catch { return json(req, res, 413, { ok: false, error: 'That file is larger than 10 MB. Please choose a smaller one.' }); }
  const ext = sniff(buf);
  if (!ext) return json(req, res, 415, { ok: false, error: 'Please upload a JPG, PNG or WebP image.' });
  try { replaced = putHeadshot(g, buf, ext, '').replaced; await P.save(store); }
  catch (e) { console.error('headshot save failed', e); return json(req, res, 500, { ok: false, error: 'Sorry, the upload did not save. Please try again, or reply to my email and attach it.' }); }
  return json(req, res, 200, { ok: true, replaced });
}
const uploadCtl = (g, label) => `<span class="lwup" data-id="${esc(g.id)}"><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Headshot photo (JPG, PNG or WebP, up to 10 MB)" style="max-width:15rem"><button type="button" onclick="lwUpload(this)">${label}</button></span>`;
const headshotHtml = (g) => g.headshot
  ? `<a href="/podcast/headshot-file?id=${esc(g.id)}&download=1" title="Download headshot"><img src="/podcast/headshot-file?id=${esc(g.id)}" alt="Headshot of ${esc(g.name)}" style="width:64px;height:64px;object-fit:cover;border:1px solid #ccc"></a><br><span class="small">headshot ${esc(String(g.headshot.uploaded_at).slice(0, 10))} · <a href="/podcast/headshot-file?id=${esc(g.id)}&download=1">download</a></span>
     <details><summary class="small">Change…</summary>${uploadCtl(g, 'Replace headshot')}<form method="post" action="/podcast/act" onsubmit="return confirm('Remove this headshot? The file is deleted and cannot be restored.')"><input type="hidden" name="id" value="${esc(g.id)}"><button name="do" value="remove_headshot">Remove headshot</button></form>${creditForm(g)}</details>`
  : `<details><summary class="bad small nohs">No headshot · add</summary>${uploadCtl(g, 'Upload headshot')}${creditForm(g)}</details>`;
const creditForm = (g) => `<form method="post" action="/podcast/act" style="margin-top:.3rem"><input type="hidden" name="id" value="${esc(g.id)}"><input name="credit" value="${esc(g.photo_credit || '')}" placeholder="Photo credit (optional)" size="26" title="Used as the photo caption on the episode page. HTML links are allowed."><button name="do" value="credit">Save credit</button></form>`;
const UPLOAD_JS = `<script>async function lwUpload(b){var w=b.closest('.lwup'),f=w.querySelector('input[type=file]').files[0],n=w.dataset.name;if(!f){alert('Choose a picture first.');return;}if(f.size>10485760){alert('That file is larger than 10 MB.');return;}b.disabled=true;b.textContent='Uploading...';try{var q=w.dataset.id?'id='+encodeURIComponent(w.dataset.id):'name='+encodeURIComponent(n||'');var r=await fetch('/podcast/headshot-upload?'+q,{method:'POST',body:f,credentials:'same-origin'});var j=await r.json();location.href='/podcast?msg='+encodeURIComponent(j.message||j.error||'Done');}catch(e){b.disabled=false;b.textContent='Try again';alert('The upload did not go through: '+e.message);}}
function lwByName(b){var w=b.closest('form'),n=w.querySelector('input[name=who]').value.trim();if(!n){alert('Type the guest name first.');return;}var s=w.querySelector('.lwup');s.dataset.name=n;s.dataset.id='';lwUpload(b);}</script>`;
// ---- who is missing a headshot --------------------------------------------------------------------------------------
// A guest "has recorded" when the session time has passed or the pipeline says recorded/edited. Published guests are left out (their episode is live).
const hasRecorded = (g, now = Date.now()) => ['recorded', 'edited'].includes(g.pipeline) || !!(g.booking && g.booking.status !== 'cancelled' && new Date(g.booking.start) < now);
function missingHeadshots(guests, now = Date.now()) {
  return guests.filter((g) => !g.pending_send && !g.headshot && !g.declined && !g.cancelled && g.pipeline !== 'published')
    .map((g) => ({ g, rec: hasRecorded(g, now), at: g.booking && g.booking.start ? new Date(g.booking.start).getTime() : null }))
    .sort((a, b) => (a.at == null) - (b.at == null) || (a.at || 0) - (b.at || 0) || a.g.name.localeCompare(b.g.name));
}

// ---- public ----------------------------------------------------------------------------------------------------------------
async function publicRoute(req, res, path, query) {
  if (path === '/podcast/headshot') return await headshotRoute(req, res, query), true;
  if (path === '/podcast/api/headshot') return await headshotApi(req, res, query), true;
  if (path === '/podcast/suggest') return await suggestRoute(req, res), true;
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
const sendBtn = (g, a2, label, q) => `<form method="post" action="/podcast/act" onsubmit="return confirm(${esc(JSON.stringify(q))})"><input type="hidden" name="id" value="${esc(g.id)}"><button name="do" value="${a2}">${label}</button></form>`;
function row(g) {
  const a = g.agreement, b = g.booking;
  const ag = a ? `${esc(a.status)}<br><span class="small">sent ${esc((a.sent_at || '').slice(0, 10))}${a.viewed_at ? `, viewed ${esc(a.viewed_at.slice(0, 10))}` : ''}${a.signed_at ? `, signed ${esc(a.signed_at.slice(0, 10))}` : ''}</span>` : '<span class="small">not sent yet</span>';
  const bk = b ? `${esc(fmt(b.start, P.PACIFIC))} <span class="small">(Pacific)</span><br>${b.tz && b.tz !== P.PACIFIC ? `${esc(fmt(b.start, b.tz))}<br>` : ''}<span class="${b.status === 'booked' ? 'ok' : 'bad'}">${esc(b.status)}</span>` : '<span class="small">no booking</span>';
  const sent = Object.keys(g.reminders || {}).filter((k) => !k.startsWith('skip_')).map((k) => k.split(':')[0]).join(', ');
  const st = P.statusOf(g);
  const fu = P.planFollowUp(g);
  const stCls = { Declined: 'bad', Cancelled: 'bad', 'Needs Terry': 'bad', 'No response': 'bad', Booked: 'ok', Signed: 'ok', Accepted: 'ok' }[st] || 'small';
  const nextTxt = fu.next ? `<br><span class="small">next: ${esc(fu.next.kind)} ${esc(fmt(fu.next.at.toISOString(), P.PACIFIC))}${fu.hold ? ' (held: an email went out in the last 48 hours)' : ''}</span>` : '';
  const accTxt = P.acceptedAt(g) ? `<br><span class="small">said yes ${esc(String(P.acceptedAt(g)).slice(0, 10))}</span>` : '';
  const pl = ['new', 'booked', 'recorded', 'edited', 'published'].map((s2) => `<option${g.pipeline === s2 ? ' selected' : ''}>${s2}</option>`).join('');
  const act = (a2, label) => `<form method="post" action="/podcast/act" style="display:inline"><input type="hidden" name="id" value="${esc(g.id)}"><button name="do" value="${a2}">${label}</button></form>`;
  const signed = a && a.status === 'signed';
  // Status buttons only change the record (never send anything). A declined guest gets Reopen and nothing else.
  const statusBtns = g.declined ? act('reopen', 'Reopen (no longer declined)')
    : `${!P.acceptedAt(g) && !signed ? act('accepted', 'Accepted') : ''}<form method="post" action="/podcast/act" style="display:inline" onsubmit="return confirm('Mark this guest as declined? No more emails of any kind will go to them.')"><input type="hidden" name="id" value="${esc(g.id)}"><button name="do" value="declined">Declined</button></form>${act('recorded', 'Recorded')}${act('edited', 'Edited')}
       <form method="post" action="/podcast/act" style="display:inline"><input type="hidden" name="id" value="${esc(g.id)}"><label class="small">Stage <select name="to">${pl}</select></label><button name="do" value="pipeline">Set</button></form>`;
  // Sending buttons are kept apart, each asks first, and none is offered for a declined guest.
  const nm = g.name;
  const sendBtns = g.declined ? '' : g.cancelled
    ? (g.cancel_reason === 'unsigned' ? sendBtn(g, 'resend_cancel', 'Resend cancellation email', `Email ${nm} the cancellation notice again?`) : '')
    : `<details class="sendmenu"><summary>Send an email to ${esc(firstWord(nm))}…</summary>${a && !signed ? sendBtn(g, 'updated_agreement', 'Send updated agreement', `Archive the current agreement link for ${nm} and email a new one?`) : ''}${sendBtn(g, 'resend_invite', 'Resend invite', `Email ${nm} the invitation again now?`)}${sendBtn(g, 'resend_book', 'Resend booking link', `Email ${nm} their booking link again now?`)}</details>`;
  const dl = (() => { const d = P.deadlineFor(g); return d && !signed ? `<br><span class="bad small">sign by ${esc(fmt(d.toISOString(), (b && b.tz) || P.PACIFIC))}</span>` : ''; })();
  const soon = b && b.status === 'booked' && !g.cancelled && new Date(b.start) - Date.now() < 7 * 86400000 && new Date(b.start) > Date.now() - 3600e3;
  return `<tr class="guest" data-st="${esc(st)}" data-soon="${soon ? 1 : 0}" data-hs="${g.headshot ? 1 : 0}"><td data-label="Guest"><strong>${esc(g.name)}</strong><br><span class="small">${esc(g.email)}</span><br><strong class="${stCls}">${esc(st)}</strong>${accTxt}${nextTxt}${g.cancelled ? `<br><span class="bad">${g.cancel_reason === 'unsigned' ? 'Cancelled — unsigned' : 'CANCELLED'}</span>` : ''}${g.kind !== 'invite' ? `<br><span class="small">${esc(g.kind === 'keep_date' ? 'date stands' : g.kind === 'accepted' ? 'already said yes' : 'to reschedule (was ' + g.old_when + ')')}</span>` : ''}</td>
    <td data-label="Agreement">${ag}${dl}${signed ? `<br><a href="/podcast/pdf?id=${esc(g.id)}">Signed PDF</a>` : ''}</td><td data-label="Booked time">${bk}</td><td data-label="Emails sent" class="small">${esc(sent)}</td><td data-label="Resched.">${g.reschedules || 0}</td>
    <td data-label="Status (changes the record only)">${statusBtns}</td><td data-label="Email">${sendBtns}</td><td data-label="Headshot">${headshotHtml(g)}</td></tr>`;
}
const firstWord = (n) => String(n).split(/\s+/)[0];
// What needs Terry first: flagged guests, then the soonest session, then the soonest next email.
const priority = (g) => { const st = P.statusOf(g); if (['Needs Terry', 'No response'].includes(st)) return [0, 0]; if (g.booking && g.booking.status === 'booked' && !g.cancelled && new Date(g.booking.start) > Date.now() - 3600e3) return [1, new Date(g.booking.start).getTime()]; const n = P.planFollowUp(g).next; if (n && !['Declined', 'Cancelled'].includes(st)) return [2, n.at.getTime()]; return [3, 0]; };
async function adminPage(msg, show = '') {
  const store = await P.load();
  for (const g of store.guests) await P.refreshAgreement(g);
  await P.save(store);
  const now = Date.now();
  const soon = store.guests.filter((g) => g.booking && g.booking.status === 'booked' && !g.cancelled && new Date(g.booking.start) - now < 2 * 86400000 && new Date(g.booking.start) > now - 3600e3 && !(g.agreement && g.agreement.status === 'signed'));
  const warn = soon.length ? `<div class="warn"><strong>Within 2 days and the agreement is NOT signed:</strong> ${soon.map((g) => `${esc(g.name)} (${esc(fmt(g.booking.start, P.PACIFIC))})`).join('; ')}</div>` : '';
  const pending = store.guests.filter((g) => g.pending_send);
  const batch = pending.length ? `<h2>Ready to send (${pending.length})</h2><p class="small">Nothing here has been sent. Read the emails, then send them all with one click.</p>${pending.map((g) => { const kind = P.firstKind(g); const m = P.render(kind, { ...g, agreement: { url: '(your agreement link)' } }); return `<details><summary><strong>${esc(g.name)}</strong> &lt;${esc(g.email)}&gt;: ${esc(m.subject)}</summary><div class="pre">${esc(m.text)}</div></details>`; }).join('')}<form method="post" action="/podcast/send-batch" onsubmit="return confirm('Send these ${pending.length} emails now?')"><button>Send these ${pending.length} emails</button></form>` : '';
  const rows = store.guests.filter((g) => !g.pending_send).sort((a, b) => { const x = priority(a), y = priority(b); return x[0] - y[0] || x[1] - y[1] || a.name.localeCompare(b.name); }).map(row).join('');
  const ex = await loadExtras();
  const miss = missingHeadshots(store.guests, now);
  const missLine = ({ g, rec, at }) => `<li>${rec ? '<strong class="bad">RECORDED</strong> ' : ''}${esc(g.name)} <span class="small">${at ? esc(fmt(new Date(at).toISOString(), P.PACIFIC)) : 'no session date yet'}${rec ? ' · its episode will be held as a draft until a headshot is here' : ''}</span></li>`;
  const missBox = `<h2>Missing headshots (${miss.length})</h2>${miss.length ? `<ul style="margin:.3rem 0;padding-left:1.2rem">${miss.filter((m) => m.at != null).map(missLine).join('')}</ul>${miss.some((m) => m.at == null) ? `<details><summary class="small">${miss.filter((m) => m.at == null).length} more with no session date yet</summary><ul style="padding-left:1.2rem">${miss.filter((m) => m.at == null).map(missLine).join('')}</ul></details>` : ''}<p class="small">Soonest session first. Guests already recorded are marked RECORDED. Nobody is emailed from this list.</p>` : '<p class="ok">Everyone has a headshot.</p>'}`;
  const exRows = ex.list.map((e) => `<tr><td><strong>${esc(e.name)}</strong> <span class="small">(no guest record)</span>${headshotHtml(e)}</td><td><form method="post" action="/podcast/act" onsubmit="return confirm('Delete this name and its headshot?')"><input type="hidden" name="id" value="${esc(e.id)}"><button name="do" value="delete_extra">Delete this entry</button></form></td></tr>`).join('');
  const byName = `<h2>Headshot for someone not in the list</h2><p class="small">For a guest who recorded without a guest record. Type the name as it appears in the episode title (before the colon). This creates a headshot-only entry: no email address, no emails, not counted as a guest. The importer finds it by name.</p><form onsubmit="return false"><input name="who" aria-label="Guest name as it appears in the episode title" placeholder="Guest name" size="26"> <span class="lwup" data-id="" data-name=""><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Headshot photo for this person (JPG, PNG or WebP, up to 10 MB)" style="max-width:15rem"></span> <button type="button" onclick="lwByName(this)">Upload headshot</button></form>${exRows ? `<table style="margin-top:.5rem"><tr><th>Headshot only (${ex.list.length})</th><th></th></tr>${exRows}</table>` : ''}`;
  const sg = await loadSuggestions();
  const open = sg.list.filter((s) => !s.dismissed).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const sgLine = (s) => `<tr><td><strong>${esc(s.who)}</strong><br><span class="small">suggested ${esc(String(s.at).slice(0, 10))}${s.from_name ? ` by ${esc(s.from_name)}` : ''}${s.from_email ? ` &lt;${esc(s.from_email)}&gt;` : ''}</span>${s.why ? `<br>${esc(s.why)}` : ''}${s.how ? `<br><span class="small"><strong>Way in:</strong> ${esc(s.how)}</span>` : ''}</td><td><form method="post" action="/podcast/act"><input type="hidden" name="id" value="${esc(s.id)}"><button name="do" value="dismiss_suggestion">Done with this</button></form></td></tr>`;
  const sgBox = `<h2>Suggested guests (${open.length})</h2><p class="small">From the "who else should I talk to?" form on the <a href="${GUIDE_ORIGIN}/podcast/guests/">guest guide</a>. Nobody here has been contacted and nothing is sent from this list — add a guest above when you want one. "Done with this" just hides the row.</p>${open.length ? UI.table(`<tr><th>Suggestion</th><th></th></tr>${open.map(sgLine).join('')}`) : '<p class="small">Nothing suggested yet.</p>'}`;
  return page('Life on Words guests', `${UPLOAD_JS}<h1>Life on Words guests</h1>${msg ? `<p class="note" role="status">${esc(msg)}</p>` : ''}${warn}${missBox}${sgBox}
    <h2>Add guest</h2><form method="post" action="/podcast/add"><input name="name" aria-label="Guest name" placeholder="Name" required size="22"> <input name="email" type="email" aria-label="Guest email address" placeholder="Email" required size="28"><br><textarea name="note" aria-label="Optional personal note" rows="2" cols="70" placeholder="Optional personal note, placed after the greeting and before the first line of the invitation (for example: Thanks for reaching out)"></textarea><br><label><input type="checkbox" name="accepted" value="1"> Add guest who already said yes (sends only the agreement, not the full invitation)</label><br><button>Add guest and send the email</button></form>
    ${batch}${byName}<h2>Guests (${store.guests.filter((g) => !g.pending_send).length})</h2>
    <div class="filters" role="group" aria-label="Filter guests"><button type="button" data-f="all" class="on">All</button><button type="button" data-f="needs">Needs you</button><button type="button" data-f="soon">Session in the next 7 days</button><button type="button" data-f="nohs">No headshot</button><button type="button" data-f="open">Not booked yet</button></div><p class="small" id="fcount"></p>
    ${UI.table(`<tr><th>Guest (needs you first, then soonest)</th><th>Agreement</th><th>Booked time</th><th>Emails sent</th><th>Resched.</th><th>Status (changes the record only)</th><th>Email</th><th>Headshot</th></tr>${rows || '<tr><td colspan="8">No guests yet.</td></tr>'}`, { id: 'guests' })}
    <script>(function(){var rows=[].slice.call(document.querySelectorAll('#guests tr.guest')),btns=[].slice.call(document.querySelectorAll('.filters button')),c=document.getElementById('fcount');
    var test={all:function(){return true},needs:function(r){return /Needs Terry|No response/.test(r.dataset.st)},soon:function(r){return r.dataset.soon==='1'},nohs:function(r){return r.dataset.hs==='0'},open:function(r){return /Invited|Accepted|Signed/.test(r.dataset.st)}};
    function go(f){var n=0;rows.forEach(function(r){var on=test[f](r);r.style.display=on?'':'none';if(on)n++});btns.forEach(function(b){b.classList.toggle('on',b.dataset.f===f);b.setAttribute('aria-pressed',b.dataset.f===f)});c.textContent=n?'Showing '+n+' of '+rows.length+' guests':'Nobody matches this filter right now (0 of '+rows.length+' guests). Choose All to see everyone.'}
    btns.forEach(function(b){b.addEventListener('click',function(){go(b.dataset.f)})});go(${JSON.stringify(show === 'needs' ? 'needs' : 'all')})})();</script>
    <p class="small">Status: Invited, Accepted (button, or "already said yes"), Signed, Booked, No response, Needs Terry (plus Declined, which stops every email). Follow-ups: no reply to the invitation gets the day-3 reminder and a last note on day 10; a guest who said yes but has not signed gets a reminder on day 3 and a last one on day 10; a guest who signed but has not booked gets a nudge on day 5 and a last one on day 14. Seven days after the last one the status changes and you get one email. Nothing goes to a guest within 48 hours of another email.</p><p class="small">"Published" is set automatically when an episode in the feed carries the guest's name; setting a status by hand here overrides it. Reminders: one week before and two days before at 9:00 a.m. their time; the morning of at 7:00 a.m. their time (6:00 p.m. the evening before if the session starts before 9:00 a.m.).</p>`, 'podcast');
}

async function adminRoute(req, res, path, query) {
  if (path === '/podcast' && req.method === 'GET') return send(res, 200, await adminPage(query.get('msg') || '', query.get('show') || '')), true;
  if (path === '/podcast/headshot-file') {
    const store = await P.load(); let g = store.guests.find((x) => x.id === query.get('id'));
    if (!g && /^x/.test(query.get('id') || '')) g = (await loadExtras()).list.find((x) => x.id === query.get('id'));
    const fp = g && headshotFile(g);
    if (!fp || !fs.existsSync(fp)) return send(res, 404, page('Not found', '<h1>No headshot yet</h1>')), true;
    const ext = path_.extname(fp).slice(1);
    const dl = query.get('download') ? { 'Content-Disposition': `attachment; filename="${String(g.name).replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/ +/g, '-') || 'guest'}-headshot.${ext}"` } : {};
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...dl });
    return res.end(fs.readFileSync(fp)), true;
  }
  if (path === '/podcast/headshot-upload' && req.method === 'POST') {
    const reply = (code, msg) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(code === 200 ? { ok: true, message: msg } : { ok: false, error: msg })); return true; };
    let buf; try { buf = await readRaw(req, HEADSHOT_MAX); } catch { return reply(413, 'That file is larger than 10 MB. Nothing was saved.'); }
    const ext = sniff(buf); if (!ext) return reply(415, 'That is not a JPG, PNG or WebP image. Nothing was saved.');
    const store = await P.load(); const id = query.get('id'), nm = String(query.get('name') || '').trim();
    try {
      let g = id && store.guests.find((x) => x.id === id);
      if (g) { const r = putHeadshot(g, buf, ext, '(uploaded by Terry)'); await P.save(store); return reply(200, `${g.name}: headshot ${r.replaced ? 'replaced' : 'uploaded'}.`); }
      const ex = await loadExtras(); let e = id && ex.list.find((x) => x.id === id);
      if (!e) {
        if (!nm || nm.length > 80) return reply(400, 'Type the guest name first. Nothing was saved.');
        const hit = matchGuest(store.guests, nm).list;
        if (hit.length === 1 && norm(hit[0].name) === norm(nm)) { g = hit[0]; const r = putHeadshot(g, buf, ext, '(uploaded by Terry)'); await P.save(store); return reply(200, `${nm} is already in the guest list: headshot ${r.replaced ? 'replaced' : 'uploaded'} on that row.`); }
        e = ex.list.find((x) => norm(x.name) === norm(nm));
        if (!e) { e = { id: 'x' + crypto.randomBytes(5).toString('hex'), name: nm, created_at: new Date().toISOString() }; ex.list.push(e); }
      }
      const r = putHeadshot(e, buf, ext, ''); await saveExtras(ex);
      return reply(200, `${e.name}: headshot ${r.replaced ? 'replaced' : 'uploaded'} (headshot-only entry, no guest record).`);
    } catch (e) { console.error('hub headshot upload failed', e); return reply(500, 'The upload did not save: ' + e.message); }
  }
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
    if (f.accepted) g.accepted_at = g.created_at; // "already said yes": accepted from the start
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
    if (f.do === 'dismiss_suggestion') { // a suggestion, not a guest: hide the row, email nobody
      const sg = await loadSuggestions(); const s = sg.list.find((x) => x.id === f.id);
      if (!s) return redirect(res, '/podcast?msg=' + encodeURIComponent('That suggestion is already gone.')), true;
      s.dismissed = new Date().toISOString(); await saveSuggestions(sg);
      return redirect(res, '/podcast?msg=' + encodeURIComponent(`Hidden: ${s.who}.`)), true;
    }
    let g = store.guests.find((x) => x.id === f.id);
    let exs = null;
    if (!g && /^x/.test(f.id || '')) { exs = await loadExtras(); g = exs.list.find((x) => x.id === f.id); }
    if (!g) return redirect(res, '/podcast?msg=' + encodeURIComponent('Guest not found.')), true;
    if (exs) { // a headshot-only entry: only these three actions apply
      let m2 = '';
      if (f.do === 'remove_headshot' || f.do === 'delete_extra') { const fp = headshotFile(g); if (fp) { try { fs.unlinkSync(fp); } catch (e) { if (e.code !== 'ENOENT') return redirect(res, '/podcast?msg=' + encodeURIComponent(`${g.name}: could not delete the file (${e.message}); nothing changed.`)), true; } } delete g.headshot; if (f.do === 'delete_extra') { exs.list = exs.list.filter((x) => x !== g); m2 = `${g.name}: entry and headshot deleted.`; } else m2 = `${g.name}: headshot removed.`; }
      else if (f.do === 'credit') { const c = String(f.credit || '').trim().slice(0, 500); if (c) g.photo_credit = c; else delete g.photo_credit; m2 = `${g.name}: photo credit ${c ? 'saved' : 'cleared'}.`; }
      await saveExtras(exs);
      return redirect(res, '/podcast?msg=' + encodeURIComponent(m2)), true;
    }
    let msg = '';
    if (f.do === 'recorded' || f.do === 'edited') { g.pipeline = f.do; g.pipeline_manual = true; msg = `${g.name}: ${f.do}.`; }
    else if (f.do === 'accepted') { if (!g.accepted_at) g.accepted_at = new Date().toISOString(); g.log.push(`${new Date().toISOString().slice(0, 16)} accepted (marked by Terry)`); msg = `${g.name}: accepted. Follow-up reminders now use the accepted track.`; }
    else if (f.do === 'declined') { g.declined = true; g.declined_at = new Date().toISOString(); g.log.push(`${g.declined_at.slice(0, 16)} declined (marked by Terry): no more emails`); msg = `${g.name}: declined. No more emails will go to them.`; }
    else if (f.do === 'remove_headshot') {
      const fp = headshotFile(g);
      if (fp) { try { fs.unlinkSync(fp); } catch (e) { if (e.code !== 'ENOENT') { msg = `${g.name}: could not delete the file (${e.message}); nothing changed.`; await P.save(store); return redirect(res, '/podcast?msg=' + encodeURIComponent(msg)), true; } } }
      delete g.headshot; g.log.push(`${new Date().toISOString().slice(0, 16)} headshot removed (marked by Terry)`); msg = `${g.name}: headshot removed.`; }
    else if (f.do === 'credit') { const c = String(f.credit || '').trim().slice(0, 500); if (c) g.photo_credit = c; else delete g.photo_credit; g.log.push(`${new Date().toISOString().slice(0, 16)} photo credit ${c ? 'set' : 'cleared'}`); msg = `${g.name}: photo credit ${c ? 'saved' : 'cleared'}.`; }
    else if (f.do === 'reopen') { delete g.declined; delete g.declined_at; g.log.push(`${new Date().toISOString().slice(0, 16)} reopened (no longer declined)`); msg = `${g.name}: reopened.`; }
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
module.exports = { publicRoute, adminRoute, sweepHeadshots, matchGuest, missingHeadshots, hasRecorded, loadExtras, _setHeadshotDir };
