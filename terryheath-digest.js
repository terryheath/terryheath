#!/usr/bin/env node
/**
 * terryheath-digest.js — Terry Heath weekly digest
 *
 * Sections:
 *   1. All terryheath.com posts since the last digest (newest first).
 *   2. Newest Inkhorn Review founder's letter (primary_tag:letter) since the last digest.
 *   3. All Life on Words podcast episodes (primary_tag:podcast) since the last digest.
 *
 * If there are no new terryheath.com posts, nothing is sent that week.
 *
 * Required env:
 *   TH_GHOST_API_URL      terryheath.com Ghost API URL (PikaPods pod URL)
 *   TH_GHOST_ADMIN_KEY    terryheath.com Admin API key (id:hex)
 *
 * Optional env:
 *   TH_NEWSLETTER_SLUG    newsletter slug to email on publish (required for publish mode)
 *   TH_PUBLISH_MODE       draft | publish (default: draft)
 *   INKHORN_API_URL       Inkhorn Ghost URL (for cross-site sections)
 *   INKHORN_CONTENT_KEY   Inkhorn Content API key (read-only)
 *   DRY_RUN               1 to log what would happen without making changes
 */

import GhostAdminAPI from '@tryghost/admin-api';
import { createHmac } from 'crypto';

const TH_API_URL    = process.env.TH_GHOST_API_URL;
const TH_ADMIN_KEY  = process.env.TH_GHOST_ADMIN_KEY;
const NEWSLETTER    = process.env.TH_NEWSLETTER_SLUG;
const PUBLISH_MODE  = (process.env.TH_PUBLISH_MODE || 'draft').trim().toLowerCase();
const INKHORN_URL   = process.env.INKHORN_API_URL;
const INKHORN_KEY   = process.env.INKHORN_CONTENT_KEY;
const DRY_RUN       = process.env.DRY_RUN === '1';
const TH_SITE_URL   = 'https://terryheath.com';

if (!TH_API_URL || !TH_ADMIN_KEY) {
  console.error('TH_GHOST_API_URL and TH_GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const api = new GhostAdminAPI({
  url:     TH_API_URL,
  key:     TH_ADMIN_KEY,
  version: 'v5.0',
});

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HR = '<hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0 24px">';

function sectionHeading(label) {
  return (
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px"><tr>` +
    `<td style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;` +
    `color:#888;padding-bottom:6px;border-bottom:2px solid #1a1a1a">` +
    `${esc(label)}</td></tr></table>\n`
  );
}

function itemRow(post, opts = {}) {
  const titleLink =
    `<a href="${esc(post.url)}" style="color:#1a1a1a;font-weight:600;text-decoration:none">` +
    `${esc(post.title || 'Untitled')}</a>`;
  const byline = post.custom_excerpt
    ? `<br><span style="font-size:14px;font-style:italic;color:#555">${esc(post.custom_excerpt)}</span>`
    : '';

  if (opts.thumb && post.feature_image) {
    return (
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px"><tr>\n` +
      `<td width="72" valign="top" style="padding-right:12px">\n` +
      `<img src="${esc(post.feature_image)}" width="72" height="72" alt="" ` +
      `style="display:block;object-fit:cover;border-radius:3px">\n` +
      `</td>\n` +
      `<td valign="middle" style="font-size:15px;line-height:1.4">${titleLink}${byline}</td>\n` +
      `</tr></table>\n`
    );
  }

  return `<p style="margin:0 0 10px;font-size:15px;line-height:1.4">${titleLink}${byline}</p>\n`;
}

function digestFooter() {
  const link = `${TH_SITE_URL}/#/portal/account/newsletters`;
  return (
    HR +
    `<p style="margin:0;font-size:13px;color:#999;line-height:1.5">` +
    `You received this because you subscribed to the Terry Heath weekly digest. ` +
    `<a href="${esc(link)}" style="color:#999">Manage your subscriptions</a>.` +
    `</p>\n`
  );
}

// ── JWT for raw Admin API calls ───────────────────────────────────────────────

