#!/usr/bin/env node
// inkhorn/scheduler-check.js — watches both Ghost sites and emails hello@terryheath.com (never only a log line) when something is stuck:
//   1. a scheduled post whose time has passed and was not published (Ghost scheduler problem)
//   2. a newsletter email that has sat in "submitting" or "failed" for more than STUCK_MINUTES (15), on EITHER site, e.g. Mailgun
//      "recipient limit exceeded" (Ghost itself only shows "An unexpected error occurred"; the real error is in the email record's `error`)
// Runs every 10 minutes on Railway (cron */10 * * * *), so a stuck send is reported within about 25 minutes. Each problem is emailed ONCE: the ids
// already reported are kept in the private draft Ghost page `scheduler-alerts` on the Inkhorn Ghost (JSON in its code injection).
// Exits 1 when anything is stuck (Railway also logs it as a failure).
//
// Env:
//   GHOST_API_URL, GHOST_ADMIN_KEY            Inkhorn Ghost (kid:hex Admin API key)
//   TH_GHOST_API_URL, TH_GHOST_ADMIN_KEY      terryheath.com Ghost (optional; that site is skipped, with a log line, when absent)
//   SMTP_USERNAME, SMTP_PASSWORD              SES SMTP user, for the alert email (without them the alert is only logged and the run fails)
//   NOTICE_EMAIL                              default hello@terryheath.com
//   STUCK_MINUTES (default 15), DRY=1 (log what would be sent, send and record nothing)

import { createHmac } from 'crypto';
import { createRequire } from 'module';

const STUCK_MINUTES = Number(process.env.STUCK_MINUTES || 15);
const DRY = process.env.DRY === '1';
const NM = createRequire(import.meta.url)('./notice-mail.cjs');

const sites = [
  { name: 'Inkhorn (inkhorn.press)', url: process.env.GHOST_API_URL, key: process.env.GHOST_ADMIN_KEY, home: true },
  { name: 'Terry Heath (terryheath.com)', url: process.env.TH_GHOST_API_URL, key: process.env.TH_GHOST_ADMIN_KEY },
];

