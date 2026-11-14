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
// TEST_SLUGS=slug1,slug2 (any mode): sends a test email of each named eligible piece to TEST_EMAIL only, then stops. Nothing is
//   tagged or sent to readers and the Sunday check is skipped. Clear it afterwards. Add :also to a slug (slug:also) for the layout with the
//   "Also at Inkhorn" section; a plain slug sends the current layout.
//
// Railway cron is "0 14,15 * * 0" (UTC): 7am Pacific is 14:00Z in summer time and 15:00Z in winter time, so
// the run that is not 7am Pacific exits at once.
//
// Required env vars: GHOST_API_URL, GHOST_ADMIN_KEY. Optional: TEST_EMAIL, NOTICE_EMAIL (default terry@terryheath.com).
// (The free-member welcome emails no longer pull pieces: the welcome step was removed 2026-11-11, so nothing here tags #welcome-used.)
// ALSO=1 adds an "Also at Inkhorn" section after the piece (the latest Founder's Letter, Gallery and Muse, one row each,
//   flagged NEW when newer than the previous weekly email). OFF by default until Terry approves it; ALSO_SINCE_DAYS overrides the window.

import GhostAdminAPI from '@tryghost/admin-api';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { esc } from './digest-html.js';

const GHOST_API_URL   = process.env.GHOST_API_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
const MODE            = (process.env.WEEKLY_MODE || 'dry').trim().toLowerCase();
const FORCE           = process.env.FORCE === '1';
const TEST_SLUGS      = (process.env.TEST_SLUGS || '').split(',').map(x => x.trim()).filter(Boolean); // slug or slug:also
const ALSO_ENABLED    = process.env.ALSO === '1';
const ALSO_SINCE_DAYS = Number(process.env.ALSO_SINCE_DAYS || 0);
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

