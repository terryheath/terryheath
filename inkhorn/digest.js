#!/usr/bin/env node
// inkhorn/digest.js — Inkhorn Review weekly piece (replaces the weekly digest, 2026-11-11)
//
// Every Sunday at 7am Pacific, emails ONE piece from a print issue to the "Weekly Digest" newsletter
// subscribers: the full piece, the issue it is from, and a link to it on the site.
//
// Which pieces: published posts tagged with a print-issue publication tag (inkhorn-1, inkhorn-2, ...) that
// are also genre-tagged (poetry, fiction, nonfiction, micro, art). Online-only pieces (no inkhorn-N tag) are
// never sent. The tag is cross-checked against inkhorn/data/editions-2026.json (the print running order).
// Pick: random from the eligible pieces not yet tagged #sent-weekly; the piece is tagged once it is sent.
// When none are left, nothing is sent and a notice goes to NOTICE_EMAIL.
//
// WEEKLY_MODE (env var):
//   (unset) / dry — prints the pick and the pool; changes nothing. THE DEFAULT, so nothing sends by accident.
//   test          — builds the email as a draft and sends a test to TEST_EMAIL only; nothing tagged, draft deleted.
//   send          — sends to the newsletter, tags the piece #sent-weekly.
// FORCE=1 skips the "is it Sunday 7am Pacific" check (test and manual runs).
//
// Railway cron is "0 14,15 * * 0" (UTC): 7am Pacific is 14:00Z in summer time and 15:00Z in winter time, so
// the run that is not 7am Pacific exits at once.
//
// Required env vars: GHOST_API_URL, GHOST_ADMIN_KEY. Optional: TEST_EMAIL, NOTICE_EMAIL (default terry@terryheath.com).
// The welcome-email step (welcome.js) still runs after, as before.

import GhostAdminAPI from '@tryghost/admin-api';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { esc } from './digest-html.js';
import { runWelcome } from './welcome.js';

const GHOST_API_URL   = process.env.GHOST_API_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
const MODE            = (process.env.WEEKLY_MODE || 'dry').trim().toLowerCase();
const FORCE           = process.env.FORCE === '1';
const DRY_RUN         = process.env.DRY_RUN === '1';
const TEST_EMAIL      = process.env.TEST_EMAIL || 'terry@terryheath.com';
const NOTICE_EMAIL    = process.env.NOTICE_EMAIL || 'terry@terryheath.com';
const SITE_URL        = 'https://inkhornreview.com';
const NEWSLETTER      = 'inkhorn-review-digest';
const SENT_TAG        = '#sent-weekly';
const SENT_SLUG       = 'hash-sent-weekly';
const EMAIL_TAG       = '#weekly-email';
const GENRES          = ['poetry', 'fiction', 'nonfiction', 'micro', 'art'];
const PUB_RE          = /^inkhorn-\d+$/;
const SEASON_RE       = /^(autumn|winter|spring|summer)-\d{4}$/;
const HERE            = dirname(fileURLToPath(import.meta.url));

if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}
if (!['dry', 'test', 'send'].includes(MODE)) {
  console.error(`WEEKLY_MODE must be dry, test or send (got "${MODE}")`);
  process.exit(1);
}

const api = new GhostAdminAPI({ url: GHOST_API_URL, key: GHOST_ADMIN_KEY, version: 'v5.0' });

function buildJWT() {
  const [kid, secret] = GHOST_ADMIN_KEY.split(':');
  const iat = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: iat + 300, iat, aud: '/admin/' })).toString('base64url');
  const sig = createHmac('sha256', Buffer.from(secret, 'hex')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ── Time: only 7am Sunday Pacific ─────────────────────────────────────────────

function pacificNow() {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  if (fmt.resolvedOptions().timeZone !== 'America/Los_Angeles') throw new Error('ICU timezone data missing: refusing to guess the hour');
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour) };
}

// ── Pool ──────────────────────────────────────────────────────────────────────

function printTag(post)  { return (post.tags || []).find(t => PUB_RE.test(t.slug)) || null; }
function seasonTag(post) { return (post.tags || []).find(t => SEASON_RE.test(t.slug)) || null; }
function isPiece(post)   { return (post.tags || []).some(t => GENRES.includes(t.slug)); }
function wasSent(post)   { return (post.tags || []).some(t => t.slug === SENT_SLUG); }