function token(adminKey) {
  const [kid, hex] = adminKey.split(':');
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  return `${h}.${p}.${createHmac('sha256', Buffer.from(hex, 'hex')).update(`${h}.${p}`).digest('base64url')}`;
}
async function api(site, method, path, body) {
  const r = await fetch(`${site.url.replace(/\/$/, '')}/ghost/api/admin/${path}`, {
    method, headers: { Authorization: `Ghost ${token(site.key)}`, 'Content-Type': 'application/json', 'Accept-Version': 'v5.0' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${site.name}: ${method} ${path} -> ${r.status}`);
  return r.status === 204 ? null : r.json();
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = (ms) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

// ---- what has already been reported (a private draft page on the Inkhorn Ghost) ------------------------------------------
async function loadState(home) {
  const r = await api(home, 'GET', 'pages/?filter=slug:scheduler-alerts&fields=id,codeinjection_head,updated_at&limit=1');
  const page = (r.pages || [])[0];
  let state = { alerted: {} };
  try { if (page && page.codeinjection_head) state = JSON.parse(page.codeinjection_head); } catch { /* start fresh */ }
  state.alerted ||= {};
  return { page, state };
}
async function saveState(home, page, state) {
  const cutoff = Date.now() - 30 * 86400000;
  for (const [k, v] of Object.entries(state.alerted)) if (Date.parse(v) < cutoff) delete state.alerted[k];
  const head = JSON.stringify(state);
  if (page) await api(home, 'PUT', `pages/${page.id}/`, { pages: [{ codeinjection_head: head, updated_at: page.updated_at }] });
  else await api(home, 'POST', 'pages/', { pages: [{ title: 'Scheduler alerts (private)', slug: 'scheduler-alerts', status: 'draft', codeinjection_head: head }] });
}

async function check(site) {
  const problems = [];
  const now = Date.now();
  // 1. overdue scheduled posts
  const sched = await api(site, 'GET', 'posts/?filter=status:scheduled&fields=id,title,published_at&limit=all');
  for (const p of sched.posts || []) {
    const late = now - new Date(p.published_at).getTime();
    if (late > 5 * 60_000) problems.push({ id: `${site.name}|post|${p.id}`, site: site.name, kind: 'Scheduled post not published', title: p.title, detail: `was due ${p.published_at} (${ago(late)} ago); Ghost's scheduler did not publish it` });
  }
  // 2. newsletter emails stuck in submitting or failed. The email record hangs off its post (integration keys cannot read /emails/ directly, but
  //    posts?include=email works), so look at every post published or sent in the last 14 days.
  const since14 = new Date(now - 14 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const posts = await api(site, 'GET', `posts/?include=email&filter=${encodeURIComponent(`status:[published,sent]+published_at:>'${since14}'`)}&fields=id,title,published_at&limit=all`);
  for (const p of posts.posts || []) {
    const e = p.email;
    if (!e || !['submitting', 'failed'].includes(e.status)) continue;
    const since = now - new Date(e.updated_at || e.created_at).getTime();
    if (since <= STUCK_MINUTES * 60_000) continue;
    let err = e.error || '';
    if (!err && e.error_data) err = typeof e.error_data === 'string' ? e.error_data : JSON.stringify(e.error_data);
    problems.push({ id: `${site.name}|email|${e.id}|${e.status}`, site: site.name, kind: `Newsletter email stuck in "${e.status}"`, title: p.title, detail: `${ago(since)} since it last changed. Error: ${err || '(Ghost recorded no error; open the pod logs in PikaPods)'}` });
  }
  return problems;
}

async function main() {
  const active = sites.filter((s) => s.url && s.key);
  for (const s of sites) if (!active.includes(s)) console.log(`${s.name}: skipped (no URL and key set)`);
  if (!sites[0].url || !sites[0].key) { console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required'); process.exit(1); }
  const all = [];
  const failures = [];
  for (const s of active) { try { all.push(...await check(s)); } catch (e) { failures.push(`${s.name}: could not check (${e.message})`); } }
  for (const f of failures) console.error('Check failed:', f);
  let st = null;
  try { st = await loadState(sites[0]); } catch (e) { console.error('could not read the alert record:', e.message); }
  const fresh = all.filter((p) => !(st && st.state.alerted[p.id])); // not yet emailed
  for (const p of all) console.error(`STUCK ${p.site}: ${p.kind}: "${p.title}" — ${p.detail}`);
  if (fresh.length) {
    const html = `<p>Something on the Ghost sites needs a look:</p><ul>${fresh.map((p) => `<li><strong>${esc(p.site)}</strong>: ${esc(p.kind)}<br>Post or email: <strong>${esc(p.title)}</strong><br>${esc(p.detail)}</li>`).join('')}</ul><p>This alert is sent once per problem. Ghost Admin: <a href="https://inkhorn.press/ghost/">inkhorn.press</a> · <a href="https://terryheath.com/ghost/">terryheath.com</a>. Pod logs: PikaPods > the pod > View Logs.</p>`;
    const subject = fresh.length === 1 ? `${fresh[0].kind}: ${fresh[0].title}` : `${fresh.length} stuck items on the Ghost sites`;
    if (DRY) console.log('DRY: would email', process.env.NOTICE_EMAIL || 'hello@terryheath.com', '|', subject);
    else if (NM.available()) {
      await NM.sendNotice({ subject, html, label: 'Ghost alert' });
      if (st) { for (const p of fresh) st.state.alerted[p.id] = new Date().toISOString(); try { await saveState(sites[0], st.page, st.state); } catch (e) { console.error('could not save the alert record (it may email again):', e.message); } }
    } else console.error('SMTP_USERNAME / SMTP_PASSWORD are not set, so no alert email could be sent.');
  }
  process.exit(all.length || failures.length ? 1 : 0);
}
main().catch((e) => { console.error('Check failed:', e.message); process.exit(1); });