function buildJWT(key = GHOST_ADMIN_KEY) {
  const [kid, secret] = key.split(':');
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

// Poems: each stanza is one <p> with <br> between its lines, and an empty <p></p> marks a stanza break. Mail clients turn those
// empty paragraphs into tall gaps, so they are removed and each stanza gets one line (1em) of space after it, lines single-spaced.
// Prose keeps normal paragraphs with 1em between them.
const EMPTY_P = /<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/g;
function formatBody(body, isPoem) {
  let html = body.replace(EMPTY_P, '');
  const gap = '0 0 1em 0';
  const lh = isPoem ? '1.5' : '1.6';
  html = html.replace(/<p(\s[^>]*)?>/g, `<p style="margin:${gap};line-height:${lh}">`);
  html = html.replace(/<blockquote(\s[^>]*)?>/g, '<blockquote style="margin:0 0 1.25em 0;padding:0 0 0 12px;border-left:3px solid #ddd;font-size:15px;line-height:1.5;color:#555">');
  return html;
}

// ── "Also at Inkhorn": every department, latest item ──────────────────────────

const pagePath = (u) => SITE_URL + new URL(u).pathname;
const DEPARTMENTS = [
  { label: "Founder's Letter", tag: 'letter', page: `${SITE_URL}/founder-letter/` },
  { label: 'Gallery', tag: 'art', page: `${SITE_URL}/art/` },
  // Dear Inkhorn: add { label: 'Dear Inkhorn', tag: ..., page: ... } when it exists in Ghost.
];
const MUSE_PAGE = 'https://gomuse.io/';

/** When the previous weekly email went out, or null. */
async function lastSendAt() {
  const last = await api.posts.browse({ filter: 'tag:hash-weekly-email+status:[published,sent]', order: 'published_at desc', limit: 1, fields: 'id,published_at' });
  return last[0]?.published_at ? new Date(last[0].published_at) : null;
}

/** Released Muse issues, newest first. MUSE_FAKE_ISSUE="Winter 2027|winter-2027" fakes a release (test samples only). */
async function museIssues() {
  if (process.env.MUSE_FAKE_ISSUE) {
    const [name, slug] = process.env.MUSE_FAKE_ISSUE.split('|');
    return [{ name, slug, released_at: new Date().toISOString() }];
  }
  try {
    const r = await fetch('https://api.gomuse.io/issues');
    return r.ok ? ((await r.json()).issues || []) : [];
  } catch (err) {
    console.warn('Muse issues unavailable:', err.message);
    return [];
  }
}

/**
 * The latest item in every department (always one row each), flagged New when it came out after `since`. Muse: if an issue was
 * released after `since` (the previous weekly email), the section leads with a "New from Muse" notice instead of the normal Muse row,
 * once: the next send moves `since` forward. If Muse cannot be reached, the normal row shows and the notice carries to the next send.
 */
async function fetchAlso(since) {
  const rows = [];
  for (const d of DEPARTMENTS) {
    const [p] = await api.posts.browse({ filter: `primary_tag:${d.tag}+status:published`, order: 'published_at desc', limit: 1, fields: 'id,title,url,custom_excerpt,published_at' });
    if (p) rows.push({ label: d.label, page: d.page, title: p.title, url: pagePath(p.url), date: new Date(p.published_at), isNew: new Date(p.published_at) > since, note: p.custom_excerpt || '' });
  }
  const issues = await museIssues();
  const fresh = issues.find(i => new Date(i.released_at) > since); // newest first, so the newest new issue
  let notice = null;
  if (fresh) {
    notice = { text: `New from Muse: the ${fresh.name} issue`, url: `https://gomuse.io/issues/${fresh.slug}` };
  } else {
    const issue = issues[0];
    rows.push(issue
      ? { label: 'Muse', page: MUSE_PAGE, title: `${issue.name} issue`, url: `https://gomuse.io/issues/${issue.slug}`, date: new Date(issue.released_at), isNew: false, note: '' }
      : { label: 'Muse', page: MUSE_PAGE, title: 'Read and help choose the next issue', url: MUSE_PAGE, date: null, isNew: false, note: '' });
  }
  return { rows, notice };
}

function alsoHtml({ rows: items, notice }) {
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
  const rows = items.map(i =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.4">` +
    `<a href="${esc(i.page)}" style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#888;text-decoration:none">${esc(i.label)}</a>` +
    (i.isNew ? ` <span style="font-size:11px;font-weight:700;color:#ad1b45">NEW</span>` : '') + `<br>` +
    `<a href="${esc(i.url)}" style="color:#1a1a1a;font-weight:600;text-decoration:none">${esc(i.title)}</a>` +
    (i.date ? ` <span style="font-size:13px;color:#888">&middot; ${fmt(i.date)}</span>` : '') +
    (i.note ? `<br><span style="font-size:14px;font-style:italic;color:#555">${esc(i.note)}</span>` : '') + `</p>`).join('\n');
  return (
    `<hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0 20px">\n` +
    `<p style="margin:0 0 14px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1a1a1a">Also at Inkhorn</p>\n` +
    (notice ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.4"><a href="${esc(notice.url)}" style="color:#ad1b45;font-weight:700;text-decoration:none">${esc(notice.text)} &rarr;</a></p>\n` : '') +
    `${rows}\n`
  );
}


// ── Life on Words moved note (2026-11-13) ─────────────────────────────────────
// Shown near the top of the four Sunday emails below, then never again (the dates are the whole mechanism: nothing to remove).
const LOW_NOTE_SUNDAYS = ['2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06']; // Pacific dates
const LOW_NOTE_HTML =
  `<p style="margin:0 0 22px;padding:12px 14px;background:#f6f3ee;font-size:15px;line-height:1.45;color:#1a1a1a">` +
  `Life on Words, our interview podcast, now lives at <a href="https://terryheath.com/podcast/" style="color:#1a1a1a;font-weight:700">terryheath.com/podcast</a> ` +
  `as Inkhorn Review becomes part of the nonprofit Inkhorn Press. The full archive and every new episode are there.</p>\n`;
function lowNote(now = new Date()) {
  const pacificDate = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  return LOW_NOTE_SUNDAYS.includes(pacificDate) ? LOW_NOTE_HTML : '';
}

function emailHtml(post, body, alsoItems = null) {
  const isPoem = (post.tags || []).some(t => t.slug === 'poetry');
  const full = formatBody(body, isPoem);
  const byline = post.custom_excerpt ? `<p style="margin:0 0 24px;font-size:16px;font-style:italic;color:#555">${esc(post.custom_excerpt)}</p>` : '';
  return (
    `<!--kg-card-begin: html-->\n` +
    lowNote() +
    `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#888">From ${esc(issueLabel(post))}</p>\n` +
    `<h1 style="margin:0 0 8px;font-size:28px;line-height:1.25;color:#1a1a1a">${esc(post.title)}</h1>\n` +
    `${byline}\n` +
    `<div style="font-size:17px;color:#1a1a1a">${full}</div>\n` +
    `<hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0 20px">\n` +
    `<p style="margin:0 0 6px;font-size:15px"><a href="${esc(post.url)}" style="color:#1a1a1a;font-weight:700">Read it on Inkhorn Review &rarr;</a></p>\n` +
    `<p style="margin:0;font-size:13px;color:#888">${esc(issueLabel(post))}</p>\n` +
    (alsoItems ? alsoHtml(alsoItems) : '') +
    `<!--kg-card-end: html-->`
  );
}

async function createEmailDraft(post, html, subject = post.title) {
  return api.posts.add({
    title: post.title,
    email_subject: subject,
    html,
    status: 'draft',
    tags: [{ name: EMAIL_TAG }],
    visibility: 'public',
    canonical_url: post.url,
    email_only: true,
  }, { source: 'html' });
}

// Test emails go through Ghost's email-preview endpoint, which integration (API) keys may not call, so this uses the staff
// access token (GHOST_STAFF_TOKEN).
async function sendTest(draftId, to) {
  const staff = process.env.GHOST_STAFF_TOKEN;
  if (!staff) throw new Error('GHOST_STAFF_TOKEN is required to send a test email');
  const res = await fetch(`${GHOST_API_URL}/ghost/api/admin/email_previews/posts/${draftId}/`, {
    method: 'POST',
    headers: { Authorization: `Ghost ${buildJWT(staff)}`, 'Content-Type': 'application/json' },
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

async function sendSamples() {
  const { eligible } = await fetchPool();
  for (const entry of TEST_SLUGS) {
    const [slug, variant] = entry.split(':');
    const piece = eligible.find(p => p.slug === slug);
    if (!piece) { console.warn(`Sample "${slug}" is not an eligible print piece: skipped.`); continue; }
    const full = await api.posts.read({ id: piece.id }, { formats: 'html' });
    let also = null;
    if (variant === 'also') {
      const since = (await lastSendAt()) || new Date(Date.now() - 7 * 86400_000);
      also = await fetchAlso(since);
      console.log(`"Also at Inkhorn" sample (New = after ${since.toISOString()}): ${also.notice ? `[${also.notice.text}] ` : ''}${also.rows.map(i => `${i.label}: ${i.title}${i.isNew ? ' [NEW]' : ''}`).join(' | ')}`);
    }
    const subject = `${variant === 'also' ? 'Proposed' : 'Current'} layout: ${piece.title}`;
    const draft = await createEmailDraft(piece, emailHtml(piece, full.html || '', also), subject);
    try {
      await sendTest(draft.id, TEST_EMAIL);
      console.log(`Sample sent to ${TEST_EMAIL}: "${piece.title}" (${slug}${variant ? ':' + variant : ''}).`);
    } finally {
      await api.posts.delete({ id: draft.id });
    }
  }
}

async function main() {
  if (TEST_SLUGS.length) { await sendSamples(); return; }
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
  let also = null;
  if (ALSO_ENABLED) {
    const since = ALSO_SINCE_DAYS ? new Date(Date.now() - ALSO_SINCE_DAYS * 86400_000) : (await lastSendAt()) || new Date(Date.now() - 7 * 86400_000);
    also = await fetchAlso(since);
    console.log(`Also at Inkhorn (since ${since.toISOString()}): ${also.notice ? `[${also.notice.text}] ` : ''}${also.rows.map(i => `${i.label}: ${i.title}`).join(' | ')}`);
  }
  const html = emailHtml(pick, full.html || '', also);
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

try {
  await main();
} catch (err) {
  console.error('\nWEEKLY PIECE FAILED:', err);
  process.exit(1);
}