function buildJWT() {
  const [kid, secret] = TH_ADMIN_KEY.split(':');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 300;
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp, iat, aud: '/admin/' })).toString('base64url');
  const sigInput = `${header}.${payload}`;
  const sig = createHmac('sha256', Buffer.from(secret, 'hex')).update(sigInput).digest('base64url');
  return `${sigInput}.${sig}`;
}

// ── Watermark ─────────────────────────────────────────────────────────────────
// Derived from the most recently published terryheath.com post tagged #digest.
// Falls back to 7 days before now if no digest has ever been sent.

async function getLastDigestAt() {
  try {
    const posts = await api.posts.browse({
      filter: 'tag:hash-digest+status:published',
      order:  'published_at desc',
      limit:  1,
      fields: 'published_at',
    });
    return posts[0]?.published_at ?? null;
  } catch {
    return null;
  }
}

// ── Inkhorn Content API ───────────────────────────────────────────────────────
// Read-only. Returns posts with their canonical inkhornreview.com URLs.

async function fetchInkhornPosts(filter, limit = 'all') {
  if (!INKHORN_URL || !INKHORN_KEY) {
    console.log('  INKHORN_API_URL or INKHORN_CONTENT_KEY not set — skipping Inkhorn section.');
    return [];
  }
  const params = new URLSearchParams({
    key:    INKHORN_KEY,
    filter,
    limit:  String(limit),
    order:  'published_at desc',
    fields: 'title,url,custom_excerpt,feature_image,published_at',
  });
  try {
    const res = await fetch(`${INKHORN_URL}/ghost/api/content/posts/?${params}`);
    if (!res.ok) {
      console.warn(`  Inkhorn Content API returned ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.posts || [];
  } catch (e) {
    console.warn(`  Inkhorn Content API fetch failed: ${e.message}`);
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `mode=${PUBLISH_MODE}` +
    ` newsletter=${NEWSLETTER || '(none)'}` +
    `${DRY_RUN ? ' DRY_RUN' : ''}`
  );

  // Watermark
  const lastDigestAt = await getLastDigestAt();
  const watermark = lastDigestAt ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  console.log(`Watermark: ${watermark}${lastDigestAt ? '' : ' (7-day fallback — first run)'}`);

  // terryheath.com posts since watermark (excluding digest posts themselves)
  console.log('\nFetching terryheath.com posts …');
  const rawThPosts = await api.posts.browse({
    filter: `status:published+tag:-hash-digest+published_at:>'${watermark}'`,
    order:  'published_at desc',
    limit:  'all',
    fields: 'id,title,url,custom_excerpt,feature_image,published_at',
  });

  const PREVIEW_URL_RE = /\/p\/[0-9a-f-]{36}\//;
  const thPosts = rawThPosts.filter(p => p.url && !PREVIEW_URL_RE.test(p.url));

  console.log(`terryheath.com: ${thPosts.length} post(s) since watermark.`);
  thPosts.forEach(p => console.log(`  + "${p.title}"`));

  if (thPosts.length === 0) {
    console.log('\nNo new terryheath.com posts since last digest — nothing to send this week.');
    return;
  }

  // Inkhorn sections since watermark
  console.log('\nFetching Inkhorn posts …');
  const [inkhornLetter, inkhornPodcast] = await Promise.all([
    fetchInkhornPosts(
      `primary_tag:letter+status:published+published_at:>'${watermark}'`,
      1
    ),
    fetchInkhornPosts(
      `primary_tag:podcast+status:published+published_at:>'${watermark}'`,
      'all'
    ),
  ]);

  console.log(`Inkhorn: ${inkhornLetter.length} founder's letter, ${inkhornPodcast.length} podcast episode(s).`);
  inkhornLetter.forEach(p => console.log(`  + letter: "${p.title}"`));
  inkhornPodcast.forEach(p => console.log(`  + podcast: "${p.title}"`));

  // Feature image: first terryheath.com post's, falling back to first Inkhorn post with one
  const featureImage =
    thPosts.find(p => p.feature_image)?.feature_image ??
    [...inkhornLetter, ...inkhornPodcast].find(p => p.feature_image)?.feature_image ??
    null;

  // Subject line: lead with first terryheath.com post title
  const extraCount = (thPosts.length - 1) + inkhornLetter.length + inkhornPodcast.length;
  let emailSubject = thPosts[0].title;
  if (extraCount > 0) emailSubject += ` — and ${extraCount} more`;

  // Digest title (dated, for records)
  const now = new Date();
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const digestTitle = `Terry Heath — Week of ${fmt(now)}, ${now.getFullYear()}`;

  console.log(`\nTitle:    ${digestTitle}`);
  console.log(`Subject:  ${emailSubject}`);
  console.log(`Feature:  ${featureImage ? 'yes' : 'none'}`);

  // Build HTML
  const parts = [];

  // Section 1: terryheath.com posts
  {
    let html = sectionHeading('New from Terry Heath');
    for (const post of thPosts) {
      html += itemRow(post, { thumb: true });
    }
    parts.push(html);
  }

  // Section 2: Inkhorn founder's letter
  if (inkhornLetter.length) {
    let html = HR + '\n' + sectionHeading("Founder's Letter");
    for (const post of inkhornLetter) {
      html += itemRow(post);
    }
    parts.push(html);
  }

  // Section 3: Life on Words podcast episodes
  if (inkhornPodcast.length) {
    let html = HR + '\n' + sectionHeading('Life on Words');
    for (const post of inkhornPodcast) {
      html += itemRow(post, { thumb: true });
    }
    parts.push(html);
  }

  parts.push(digestFooter());

  const digestHtml =
    `<!--kg-card-begin: html-->\n${parts.join('\n')}\n<!--kg-card-end: html-->`;

  if (DRY_RUN) {
    console.log('\n[DRY RUN] — no changes made.');
    console.log(digestHtml);
    return;
  }

  // Create draft
  console.log('\nCreating digest draft …');
  const draft = await api.posts.add(
    {
      title:         digestTitle,
      email_subject: emailSubject,
      html:          digestHtml,
      status:        'draft',
      feature_image: featureImage,
      tags:          [{ name: '#digest' }],
      visibility:    'members',
    },
    { source: 'html' }
  );

  console.log(`Draft created: ${draft.id}`);
  console.log(`Title:   ${draft.title}`);
  console.log(`Subject: ${draft.email_subject}`);

  if (PUBLISH_MODE !== 'publish') {
    console.log('TH_PUBLISH_MODE=draft — left as draft.');
    return;
  }

  if (!NEWSLETTER) {
    console.error('TH_NEWSLETTER_SLUG is required when TH_PUBLISH_MODE=publish');
    process.exitCode = 1;
    return;
  }

  console.log('TH_PUBLISH_MODE=publish — sending …');
  await api.posts.edit(
    {
      id:         draft.id,
      status:     'published',
      updated_at: draft.updated_at,
    },
    {
      newsletter:    NEWSLETTER,
      email_segment: 'all',
    }
  );

  // Verify
  const [sent] = await api.posts.browse({
    filter:  `id:${draft.id}`,
    include: 'email,newsletter',
    limit:   1,
  });

  console.log(`\nPost status: ${sent?.status}`);
  console.log(`Newsletter:  ${sent?.newsletter?.name ?? 'null'}`);

  if (!sent?.email) {
    console.error('\nFAILURE: email field is null after publish — newsletter was not associated, no emails queued.');
    process.exit(1);
  }

  // /emails/ record counts (no addresses)
  const jwt = buildJWT();
  const emailsResp = await fetch(
    `${TH_API_URL}/ghost/api/admin/emails/?` +
      `filter=${encodeURIComponent(`post_id:${draft.id}`)}&limit=5`,
    { headers: { Authorization: `Ghost ${jwt}` } }
  );
  const emailsData   = await emailsResp.json();
  const emailRecords = emailsData.emails ?? [];
  console.log(`\n/emails/ records: ${emailRecords.length}`);
  for (const e of emailRecords) {
    console.log(
      `  status=${e.status}` +
      `  email_count=${e.email_count}` +
      `  delivered=${e.delivered_count}` +
      `  failed=${e.failed_count}`
    );
  }

  console.log('\nSend confirmed by API.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