async function fetchPool() {
  const all = await api.posts.browse({
    filter: 'status:published',
    include: 'tags',
    limit: 'all',
    fields: 'id,title,slug,url,custom_excerpt,visibility,updated_at,published_at',
  });
  const eligible = all.filter(p => p.visibility === 'public' && printTag(p) && isPiece(p));

  // Belt and braces: a piece whose email already went out (its #weekly-email post's canonical URL) is never picked again,
  // even if tagging the piece failed.
  const emailed = new Set();
  try {
    const emails = await api.posts.browse({ filter: `tag:hash-weekly-email+status:[published,sent]`, limit: 'all', fields: 'id,canonical_url' });
    for (const e of emails) if (e.canonical_url) emailed.add(e.canonical_url);
  } catch (err) {
    console.warn('Could not read #weekly-email posts:', err.message);
  }

  // Cross-check against the print running order.
  try {
    const { pieces } = JSON.parse(readFileSync(join(HERE, 'data', 'editions-2026.json'), 'utf8'));
    const known = new Set(pieces.map(p => p.slug).filter(Boolean));
    const notInFile = eligible.filter(p => !known.has(p.slug));
    if (notInFile.length) console.warn(`NOTE: ${notInFile.length} eligible piece(s) are tagged inkhorn-N but not in data/editions-2026.json: ${notInFile.map(p => p.slug).join(', ')}`);
  } catch (err) {
    console.warn('Could not read data/editions-2026.json:', err.message);
  }

  const unsent = eligible.filter(p => !wasSent(p) && !emailed.has(p.url));
  return { eligible, unsent };
}

// ── Email ─────────────────────────────────────────────────────────────────────

function issueLabel(post) {
  const pub = printTag(post);
  const season = seasonTag(post);
  return [pub?.name, season?.name].filter(Boolean).join(' · ');
}

function emailHtml(post, body) {
  // Poems keep stanza breaks as empty paragraphs; mail clients collapse those, so give them height.
  const full = body.replace(/<p><\/p>/g, '<p>&nbsp;</p>').replace(/<p>\s*<\/p>/g, '<p>&nbsp;</p>');
  const byline = post.custom_excerpt ? `<p style="margin:0 0 24px;font-size:16px;font-style:italic;color:#555">${esc(post.custom_excerpt)}</p>` : '';
  return (
    `<!--kg-card-begin: html-->\n` +
    `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#888">From ${esc(issueLabel(post))}</p>\n` +
    `<h1 style="margin:0 0 8px;font-size:28px;line-height:1.25;color:#1a1a1a">${esc(post.title)}</h1>\n` +
    `${byline}\n` +
    `<div style="font-size:17px;line-height:1.6;color:#1a1a1a">${full}</div>\n` +
    `<hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0 20px">\n` +
    `<p style="margin:0 0 6px;font-size:15px"><a href="${esc(post.url)}" style="color:#1a1a1a;font-weight:700">Read it on Inkhorn Review &rarr;</a></p>\n` +
    `<p style="margin:0;font-size:13px;color:#888">${esc(issueLabel(post))}</p>\n` +
    `<!--kg-card-end: html-->`
  );
}

async function createEmailDraft(post, html) {
  return api.posts.add({
    title: post.title,
    email_subject: post.title,
    html,
    status: 'draft',
    tags: [{ name: EMAIL_TAG }],
    visibility: 'public',
    canonical_url: post.url,
    email_only: true,
  }, { source: 'html' });
}

