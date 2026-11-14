// Shared helpers for contributor agreements (DocuSeal + Ghost). Used by agreements.cjs (Railway cron) and
// scripts/send-agreement.cjs. Records live in a draft Ghost page (slug agreements-tracker) as JSON in codeinjection_head,
// so the cron can update them and nothing is public.
const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DOCUSEAL_URL = (process.env.DOCUSEAL_URL || 'https://sign.terryheath.com').replace(/\/$/, '');
const TRACKER_SLUG = 'agreements-tracker';
const kc = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();

function ghost() {
  const url = process.env.GHOST_API_URL || kc('ghost-url-inkhorn');
  const key = process.env.GHOST_ADMIN_KEY || kc('ghost-admin-inkhorn');
  return new GhostAdminAPI({ url, key, version: 'v5.0' });
}
const docusealToken = () => process.env.DOCUSEAL_TOKEN || kc('docuseal-inkhorn-token');

async function ds(method, p, body) {
  const res = await fetch(DOCUSEAL_URL + '/api' + p, {
    method,
    headers: { 'X-Auth-Token': docusealToken(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DocuSeal ${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// --- tracker -------------------------------------------------------------------------------------
async function loadTracker(api) {
  const r = await api.pages.browse({ filter: `slug:${TRACKER_SLUG}`, limit: 1, fields: 'id,slug,codeinjection_head,updated_at' });
  if (!r.length) return { page: null, records: [] };
  let records = [];
  try { records = JSON.parse(r[0].codeinjection_head || '[]'); } catch { records = []; }
  return { page: r[0], records };
}
async function saveTracker(api, tracker) {
  const json = JSON.stringify(tracker.records, null, 1);
  if (!tracker.page) {
    tracker.page = await api.pages.add({ title: 'Agreements tracker (private)', slug: TRACKER_SLUG, status: 'draft', codeinjection_head: json });
  } else {
    tracker.page = await api.pages.edit({ id: tracker.page.id, updated_at: tracker.page.updated_at, codeinjection_head: json });
  }
}

// --- dates ---------------------------------------------------------------------------------------
const SEASON_MONTH = { spring: 3, summer: 6, autumn: 9, winter: 12 };
// Release date of an issue slug like winter-2026: the 1st of Mar/Jun/Sep/Dec of that year (issues go live at 12:00 UTC, very early morning Pacific).
function releaseDate(issue) {
  const [season, year] = issue.split('-');
  return { y: +year, m: SEASON_MONTH[season], d: 1 };
}
const ymd = (o) => `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`;
function addDays(dateStr, n) { const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const todayPacific = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const pretty = (dateStr) => new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const issueName = (issue) => { const [s, y] = issue.split('-'); return `${s[0].toUpperCase()}${s.slice(1)} ${y}`; };

// --- editions data ---------------------------------------------------------------------------------
const editionsPath = path.join(__dirname, 'data', 'editions-2026.json');
const norm = (t) => t.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
// Some scheduled pieces have no slug in the editions file; gen-edition-partials resolves them from the 2026-10-09 backup by title.
const resolvedSlug = (p) => {
  if (p.slug) return p.slug;
  const backup = JSON.parse(fs.readFileSync(path.join(__dirname, 'backups', '2026-10-09', 'posts.json'), 'utf8'));
  return (backup.find((b) => b.status === 'scheduled' && b.title === p.match_scheduled_by_title) || {}).slug || null;
};
function findPiece(issue, title) {
  const pieces = JSON.parse(fs.readFileSync(editionsPath, 'utf8')).pieces;
  const p = pieces.find((x) => x.edition === issue && norm(x.title) === norm(title));
  return p ? { ...p, slug: resolvedSlug(p) } : null;
}

// Raw Admin API (the admin-api package has no tiers/members-with-tiers/email-preview helpers).
const crypto = require('crypto');
const jwt = (key) => {
  const [kid, secret] = key.split(':');
  const iat = Math.floor(Date.now() / 1000);
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b({ alg: 'HS256', kid, typ: 'JWT' })}.${b({ iat, exp: iat + 300, aud: '/admin/' })}`;
  return `${input}.${crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(input).digest('base64url')}`;
};
async function gfetch(method, p, body, key) {
  const url = process.env.GHOST_API_URL || kc('ghost-url-inkhorn');
  const k = key || process.env.GHOST_ADMIN_KEY || kc('ghost-admin-inkhorn');
  const res = await fetch(`${url}/ghost/api/admin${p}`, {
    method, headers: { Authorization: `Ghost ${jwt(k)}`, 'Content-Type': 'application/json', 'Accept-Version': 'v5.0' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ghost ${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
// Emails a note to hello@terryheath.com through Ghost's email preview (needs GHOST_STAFF_TOKEN; integration keys get a 403).
async function notify(api, subject, html, to = process.env.NOTICE_EMAIL || 'hello@terryheath.com') {
  const staff = process.env.GHOST_STAFF_TOKEN;
  if (!staff) throw new Error('GHOST_STAFF_TOKEN is required to send notices');
  const draft = await api.posts.add({ title: subject, status: 'draft', html }, { source: 'html' });
  try { await gfetch('POST', `/email_previews/posts/${draft.id}/`, { emails: [to] }, staff); }
  finally { await api.posts.delete({ id: draft.id }); }
}

// The email contributors get with their agreement (DocuSeal replaces {{submitter.link}} with the signing link).
function agreementEmail({ paid, amount, greeting, titles, issue, release, deadline, published }) {
  const piece = titles.length > 1 ? 'your pieces ' + titles.map((t) => `"${t}"`).join(' and ') : `"${titles[0]}"`;
  const subject = `Your Inkhorn Review contributor agreement: ${issue}`;
  const intro = published
    ? `Thank you for contributing to Inkhorn Review. ${piece[0] === 'y' ? 'Your pieces' : piece} appeared in our ${issue} issue, and we are putting the terms in writing.`
    : `Thank you for contributing to Inkhorn Review. ${piece[0] === 'y' ? 'Your pieces are' : piece + ' is'} slated for our ${issue} issue, which releases on ${release}.`;
  const what = `Please read and sign your contributor agreement. It covers the rights you grant Inkhorn Review (first serial rights, the online archive, anthologies drawn from our own archive, and a reading on our podcast, Life on Words), our promise not to use your work to train AI, and the details we need for print: your name as it should appear, a short bio, and a mailing address. It takes about five minutes.`;
  const dl = published
    ? `Please sign by ${deadline}.`
    : `Please sign by ${deadline}. Inkhorn Review cannot publish a piece without the signed agreement; if it is not signed by then, the piece will be withdrawn from the issue.`;
  const pay = !paid ? '' : published
    ? `\n\nIn the agreement you can choose how you would like to be paid your $${amount}: cash (Zelle or PayPal in the U.S., Wise elsewhere), or a one-year Print subscription to Inkhorn Review (four quarterly issues mailed, plus the ebook of each) instead of cash. If you do not choose by ${deadline}, we will pay the cash.`
    : `\n\nPayment is $${amount}, sent on ${release} by Zelle or PayPal (U.S.) or Wise (elsewhere). In the agreement you will choose between cash and a one-year Print subscription to Inkhorn Review (four quarterly issues mailed, plus the ebook of each) instead of cash.`;
  const body = `Hello ${greeting},\n\n${intro}\n\n${what}\n\n${dl}${pay}\n\nSign here: {{submitter.link}}\n\nIf you have questions, just reply to this email.\n\nInkhorn Review\nPublished by Follow the Rabbit LLC`;
  return { subject, body };
}

// --- running-order pull: edit editions-2026.json + partials, commit to GitHub, upload the theme --------------------------------
const REPO = 'terryheath/terryheath';
async function gh(method, p, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required to commit');
  const res = await fetch(`https://api.github.com/repos/${REPO}${p}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'inkhorn-agreements', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
// One commit on main containing { 'repo/relative/path': 'content' }.
async function githubCommit(files, message) {
  const ref = await gh('GET', '/git/ref/heads/main');
  const base = await gh('GET', `/git/commits/${ref.object.sha}`);
  const tree = await gh('POST', '/git/trees', { base_tree: base.tree.sha, tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })) });
  const commit = await gh('POST', '/git/commits', { message, tree: tree.sha, parents: [ref.object.sha], author: { name: 'terryheath', email: '312312378+terryheath@users.noreply.github.com' } });
  await gh('PATCH', '/git/refs/heads/main', { sha: commit.sha });
  return commit.sha;
}
// Zip of the theme dir exactly as `gulp zip` does (built assets are committed), with some files replaced.
function themeZip(replacements) {
  const AdmZip = require('adm-zip');
  const dir = path.join(__dirname, 'theme');
  const skip = /^(node_modules|dist)(\/|$)|^(pnpm-debug\.log|pnpm-lock\.yaml|pnpm-workspace\.yaml|AGENTS\.md|CLAUDE\.md)$/;
  const zip = new AdmZip();
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip.test(r)) continue;
      if (e.isDirectory()) walk(r); else if (!(r in replacements)) zip.addFile(r, fs.readFileSync(path.join(dir, r)));
    }
  })('');
  for (const [r, content] of Object.entries(replacements)) zip.addFile(r, Buffer.from(content));
  return zip.toBuffer();
}
// Same two calls deploy.sh makes (upload, then activate), through the Admin API.
async function uploadTheme(buf) {
  const url = process.env.GHOST_API_URL || kc('ghost-url-inkhorn');
  const k = process.env.GHOST_ADMIN_KEY || kc('ghost-admin-inkhorn');
  const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'application/zip' }), 'inkhorn.zip');
  let res = await fetch(`${url}/ghost/api/admin/themes/upload/`, { method: 'POST', headers: { Authorization: `Ghost ${jwt(k)}` }, body: fd });
  if (!res.ok) throw new Error(`theme upload -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  res = await fetch(`${url}/ghost/api/admin/themes/inkhorn/activate/`, { method: 'PUT', headers: { Authorization: `Ghost ${jwt(k)}` } });
  if (!res.ok) throw new Error(`theme activate -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
// Removes pulled pieces from the running order. Returns the list of removed titles.
async function applyPulls(pulled, { commit = true, upload = true } = {}) {
  const data = JSON.parse(fs.readFileSync(editionsPath, 'utf8'));
  const drop = new Set(pulled.map((r) => `${r.issue}:${r.slug}`));
  const gone = (p) => drop.has(`${p.edition}:${resolvedSlug(p)}`);
  const removed = data.pieces.filter(gone).map((p) => p.title);
  data.pieces = data.pieces.filter((p) => !gone(p));
  const counters = {};
  for (const p of data.pieces) p.position = (counters[p.edition] = (counters[p.edition] || 0) + 1);
  const partials = require('./scripts/gen-edition-partials.cjs').generate(data.pieces);
  const files = { 'inkhorn/data/editions-2026.json': JSON.stringify(data, null, 2) + '\n' };
  const themeFiles = {};
  for (const [ed, text] of Object.entries(partials)) { files[`inkhorn/theme/partials/editions/${ed}.hbs`] = text; themeFiles[`partials/editions/${ed}.hbs`] = text; }
  let sha = null;
  if (removed.length) {
    if (commit) sha = await githubCommit(files, `Running order: pull ${removed.map((t) => `"${t}"`).join(', ')} (agreement not signed by the deadline)\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`);
    if (upload) await uploadTheme(themeZip(themeFiles));
  }
  return { removed, sha, files };
}

// Pay for one work: $25 poem / micro / flash / prose up to 1,000 words; $40 prose over 1,000 words and printed art; online-only is unpaid.
function payFor(spec) {
  const [kind, extra] = spec.trim().toLowerCase().split(':');
  const online = extra === 'online' || /:online$/.test(spec.toLowerCase()) || spec.toLowerCase().includes('online');
  if (online) return 0;
  if (kind === 'art' || kind === 'artwork') return 40;
  if (kind === 'prose' || kind === 'fiction' || kind === 'nonfiction') return Number(extra) > 1000 ? 40 : 25;
  if (['poem', 'poetry', 'micro', 'flash'].includes(kind)) return 25;
  throw new Error(`unknown work "${spec}" (use poem, micro, flash, prose:WORDS, art, optionally with online)`);
}

// Sends one agreement and records it. opts: name, email, titles[], issue (winter-2026), amount, deadlineDays?, noPull?, greeting?,
// allowUnknown? (pieces not in editions-2026.json get slug null), dry?, preview?. Returns { template, deadline, mail, submission_id, ... }.
async function sendAgreement(o) {
  const { name, email, issue, titles, amount = 0 } = o;
  if (!name || !email || !issue || !titles || !titles.length) throw new Error('name, email, issue and titles are required');
  const paid = amount > 0;
  const rel = ymd(releaseDate(issue));
  const today = todayPacific();
  const deadline = o.deadlineDays ? addDays(today, Number(o.deadlineDays)) : addDays(rel, -30);
  const noPull = !!o.noPull;
  const pieces = titles.map((t) => {
    const p = findPiece(issue, t);
    if (p) return p;
    if (o.allowUnknown) return { title: t, slug: null };
    throw new Error(`"${t}" is not in editions-2026.json for ${issue}`);
  });
  const templateName = paid && noPull ? 'Inkhorn Review Contributor Agreement (Paid, Already Published)' : paid ? 'Inkhorn Review Contributor Agreement (Paid)' : 'Inkhorn Review Contributor Agreement';
  const values = {
    'Legal name': name, 'Piece titles': titles.join('; '), 'Issue': issueName(issue), 'Issue release date': pretty(rel), 'Signing deadline': pretty(deadline),
    ...(paid ? { Amount: '$' + amount } : {}),
  };
  const mail = agreementEmail({ paid, amount, greeting: o.greeting || name.split(' ')[0], titles, issue: issueName(issue), release: pretty(rel), deadline: pretty(deadline), published: noPull });
  const info = { name, email, template: templateName, values, deadline, noPull, mail };
  if (o.preview || o.dry) return info;
  const tpls = await ds('GET', '/templates?limit=100');
  const tpl = tpls.data.filter((t) => t.name === templateName).sort((a, b) => b.id - a.id)[0]; // newest version of the name
  if (!tpl) throw new Error('template not found in DocuSeal: ' + templateName);
  const api = ghost();
  const tracker = await loadTracker(api);
  const dup = tracker.records.find((r) => r.status !== 'expired' && ((o.duosumaTok && r.duosuma_tok === o.duosumaTok) || (r.issue === issue && pieces.some((p) => norm(p.title) === norm(r.title)))));
  if (dup) { const e = new Error(`already sent for "${dup.title}" (${dup.contributor}, submission ${dup.submission_id}); not sending again`); e.duplicate = dup; throw e; }
  const subs = await ds('POST', '/submissions', { template_id: tpl.id, send_email: true, message: { subject: mail.subject, body: mail.body }, submitters: [{ role: 'Contributor', email, name, values }] });
  const sub = subs[0];
  for (const p of pieces) {
    tracker.records.push({
      issue, slug: p.slug, title: p.title, contributor: name, email, template: paid && noPull ? 'published-paid' : paid ? 'paid' : 'unpaid', amount: paid ? amount : 0,
      submission_id: sub.submission_id, submitter_slug: sub.slug, sent: today, deadline, status: 'sent', choice: null, pay_method: null,
      on_deadline: noPull ? 'record-cash-default' : 'pull', reminded: false, pulled: false, comp_granted: false,
      ...(o.duosumaTok ? { duosuma_tok: o.duosumaTok } : {}),
    });
  }
  await saveTracker(api, tracker);
  return { ...info, submission_id: sub.submission_id, records: pieces.length };
}

// Re-sends DocuSeal's signature-request email to the contributor as a reminder (7 and 3 days before the deadline).
async function remindSubmission(r, days) {
  const sub = await ds('GET', `/submissions/${r.submission_id}`);
  const sm = sub.submitters && sub.submitters[0];
  if (!sm || sm.status === 'completed') return false;
  const published = r.on_deadline === 'record-cash-default';
  const first = (r.contributor || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || 'there';
  const when = days === 1 ? 'tomorrow' : `in ${days} days`;
  const body = `Hello ${first},\n\nA reminder: your Inkhorn Review contributor agreement for "${r.title}" is due ${pretty(r.deadline)}, ${when}. ` +
    (published ? `Your piece stays published either way; if you have not chosen between cash and the Print subscription by then, we will pay the cash.` : `Inkhorn Review cannot publish a piece without the signed agreement, and the piece will be withdrawn from the issue if it is not signed by then.`) +
    `\n\nSign here: {{submitter.link}}\n\nIf you have questions, just reply to this email.\n\nInkhorn Review\nPublished by Follow the Rabbit LLC`;
  await ds('PUT', `/submitters/${sm.id}`, { send_email: true, message: { subject: `Reminder: your Inkhorn Review contributor agreement is due ${pretty(r.deadline)}`, body } });
  return true;
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);

// An issue's pieces go live on release day starting 12:00 UTC (4am Pacific in winter, 5am in summer time), one minute apart in print order.
function releaseSlot(issue, position) {
  return new Date(Date.UTC(...(() => { const r = releaseDate(issue); return [r.y, r.m - 1, r.d, 12, 0, 0]; })()) + (position - 1) * 60000);
}

module.exports = { resolvedSlug, releaseSlot, remindSubmission, daysBetween, sendAgreement, payFor, applyPulls, githubCommit, themeZip, uploadTheme, agreementEmail, gfetch, notify, DOCUSEAL_URL, ghost, ds, loadTracker, saveTracker, releaseDate, ymd, addDays, todayPacific, pretty, issueName, findPiece, editionsPath };
