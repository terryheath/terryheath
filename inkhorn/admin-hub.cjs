// admin.terryheath.com: Terry's single admin hub (2026-11-11). Plain HTML, one password. Runs inside the agreements-accept web service
// (Host header admin.terryheath.com). Admin tools go under admin.terryheath.com/<path>; do not create new subdomains for them.
//
// Password: set once at /setup?token=<ADMIN_SETUP_TOKEN> (token in Keychain `inkhorn-admin-setup-token` and Railway). Only a scrypt hash is
// stored, in the private draft Ghost page `admin-hub-auth` (delete that page to allow a new setup). Signed in = a 30-day cookie (HMAC with
// ADMIN_SESSION_SECRET), HttpOnly, Secure, SameSite=Lax. Wrong passwords are rate limited per IP.
const crypto = require('crypto');
const L = require('./agreements-lib.cjs');
const P = require('./payouts-lib.cjs');
const PR = require('./podcast-routes.cjs');
const UI = require('./hub-ui.cjs');
const PL = require('./podcast-lib.cjs');

const SECRET = () => process.env.ADMIN_SESSION_SECRET || '';
const SETUP = () => process.env.ADMIN_SETUP_TOKEN || '';
const DAYS30 = 30 * 24 * 3600;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---- password hash (stored in a private Ghost page) -------------------------------------------------------------------------
const STORE = require('./store.cjs');
let authCache = null;
const MEMORY_ONLY = process.env.ADMIN_AUTH_STORE === 'memory'; // local tests only: never touches the real Ghost page; never set on Railway
async function loadAuth() {
  if (authCache || MEMORY_ONLY) return authCache;
  if (STORE.wp()) { const r = await STORE.load('admin-hub-auth'); authCache = r.value || null; return authCache; }
  const r = await L.ghost().pages.browse({ filter: 'slug:admin-hub-auth', limit: 1, fields: 'id,codeinjection_head,updated_at' });
  if (!r.length) return null;
  try { authCache = JSON.parse(r[0].codeinjection_head || 'null'); } catch { authCache = null; }
  return authCache;
}
const scrypt = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
async function saveAuth(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const data = { salt, hash: scrypt(pw, salt) };
  if (MEMORY_ONLY) { authCache = data; return; }
  if (STORE.wp()) { await STORE.save('admin-hub-auth', data); authCache = data; return; }
  const api = L.ghost();
  const r = await api.pages.browse({ filter: 'slug:admin-hub-auth', limit: 1, fields: 'id,updated_at' });
  if (r.length) await api.pages.edit({ id: r[0].id, updated_at: r[0].updated_at, codeinjection_head: JSON.stringify(data) });
  else await api.pages.add({ title: 'Admin hub login (private)', slug: 'admin-hub-auth', status: 'draft', codeinjection_head: JSON.stringify(data) });
  authCache = data;
}

// ---- sessions ---------------------------------------------------------------------------------------------------------------
const sign = (v) => crypto.createHmac('sha256', SECRET()).update(v).digest('base64url');
const cookieFor = () => { const exp = Math.floor(Date.now() / 1000) + DAYS30; return `${exp}.${sign(String(exp))}`; };
function signedIn(req) {
  const m = /(?:^|;\s*)ihadmin=([^;]+)/.exec(req.headers.cookie || '');
  if (!m || !SECRET()) return false;
  const [exp, sig] = m[1].split('.');
  return !!exp && !!sig && Number(exp) > Date.now() / 1000 && eq(sig, sign(exp));
}
const setCookie = (res, value, maxAge) => res.setHeader('Set-Cookie', `ihadmin=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`);

const tries = new Map();
const tooMany = (ip) => { const now = Date.now(); const a = (tries.get(ip) || []).filter((t) => now - t < 15 * 60e3); a.push(now); tries.set(ip, a); return a.length > 8; };

