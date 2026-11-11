// Shared helpers for contributor agreements (DocuSeal + Ghost). Used by agreements.cjs (Railway cron) and
// scripts/send-agreement.cjs. Records live in a draft Ghost page (slug agreements-tracker) as JSON in codeinjection_head,
// so the cron can update them and nothing is public.
const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DOCUSEAL_URL = (process.env.DOCUSEAL_URL || 'https://sign.inkhornreview.com').replace(/\/$/, '');
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
// Release date of an issue slug like winter-2026: the 1st of Mar/Jun/Sep/Dec of that year, noon Pacific.
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
function findPiece(issue, title) {
  const pieces = JSON.parse(fs.readFileSync(editionsPath, 'utf8')).pieces;
  return pieces.find((p) => p.edition === issue && norm(p.title) === norm(title)) || null;
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

module.exports = { gfetch, notify, DOCUSEAL_URL, ghost, ds, loadTracker, saveTracker, releaseDate, ymd, addDays, todayPacific, pretty, issueName, findPiece, editionsPath };
