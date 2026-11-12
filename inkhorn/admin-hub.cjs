// admin.inkhornreview.com: Terry's single admin hub (2026-11-11). Plain HTML, one password. Runs inside the agreements-accept web service
// (Host header admin.inkhornreview.com). Admin tools go under admin.inkhornreview.com/<path>; do not create new subdomains for them.
//
// Password: set once at /setup?token=<ADMIN_SETUP_TOKEN> (token in Keychain `inkhorn-admin-setup-token` and Railway). Only a scrypt hash is
// stored, in the private draft Ghost page `admin-hub-auth` (delete that page to allow a new setup). Signed in = a 30-day cookie (HMAC with
// ADMIN_SESSION_SECRET), HttpOnly, Secure, SameSite=Lax. Wrong passwords are rate limited per IP.
const crypto = require('crypto');
const L = require('./agreements-lib.cjs');
const P = require('./payouts-lib.cjs');

const SECRET = () => process.env.ADMIN_SESSION_SECRET || '';
const SETUP = () => process.env.ADMIN_SETUP_TOKEN || '';
const DAYS30 = 30 * 24 * 3600;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---- password hash (stored in a private Ghost page) -------------------------------------------------------------------------
let authCache = null;
const MEMORY_ONLY = process.env.ADMIN_AUTH_STORE === 'memory'; // local tests only: never touches the real Ghost page; never set on Railway
async function loadAuth() {
  if (authCache || MEMORY_ONLY) return authCache;
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
const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.5 Georgia,serif;color:#222;background:#fff}main{max-width:62rem;margin:0 auto;padding:1.5rem 1rem 4rem}h1{font-size:1.5rem}h2{font-size:1.15rem;margin:1.8rem 0 .3rem;border-bottom:1px solid #ccc}
ul{padding-left:1.2rem}li{margin:.35rem 0}.why{color:#555;font-size:.9rem}.status{background:#f4f1ea;border:1px solid #ccc;padding:.6rem 1rem}.warn{color:#a33}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.25rem .5rem;text-align:left;vertical-align:top}
input{font:inherit;padding:.4rem;margin:.2rem 0;width:18rem;max-width:100%}button{font:inherit;padding:.4rem 1rem}nav a{margin-right:1rem}</style></head><body><main>${body}</main></body></html>`;
const loginPage = (msg) => shell('Admin sign in', `<h1>Admin</h1>${msg ? `<p class="warn">${esc(msg)}</p>` : ''}<form method="post" action="/login"><p><input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" required></p><p><button>Sign in</button></p></form><p class="why">You stay signed in for 30 days on this browser.</p>`);
const setupPage = (token, msg) => shell('Set the admin password', `<h1>Set the admin password</h1>${msg ? `<p class="warn">${esc(msg)}</p>` : ''}<form method="post" action="/setup"><input type="hidden" name="token" value="${esc(token)}"><p><input type="password" name="password" placeholder="Password (12+ characters)" minlength="12" required autocomplete="new-password"></p><p><input type="password" name="again" placeholder="Again" minlength="12" required autocomplete="new-password"></p><p><button>Save and sign in</button></p></form><p class="why">Only a hash is stored. To set a new password later, delete the private Ghost page "Admin hub login" and visit /setup again with the setup token.</p>`);

const SUBDOMAINS = [
  ['admin.inkhornreview.com', 'This hub. Every admin tool goes under a path here (admin.inkhornreview.com/<path>), not a new subdomain.', 'Railway: agreements-accept service'],
  ['agreements.inkhornreview.com', 'The contributor confirm page (/accept) linked from the Duosuma acceptance letter. Public; the old payouts address redirects to admin.', 'Railway: agreements-accept service'],
  ['sign.inkhornreview.com', 'DocuSeal, where contributor agreements are sent and signed. (sign.lifeonwords.com redirects here.)', 'PikaPods: FTR DocuSeal'],
  ['download.inkhornreview.com', 'Ebook delivery: per-order download links, and the shop admin at /admin.', 'Railway: inkhorn-shop-service'],
  ['address.inkhornreview.com', 'The address service: members give a print-subscription mailing address (writes SHIP blocks to member notes).', 'Railway: address-service'],
  ['muse.inkhornreview.com', 'Old Muse address; redirects to gomuse.io.', 'Railway: muse project'],
  ['www.inkhornreview.com', 'Redirects to inkhornreview.com (a Cloudflare Worker).', 'Cloudflare'],
  ['mail.inkhornreview.com', 'Sending domain for Ghost newsletters (Mailgun); email.mail is its tracking CNAME.', 'Mailgun'],
  ['ses.inkhornreview.com', 'Amazon SES MAIL FROM domain (SPF and bounce handling for DocuSeal and shop mail). Not a website.', 'AWS SES'],
  ['inkhornreview.com', 'The magazine itself: Ghost, plus /ghost/ for Ghost Admin.', 'PikaPods: Ghost'],
];
const LINKS = [
  ['Inkhorn', [
    ['Ghost Admin', 'https://inkhornreview.com/ghost/', 'Write, schedule and edit posts and pages, members, newsletters, tiers, themes.'],
    ['The live site', 'https://inkhornreview.com/', 'What readers see.'],
    ['The Submissions page', 'https://inkhornreview.com/submissions/', 'Guidelines, free reading periods, pay (edited in Ghost Admin).'],
    ['The agreements tracker (Ghost page)', 'https://inkhornreview.com/ghost/#/pages/6af4f4a0a7098200015eb89e', 'The raw record of every contributor agreement; the payouts page reads it. Edit only if you must.'],
  ]],
  ['Agreements', [
    ['DocuSeal', 'https://sign.inkhornreview.com/', 'Templates, every sent and signed agreement, the API token.'],
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
    ['Stripe dashboard', 'https://dashboard.stripe.com/', 'Payments, subscriptions, refunds (Inkhorn Review account).'],
  ]],
  ['Muse', [['gomuse.io Admin', 'https://gomuse.io/admin', 'Issues, people, email (including the announcement emails), flagged pieces.']]],
  ['Hosting', [
    ['Railway: Inkhorn Cron', 'https://railway.com/project/7865f281-fb8b-46e7-90bd-ffb6babf849d', 'The cron jobs (weekly digest, agreements, patreon sync, ...) and the agreements-accept web service.'],
    ['Railway: agreements', 'https://railway.com/project/7865f281-fb8b-46e7-90bd-ffb6babf849d/service/b69a9017-8d4f-4b4f-8c35-5e0736b306c5', 'The daily agreements cron: logs, variables (SCHEDULE_SIGNED), run history.'],
    ['Railway: muse', 'https://railway.com/project/9a9c6ef8-f93a-439a-b0f1-e6595a1d2a0d', 'Muse API, web and Postgres; announcement-email switches live here.'],
    ['PikaPods', 'https://www.pikapods.com/pods', 'Ghost (inkhornreview.com), DocuSeal; backups, env vars, custom domains.'],
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
    const upcoming = issues.filter((i) => L.ymd(L.releaseDate(i)) >= today).sort((a, b) => L.ymd(L.releaseDate(a)).localeCompare(L.ymd(L.releaseDate(b))))[0];
    let pay = '<li>No issue is waiting to release.</li>';
    if (upcoming) {
      const rs = rows.filter((r) => r.issue === upcoming);
      const cash = rs.filter((r) => r.signed && r.choice === 'Cash').reduce((n, r) => n + r.amount, 0);
      const toCome = rs.filter((r) => !r.signed && r.status !== 'expired').reduce((n, r) => n + r.amount, 0);
      const subs = rs.filter((r) => r.signed && r.choice === 'Print subscription').length;
      pay = `<li><strong>${esc(L.issueName(upcoming))}, releases ${esc(L.pretty(L.ymd(L.releaseDate(upcoming))))}:</strong> cash to send $${cash} (signed), up to $${toCome} more if the rest sign; ${subs} Print subscription${subs === 1 ? '' : 's'} chosen.</li>`;
    }
    status = `<div class="status"><p><strong>Unsigned agreements</strong></p><ul>${parts.join('') || '<li>No agreements yet.</li>'}</ul>
      <p><strong>Bios waiting for you:</strong> ${waiting.length}${waiting.length ? ' (<a href="/payouts">Apply or Ignore</a>)' : ''}</p>
      <p><strong>Payments due at the next release</strong></p><ul>${pay}</ul></div>`;
  } catch (e) { console.error('hub status failed', e.message); }
  const links = LINKS.map(([group, items]) => `<h2>${esc(group)}</h2><ul>${items.map(([name, url, why]) => `<li><a href="${esc(url)}">${esc(name)}</a><br><span class="why">${esc(why)}</span></li>`).join('')}</ul>`).join('');
  const subs = `<h2>Subdomains</h2><p class="why">Every *.inkhornreview.com name in use. New admin tools go under admin.inkhornreview.com/&lt;path&gt;, not a new subdomain.</p><table><tr><th>Name</th><th>What it does</th><th>Runs on</th></tr>${SUBDOMAINS.map(([n, w, r]) => `<tr><td>${esc(n)}</td><td>${esc(w)}</td><td>${esc(r)}</td></tr>`).join('')}</table>`;
  return shell('Admin', `<h1>Admin</h1><nav><a href="/">Home</a><a href="/payouts">Payouts</a><a href="/logout">Sign out</a></nav>${status}${links}${subs}`);
}

// ---- routing ----------------------------------------------------------------------------------------------------------------
const readBody = (req) => new Promise((res, rej) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 20000) { req.destroy(); rej(new Error('too large')); } }); req.on('end', () => res(b)); });
const send = (res, code, html, extra = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(html); };
const redirect = (res, to) => { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
const nf = (res) => send(res, 404, shell('Not found', '<h1>Not found</h1>'));

async function handle(req, res, ip) {
  const [path, ...qs] = req.url.split('?');
  const query = new URLSearchParams(qs.join('?'));
  if (path === '/health') return send(res, 200, 'ok');
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
    if (!eq(scrypt(f.password || '', auth.salt), auth.hash)) return send(res, 401, loginPage('Wrong password.'));
    setCookie(res, cookieFor(), DAYS30);
    return redirect(res, '/');
  }
  if (path === '/logout') { setCookie(res, '', 0); return redirect(res, '/'); }

  if (!auth) return nf(res); // not set up yet: nothing to see (visit /setup?token=... once)
  if (!signedIn(req)) return send(res, 200, loginPage());

  if (path === '/') return send(res, 200, await homeHtml());
  if (path === '/payouts') return send(res, 200, (await P.payoutsHtml()).replace('<main>', '<main><p><a href="/">Admin home</a> · <a href="/logout">Sign out</a></p>'), { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
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
    const out = await P.payoutsBio(f);
    console.log('PAYOUTS BIO', f.do, out);
    return redirect(res, '/payouts');
  }
  return nf(res);
}
module.exports = { handle, SUBDOMAINS, LINKS };