// ---- pages ------------------------------------------------------------------------------------------------------------------
const shell = (title, body, here = '') => UI.page(title, body, { here });
// Only same-site paths are allowed as a sign-in return target.
const safeNext = (n) => (typeof n === 'string' && /^\/[A-Za-z0-9_\-./?=&%]*$/.test(n) && !n.startsWith('//') && !/^\/(login|logout|setup|forgot|reset)/.test(n) ? n : '/');
const loginPage = (msg, next = '/', note = '') => shell('Admin sign in', `<h1>Admin</h1>${msg ? `<p class="warn" role="alert">${esc(msg)}</p>` : ''}${note ? `<p class="note">${esc(note)}</p>` : ''}<form method="post" action="/login"><input type="hidden" name="next" value="${esc(next)}"><p><label for="pw" class="why">Password</label><br><input id="pw" type="password" name="password" autofocus autocomplete="current-password" required></p><p><button>Sign in</button></p></form><p class="why">You stay signed in for 30 days on this browser.</p>
<details><summary>Forgot the password?</summary><p class="why">We can email a one-time link to hello@terryheath.com (valid for 30 minutes) that lets you set a new password.</p><form method="post" action="/forgot"><button class="ghost">Email me a reset link</button></form></details>`);
const setupPage = (token, msg, { reset = false } = {}) => shell(reset ? 'Choose a new admin password' : 'Set the admin password', `<h1>${reset ? 'Choose a new admin password' : 'Set the admin password'}</h1>${msg ? `<p class="warn" role="alert">${esc(msg)}</p>` : ''}<form method="post" action="${reset ? '/reset' : '/setup'}"><input type="hidden" name="token" value="${esc(token)}"><p><label class="why" for="p1">New password (12+ characters)</label><br><input id="p1" type="password" name="password" minlength="12" required autocomplete="new-password"></p><p><label class="why" for="p2">Again</label><br><input id="p2" type="password" name="again" minlength="12" required autocomplete="new-password"></p><p><button>Save and sign in</button></p></form><p class="why">Only a hash is stored. If you lose the password, use "Forgot the password?" on the sign-in page; it emails a link to hello@terryheath.com.</p>`);