async function sendTest(draftId, to) {
  const res = await fetch(`${GHOST_API_URL}/ghost/api/admin/email_previews/posts/${draftId}/`, {
    method: 'POST',
    headers: { Authorization: `Ghost ${buildJWT()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails: [to] }),
  });
  if (!res.ok) throw new Error(`test email failed ${res.status}: ${await res.text()}`);
}

async function notifyNoneLeft() {
  const html = `<p>The weekly Inkhorn piece did not send this Sunday: every eligible print piece has already been sent (tagged ${SENT_TAG}).</p>` +
               `<p>Publish the next print issue's pieces (tag inkhorn-N), or remove ${SENT_TAG} from pieces you want back in the pool.</p>`;
  console.log(`No eligible pieces left. Notifying ${NOTICE_EMAIL}.`);
  if (MODE !== 'send') return;
  const draft = await api.posts.add({ title: 'Weekly Inkhorn piece: none left', html, status: 'draft', tags: [{ name: EMAIL_TAG }] }, { source: 'html' });
  try { await sendTest(draft.id, NOTICE_EMAIL); } finally { await api.posts.delete({ id: draft.id }); }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const now = pacificNow();
  console.log(`Mode: ${MODE}. Pacific now: ${now.weekday} ${now.hour}:00.`);
  if (!FORCE && !(now.weekday === 'Sun' && now.hour === 7)) {
    console.log('Not Sunday 7am Pacific: nothing to do.');
    return;
  }

  // At most one send per Sunday, whatever the cron does: the cron fires at both 14:00 and 15:00 UTC, and only one of those is 7am
  // Pacific, but if a weekly email already went out in the last 20 hours this run stops too.
  if (MODE === 'send') {
    const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
    const recent = await api.posts.browse({ filter: `tag:hash-weekly-email+status:[published,sent]+published_at:>'${since}'`, limit: 1, fields: 'id,title' });
    if (recent.length) { console.log(`A weekly email already went out in the last 20 hours ("${recent[0].title}"): not sending again.`); return; }
  }

  const { eligible, unsent } = await fetchPool();
  console.log(`Eligible print pieces: ${eligible.length}. Not yet sent: ${unsent.length}.`);
  if (!unsent.length) { await notifyNoneLeft(); return; }

  const pick = unsent[Math.floor(Math.random() * unsent.length)];
  console.log(`Pick: "${pick.title}" (${issueLabel(pick)}) ${pick.url}`);
  if (MODE === 'dry' || DRY_RUN) { console.log('dry mode: nothing sent, nothing tagged.'); return; }

  const full = await api.posts.read({ id: pick.id }, { formats: 'html' });
  const html = emailHtml(pick, full.html || '');
  const draft = await createEmailDraft(pick, html);
  console.log(`Email draft created: ${draft.id}`);

  if (MODE === 'test') {
    try {
      await sendTest(draft.id, TEST_EMAIL);
      console.log(`Test email sent to ${TEST_EMAIL}. Nothing tagged.`);
    } finally {
      await api.posts.delete({ id: draft.id });
      console.log('Test draft deleted.');
    }
    return;
  }

  // send
  await api.posts.edit(
    { id: draft.id, status: 'published', email_only: true, updated_at: draft.updated_at },
    { newsletter: NEWSLETTER, email_segment: 'all' },
  );
  const [sent] = await api.posts.browse({ filter: `id:${draft.id}`, include: 'email,newsletter', limit: 1 });
  if (!sent?.email) throw new Error('email field is null after publish: no emails queued. Piece NOT tagged.');
  console.log(`Send confirmed (email ${sent.email.id}, status ${sent.email.status}, ${sent.email.email_count} recipients).`);

  // Tag the piece, keeping its other tags.
  const fresh = (await api.posts.browse({ filter: `id:${pick.id}`, include: 'tags', limit: 1, fields: 'id,updated_at' }))[0];
  await api.posts.edit({
    id: pick.id,
    updated_at: fresh.updated_at,
    tags: [...(fresh.tags || []).map(t => ({ id: t.id })), { name: SENT_TAG }],
  });
  console.log(`Tagged ${SENT_TAG}: "${pick.title}"`);
}

const failed = [];
try {
  await main();
} catch (err) {
  console.error('\nWEEKLY PIECE FAILED:', err);
  failed.push('weekly piece');
}
try {
  await runWelcome({ api, ghostApiUrl: GHOST_API_URL, siteUrl: SITE_URL, dryRun: DRY_RUN });
} catch (err) {
  console.error('\nWELCOME STEP FAILED:', err);
  failed.push('welcome');
}
if (failed.length) {
  console.error(`\nFailed: ${failed.join(', ')}`);
  process.exit(1);
}