const SUBDOMAINS = [
  ['admin.terryheath.com', 'This hub (moved from admin.inkhornreview.com on 2026-11-13, which redirects here). Every admin tool goes under a path here (admin.terryheath.com/<path>), not a new subdomain.', 'Railway: agreements-accept service'],
  ['agreements.inkhornreview.com', 'The contributor confirm page (/accept) linked from the Duosuma acceptance letter. Public; the old payouts address redirects to admin.', 'Railway: agreements-accept service'],
  ['sign.terryheath.com', 'DocuSeal, where contributor and guest agreements are sent and signed. (sign.inkhornreview.com and sign.lifeonwords.com 301-redirect here, paths kept, via the sign-lifeonwords-redirect Worker.)', 'PikaPods: FTR DocuSeal'],
  ['download.inkhornreview.com', 'Ebook delivery: per-order download links, and the shop admin at /admin.', 'Railway: inkhorn-shop-service'],
  ['address.inkhornreview.com', 'The address service: members give a print-subscription mailing address (writes SHIP blocks to member notes). It also answers at address.inkhorn.press (DNS and certificate added 2026-11-17); the shop address form still calls the inkhornreview.com name until it is switched.', 'Railway: address-service'],
  ['muse.inkhornreview.com', 'Old Muse address; redirects to gomuse.io.', 'Railway: muse project'],
  ['www.inkhornreview.com', 'Redirects to inkhorn.press (a Cloudflare Worker, inkhornreview-redirect).', 'Cloudflare'],
  ['admin.inkhornreview.com', 'Old admin address: GET and HEAD requests redirect here with the path kept; other methods (old webhook URLs) are still served.', 'Railway: agreements-accept service'],
  ['followtherabbit.terryheath.com', 'The Follow the Rabbit landing page.', 'Cloudflare Pages: followtherabbit'],
  ['send.terryheath.com', 'Amazon SES MAIL FROM domain for guest mail sent from hello@terryheath.com. Not a website.', 'AWS SES'],
  ['mail.inkhorn.press', 'Sending domain for the Inkhorn Ghost (Mailgun account terry@terryheath.com); email.mail is its tracking CNAME.', 'Mailgun'],
  ['mail.terryheath.com', 'Sending domain for the terryheath.com Ghost (same Mailgun account); email.mail is its tracking CNAME.', 'Mailgun'],
  ['ses.inkhornreview.com', 'Amazon SES MAIL FROM domain (SPF and bounce handling for DocuSeal and shop mail). Not a website.', 'AWS SES'],
  ['inkhorn.press (was inkhornreview.com)', 'The magazine itself: Ghost, plus /ghost/ for Ghost Admin.', 'PikaPods: Ghost'],
];
const LINKS = [
  ['Inkhorn', [
    ['Profile changes', '/profiles', 'Contributor headshot, bio and website changes waiting for your approval (nothing goes live until you approve).'],
    ['Ghost Admin', 'https://inkhorn.press/ghost/', 'Write, schedule and edit posts and pages, members, newsletters, tiers, themes.'],
    ['The live site', 'https://inkhorn.press/', 'What readers see.'],
    ['The Submissions page (guidelines and rights)', 'https://inkhorn.press/submissions/', 'Guidelines, free reading periods, pay (edited in Ghost Admin).'],
    ['The agreements tracker (Ghost page)', 'https://inkhorn.press/ghost/#/pages/6af4f4a0a7098200015eb89e', 'The raw record of every contributor agreement; the payouts page reads it. Edit only if you must.'],
  ]],
  ['Agreements', [
    ['DocuSeal', 'https://sign.terryheath.com/sign_in', 'Templates, every sent and signed agreement, the API token.'],
    ['Life on Words guests', '/podcast', 'Guest agreements, bookings and reminders for the podcast; add a guest and send the invitation.'],
    ['Payouts', '/payouts', 'Signed or not, pay and subscription choices, bios to Apply or Ignore, print mailing lists (CSV).'],
    ['Contributor confirm page', 'https://agreements.inkhornreview.com/accept', 'What the Duosuma acceptance letter links to; sends the agreement when a contributor confirms. Public.'],
  ]],
  ['Submissions', [
    ['Duosuma manage', 'https://duotrope.com/duosuma/manage/?ac=l14PM', 'Submissions, templates (the acceptance letter), calls and dates, team.'],
    ['Duotrope listing', 'https://duotrope.com/duosuma/submit/inkhorn-review-iGX4p', 'The public page where writers submit to Inkhorn Review.'],
    ['Chill Subs editor portal', 'https://editor.chillsubs.com/listings', 'Edit the Chill Subs listing and its stats.'],
  ]],
  ['Shop and money', [
    ['Ebook admin', 'https://download.inkhornreview.com/admin', 'Resend or revoke download links, download history, file check (password in Keychain inkhorn-shop-admin).'],
    ['Stripe: Inkhorn Press (nonprofit)', 'https://dashboard.stripe.com/', 'Shop checkout, donations, Duosuma fees and tips, inkhorn.press subscriptions. Switch to the Inkhorn Press account in the dashboard menu.'],
    ['Stripe: Follow the Rabbit LLC', 'https://dashboard.stripe.com/', 'terryheath.com tips and donations only. Switch to the Follow the Rabbit LLC account in the dashboard menu.'],
  ]],
  ['Muse', [['gomuse.io Admin', 'https://gomuse.io/admin', 'Issues, people, email (including the announcement emails), flagged pieces.']]],
  ['Hosting', [
    ['Railway: Shared Cron', 'https://railway.com/project/7865f281-fb8b-46e7-90bd-ffb6babf849d', 'The cron jobs (weekly digest, agreements, patreon sync, ...) and the agreements-accept web service.'],
    ['Railway: agreements', 'https://railway.com/project/7865f281-fb8b-46e7-90bd-ffb6babf849d/service/b69a9017-8d4f-4b4f-8c35-5e0736b306c5', 'The daily agreements cron: logs, variables (SCHEDULE_SIGNED), run history.'],
    ['Railway: muse', 'https://railway.com/project/9a9c6ef8-f93a-439a-b0f1-e6595a1d2a0d', 'Muse API, web and Postgres; announcement-email switches live here.'],
    ['PikaPods', 'https://www.pikapods.com/pods', 'Ghost (inkhorn.press), DocuSeal; backups, env vars, custom domains.'],
    ['Cloudflare', 'https://dash.cloudflare.com/', 'DNS for every domain, the redirect Workers.'],
    ['AWS SES console', 'https://us-east-2.console.aws.amazon.com/ses/home?region=us-east-2', 'Sending identities, DKIM, SMTP credentials for DocuSeal and shop mail.'],
  ]],
];

async function homeHtml() {
  let status = '<p class="warn">Status unavailable right now.</p>';
  try {
    const { rows, waiting } = await P.payoutsData();
    const today = L.todayPacific();
    const parts = [];
    const issues = [...new Set(rows.map((r) => r.issue))];
    for (const issue of issues) {
      const open = rows.filter((r) => r.issue === issue && !r.signed && r.status === 'sent').sort((a, b) => a.deadline.localeCompare(b.deadline));
      if (!open.length) { parts.push(`<li>${esc(L.issueName(issue))}: everything is signed.</li>`); continue; }
      const next = L.daysBetween(today, open[0].deadline);
      parts.push(`<li><strong>${esc(L.issueName(issue))}: ${open.length} unsigned</strong>, next deadline ${esc(open[0].deadline)} (${next} day${next === 1 ? '' : 's'} left; ${open.filter((r) => L.daysBetween(today, r.deadline) <= 3).length} within 3 days)<br><span class="why">${open.map((r) => `${esc(r.contributor)} (${L.daysBetween(today, r.deadline)}d)`).join(', ')}</span></li>`);
    }
    const refundOpen = rows.filter((r) => r.signed && r.refund_flag && !r.refund && !r.refund_dismissed && !r.refund_skipped).length;
    let guestsOpen = null; try { guestsOpen = (await PL.load()).guests.filter((g) => !g.pending_send && ['Needs Terry', 'No response'].includes(PL.statusOf(g))).length; } catch { guestsOpen = null; }
    const upcoming = issues.filter((i) => L.ymd(L.releaseDate(i)) >= today).sort((a, b) => L.ymd(L.releaseDate(a)).localeCompare(L.ymd(L.releaseDate(b))))[0];
    let pay = '<li>No issue is waiting to release.</li>';
    if (upcoming) {
      const rs = rows.filter((r) => r.issue === upcoming);
      const cash = rs.filter((r) => r.signed && r.choice === 'Cash').reduce((n, r) => n + r.amount, 0);
      const toCome = rs.filter((r) => !r.signed && r.status !== 'expired' && r.status !== 'withdrawn').reduce((n, r) => n + r.amount, 0);
      const subs = rs.filter((r) => r.signed && r.choice === 'Print subscription').length;
      pay = `<li><strong>${esc(L.issueName(upcoming))}, releases ${esc(L.pretty(L.ymd(L.releaseDate(upcoming))))}:</strong> cash to send $${cash} (signed), up to $${toCome} more if the rest sign; ${subs} Print subscription${subs === 1 ? '' : 's'} chosen.</li>`;
    }
    status = `<div class="status"><p><strong>Unsigned agreements</strong></p><ul>${parts.join('') || '<li>No agreements yet.</li>'}</ul>
      <p><strong>Needs a decision:</strong> ${waiting.length} bio${waiting.length === 1 ? '' : 's'} waiting${waiting.length ? ' (<a href="/payouts#bios">Apply or Ignore</a>)' : ''} · ${refundOpen} fee refund${refundOpen === 1 ? '' : 's'} to check${refundOpen ? ' (<a href="/payouts#refunds">see which</a>)' : ''}${guestsOpen !== null ? ` · ${guestsOpen} Life on Words guest${guestsOpen === 1 ? '' : 's'} needing you${guestsOpen ? ' (<a href="/podcast?show=needs">see who</a>)' : ''}` : ''}</p>
      <p><strong>Payments due at the next release</strong></p><ul>${pay}</ul></div>`;
  } catch (e) { console.error('hub status failed', e.message); }
  const links = LINKS.map(([group, items]) => `<h2>${esc(group)}</h2><ul>${items.map(([name, url, why]) => `<li><a href="${esc(url)}">${esc(name)}</a><br><span class="why">${esc(why)}</span></li>`).join('')}</ul>`).join('');
  const subs = `<h2>Subdomains</h2><p class="why">Every *.terryheath.com and *.inkhornreview.com name in use. New admin tools go under admin.terryheath.com/&lt;path&gt;, not a new subdomain.</p>${UI.table(`<tr><th>Name</th><th>What it does</th><th>Runs on</th></tr>${SUBDOMAINS.map(([n, w, r]) => `<tr><td data-label="Name">${esc(n)}</td><td data-label="What it does">${esc(w)}</td><td data-label="Runs on">${esc(r)}</td></tr>`).join('')}`)}`;
  return shell('Home', `<h1>Admin</h1>${status}${links}${subs}`, 'home');
}

// ---- routing ----------------------------------------------------------------------------------------------------------------
const readBody = (req) => new Promise((res, rej) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 20000) { req.destroy(); rej(new Error('too large')); } }); req.on('end', () => res(b)); });
const send = (res, code, html, extra = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(html); };
const redirect = (res, to) => { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
const nf = (res, signed = false) => send(res, 404, shell('Not found', '<h1>Not found</h1><p>There is nothing at this address. Use the menu above, or go to <a href="/">the admin home</a>.</p>', signed ? 'x' : ''));
// Paths that exist behind the sign-in; anything else is a plain 404 even when signed out (so a typo never looks like a session problem).
const KNOWN = (path) => path === '/' || path === '/payouts' || path === '/payouts.csv' || path === '/payouts/bio' || path === '/payouts/refund' || path === '/profiles' || path === '/profiles/decide' || path === '/podcast' || path.startsWith('/podcast/');
const sameSite = (req) => { const o = req.headers.origin; if (o) { try { return new URL(o).host === req.headers.host; } catch { return false; } } return req.headers['sec-fetch-site'] === 'same-origin'; };
const resets = new Map(); // one-time reset links already used (token -> true), memory only; links also expire after 30 minutes

async function handle(req, res, ip) {
  const [path, ...qs] = req.url.split('?');
  const query = new URLSearchParams(qs.join('?'));
  if (path === '/health') return send(res, 200, 'ok');
  if (path.startsWith('/podcast/book') || path.startsWith('/podcast/webhook/') || path === '/podcast/headshot' || path === '/podcast/api/headshot') { if (await PR.publicRoute(req, res, path, query)) return; } // public: the booking gate, the Cal.com webhook and the guest headshot upload
  const auth = await loadAuth();

  if (path === '/setup') {
    if (auth) return nf(res);
    if (req.method === 'GET') return SETUP() && eq(query.get('token') || '', SETUP()) ? send(res, 200, setupPage(query.get('token'))) : nf(res);
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    if (!SETUP() || !eq(f.token || '', SETUP())) return nf(res);
    if ((f.password || '').length < 12) return send(res, 400, setupPage(f.token, 'Use at least 12 characters.'));
    if (f.password !== f.again) return send(res, 400, setupPage(f.token, 'The two passwords differ.'));
    await saveAuth(f.password);
    setCookie(res, cookieFor(), DAYS30);
    return redirect(res, '/');
  }
  if (path === '/login') {
    if (!auth) return nf(res);
    if (req.method !== 'POST') return redirect(res, '/');
    if (tooMany(ip)) return send(res, 429, loginPage('Too many tries. Wait 15 minutes.'));
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    if (!eq(scrypt(f.password || '', auth.salt), auth.hash)) return send(res, 401, loginPage('Wrong password. Try again, or use "Forgot the password?" below.', safeNext(f.next)));
    setCookie(res, cookieFor(), DAYS30);
    return redirect(res, safeNext(f.next));
  }
  // Signing out needs a real click (POST from this site). A plain GET, a prefetch or a link checker does nothing.
  if (path === '/logout') {
    if (req.method !== 'POST') return redirect(res, '/');
    if (!sameSite(req)) return send(res, 403, shell('No', '<h1>No</h1><p>Sign out from the Sign out button in the admin menu.</p>'));
    setCookie(res, '', 0);
    return redirect(res, '/');
  }
  // Lost password: email a one-time link (30 minutes) to hello@terryheath.com. It always goes to that address, whoever asks.
  if (path === '/forgot' && req.method === 'POST' && auth) {
    if (!sameSite(req)) return send(res, 403, shell('No', '<h1>No</h1>'));
    if (tooMany(ip)) return send(res, 429, loginPage('Too many tries. Wait 15 minutes.'));
    const exp = Math.floor(Date.now() / 1000) + 30 * 60;
    const tok = `${exp}.${sign('reset' + exp)}`;
    try { await PL.sendMail('hello@terryheath.com', '[Admin hub] Reset link for the admin password', `Someone asked to reset the admin hub password (probably you).\n\nChoose a new password here within 30 minutes:\nhttps://admin.terryheath.com/reset?t=${tok}\n\nIf you did not ask for this, ignore this email; nothing changes until the link is used.\n\n— Admin hub`); } catch (e) { console.error('reset mail failed:', e.message); return send(res, 500, loginPage('The reset email could not be sent. Check the SMTP settings of the agreements-accept service.')); }
    return send(res, 200, loginPage('', '/', 'A reset link was sent to hello@terryheath.com. It works for 30 minutes.'));
  }
  if (path === '/reset' && auth) {
    const valid = (t) => { const [e, sig] = String(t || '').split('.'); return !!e && !!sig && Number(e) > Date.now() / 1000 && eq(sig, sign('reset' + e)) && !resets.has(t); };
    if (req.method === 'GET') return valid(query.get('t')) ? send(res, 200, setupPage(query.get('t'), '', { reset: true })) : send(res, 410, loginPage('That reset link has expired or was already used. Ask for a new one below.'));
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    if (!sameSite(req) || !valid(f.token)) return send(res, 410, loginPage('That reset link has expired or was already used. Ask for a new one below.'));
    if ((f.password || '').length < 12) return send(res, 400, setupPage(f.token, 'Use at least 12 characters.', { reset: true }));
    if (f.password !== f.again) return send(res, 400, setupPage(f.token, 'The two passwords differ.', { reset: true }));
    resets.set(f.token, true);
    await saveAuth(f.password);
    setCookie(res, cookieFor(), DAYS30);
    return redirect(res, '/');
  }

  if (!auth) return nf(res); // not set up yet: nothing to see (visit /setup?token=... once)
  if (!signedIn(req)) return KNOWN(path) && req.method === 'GET' ? send(res, 401, loginPage('', safeNext(req.url))) : KNOWN(path) ? send(res, 401, loginPage('Your session ended. Sign in and try again.')) : nf(res);

  if (path === '/podcast' || path.startsWith('/podcast/')) { if (await PR.adminRoute(req, res, path, query)) return; }
  if (path === '/') return send(res, 200, await homeHtml());
  if (path === '/payouts') return send(res, 200, await P.payoutsHtml({ msg: query.get('msg') || '' }));
  if (path === '/payouts.csv') {
    const issue = String(query.get('issue') || '');
    const { rows } = await P.payoutsData();
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="mailing-list-${issue.replace(/[^a-z0-9-]/g, '')}.csv"`, 'Cache-Control': 'no-store' });
    return res.end(P.mailingCsv(rows, issue));
  }
  if (path === '/payouts/bio' && req.method === 'POST') {
    const origin = req.headers.origin; // same-site only (the cookie is SameSite=Lax too)
    if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, shell('No', '<h1>No</h1>'));
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    if (f.do === 'preview') { try { return send(res, 200, await P.payoutsBioPreview(f)); } catch (e) { return redirect(res, '/payouts?msg=' + encodeURIComponent('Could not prepare the preview: ' + e.message)); } }
    let out; try { out = await P.payoutsBio(f); } catch (e) { out = 'FAILED: ' + e.message; }
    console.log('PAYOUTS BIO', f.do, out);
    return redirect(res, '/payouts?msg=' + encodeURIComponent(out));
  }
  if (path === '/payouts/refund' && req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, shell('No', '<h1>No</h1>'));
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    let out; try { out = await P.payoutsRefund(f); } catch (e) { out = 'FAILED: ' + e.message; }
    console.log('PAYOUTS REFUND', f.do, out);
    return redirect(res, '/payouts?msg=' + encodeURIComponent(out));
  }
  if (path === '/profiles') return send(res, 200, await profilesHtml(query.get('msg') || ''));
  if (path === '/profiles/decide' && req.method === 'POST') {
    if (!sameSite(req)) return send(res, 403, shell('No', '<h1>No</h1>'));
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    let out; try { await wpFetch('POST', '/pending/' + encodeURIComponent(f.id), { do: f.do === 'approve' ? 'approve' : 'reject' }); out = f.do === 'approve' ? 'Approved: the changes are live.' : 'Rejected: nothing changed.'; } catch (e) { out = 'FAILED: ' + e.message; }
    return redirect(res, '/profiles?msg=' + encodeURIComponent(out));
  }
  return nf(res, true);
}
// Contributor profile changes (headshot, bio, website) wait here for approval; nothing goes live on the WordPress hub until approved.
async function wpFetch(method, p, body) {
  const base = process.env.WP_URL, tok = process.env.INKHORN_IMPORT_TOKEN;
  if (!base || !tok) throw new Error('WP_URL and INKHORN_IMPORT_TOKEN are not set');
  const r = await fetch(base.replace(/\/$/, '') + '/wp-json/inkhorn/v1' + p, { method, headers: { 'Content-Type': 'application/json', 'X-Import-Token': tok }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`WordPress ${r.status}`); return r.json();
}
async function profilesHtml(msg) {
  let list = []; let err = '';
  try { list = await wpFetch('GET', '/pending'); } catch (e) { err = e.message; }
  const e2 = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const img = (u) => (u ? `<img src="${e2(u)}" alt="" width="72" height="72" style="border-radius:50%;object-fit:cover">` : '<span class="small">no photo</span>');
  const rows = list.map((c) => `<div class="bio"><p><strong>${e2(c.name)}</strong></p><div class="cols"><div><b>Live now</b><p>${img(c.now.headshot)}</p><p>${e2(c.now.bio) || '<em>no bio</em>'}</p><p>${e2(c.now.url)}</p></div>
    <div><b>Waiting</b><p>${img(c.pending.headshot || c.now.headshot)}</p><p>${e2(c.pending.bio)}</p><p>${e2(c.pending.url)}</p></div></div>
    <form method="post" action="/profiles/decide" class="act"><input type="hidden" name="id" value="${c.id}"><button name="do" value="approve">Approve</button> <button name="do" value="reject" class="ghost">Reject</button></form></div>`).join('');
  return shell('Profile changes', `<h1>Profile changes <small>${list.length}</small></h1>${msg ? `<p class="status">${e2(msg)}</p>` : ''}${err ? `<p class="bad">Could not reach WordPress: ${e2(err)}</p>` : ''}${rows || '<p class="ok">Nothing is waiting.</p>'}`, 'profiles');
}
module.exports = { handle, SUBDOMAINS, LINKS };
