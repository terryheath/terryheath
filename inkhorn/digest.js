#!/usr/bin/env node
// inkhorn/digest.js — Inkhorn Review weekly digest generator
//
// PUBLISH_MODE (env var):
//   draft   — creates post as draft, no newsletter send (default)
//   publish — two-step: create draft → publish with digest newsletter
//
// Required env vars:
//   GHOST_API_URL   e.g. https://accelerated-basilisk.pikapod.net
//   GHOST_ADMIN_KEY e.g. kid:hex
//   PUBLISH_MODE    draft | publish

import GhostAdminAPI from '@tryghost/admin-api';
import { createHmac } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, 'digest-state.json');

const GHOST_API_URL   = process.env.GHOST_API_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
const PUBLISH_MODE    = (process.env.PUBLISH_MODE || 'draft').trim().toLowerCase();
const DRY_RUN         = process.env.DRY_RUN === '1';
const SITE_URL        = 'https://inkhornreview.com';

// Ebook download URLs keyed by issue slug. Add entries as issues are released.
// Example: 'autumn-2026': { epub: 'https://...', pdf: 'https://...' }
const EBOOK_URLS = {
};

if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const api = new GhostAdminAPI({
  url:     GHOST_API_URL,
  key:     GHOST_ADMIN_KEY,
  version: 'v5.0',
});

// ── Watermark state ───────────────────────────────────────────────────────────
// Shape: { "sections": { "<sectionKey>": "<ISO published_at>" } }
// Section keys: issue:autumn-2026, letter, micro, poetry, fiction,
//               nonfiction, art, podcast

function loadState() {
  if (!existsSync(STATE_FILE)) return { sections: {} };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { sections: {} };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

// ── Issue tag helpers ─────────────────────────────────────────────────────────

const ISSUE_RE = /^(autumn|winter|spring|summer)-(\d{4})$/;

function isIssueTag(slug) {
  return ISSUE_RE.test(slug);
}

function formatIssueTitle(slug) {
  const m = slug.match(ISSUE_RE);
  if (!m) return slug;
  return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + m[2];
}

// ── Department mapping ────────────────────────────────────────────────────────

function department(post) {
  const pt = post.primary_tag?.slug || '';
  if (isIssueTag(pt))      return 'issue:' + pt;
  if (pt === 'letter')     return 'letter';
  if (pt === 'micro')      return 'micro';
  if (pt === 'poetry')     return 'poetry';
  if (pt === 'fiction')    return 'fiction';
  if (pt === 'nonfiction') return 'nonfiction';
  if (pt === 'art')        return 'art';
  if (pt === 'podcast')    return 'podcast';
  return null; // skip unknown
}

// Fixed section order per spec
const DEPT_ORDER = [
  { key: 'issue',      label: null },
  { key: 'letter',     label: 'Letter from the Editor' },
  { key: 'micro',      label: 'Micro Fiction' },
  { key: 'poetry',     label: 'Poetry' },
  { key: 'fiction',    label: 'Fiction' },
  { key: 'nonfiction', label: 'Nonfiction' },
  { key: 'art',        label: 'Art' },
  { key: 'podcast',    label: 'Podcast' },
];

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HR = '<hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0 24px">';

function issueBlock(issueSlug, tag) {
  const title = formatIssueTitle(issueSlug);
  const url   = `${SITE_URL}/${issueSlug}/`;
  const cover = tag?.feature_image || null;
  const desc  = tag?.description   || null;
  const count = tag?.count?.posts  || null;
  const ebook = EBOOK_URLS[issueSlug] || null;

  let html = '';

  if (cover) {
    html +=
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr><td>\n` +
      `<img src="${esc(cover)}" width="600" alt="${esc(title)} cover" ` +
      `style="display:block;max-width:100%;height:auto">\n` +
      `</td></tr></table>\n`;
  }

  if (desc) {
    html +=
      `<p style="margin:0 0 16px;font-size:16px;font-style:italic;` +
      `line-height:1.6;color:#333">${esc(desc)}</p>\n`;
  }

  if (count) {
    html += `<p style="margin:0 0 10px;font-size:14px;color:#888">${count} pieces</p>\n`;
  }

  html += `<p style="margin:0 0 10px"><a href="${esc(url)}" ` +
    `style="color:#1a1a1a;font-weight:700;text-decoration:none">Read the issue &rarr;</a></p>\n`;

  if (ebook?.epub || ebook?.pdf) {
    let ebookLine = `<p style="margin:0;font-size:14px">Download: `;
    if (ebook.epub) ebookLine += `<a href="${esc(ebook.epub)}" style="color:#555">EPUB</a>`;
    if (ebook.epub && ebook.pdf) ebookLine += ` &nbsp;·&nbsp; `;
    if (ebook.pdf)  ebookLine += `<a href="${esc(ebook.pdf)}" style="color:#555">PDF</a>`;
    ebookLine += `</p>\n`;
    html += ebookLine;
  }

  return html;
}

function sectionHeading(label) {
  return (
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px"><tr>` +
    `<td style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;` +
    `color:#888;padding-bottom:6px;border-bottom:2px solid #1a1a1a">` +
    `${esc(label)}</td></tr></table>\n`
  );
}

function itemRow(post, opts = {}) {
  const titleLink = `<a href="${esc(post.url)}" style="color:#1a1a1a;font-weight:600;text-decoration:none">${esc(post.title || 'Untitled')}</a>`;
  const byline    = post.custom_excerpt
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
  const link = `${SITE_URL}/#/portal/account/newsletters`;
  return (
    HR +
    `<p style="margin:0;font-size:13px;color:#999;line-height:1.5">` +
    `Also from Inkhorn Review: ` +
    `<a href="${esc(link)}" style="color:#999">Weekly Micro Fiction</a>, ` +
    `<a href="${esc(link)}" style="color:#999">The Colophon</a>, and ` +
    `<a href="${esc(link)}" style="color:#999">Issue Announcements</a>. ` +
    `Manage your subscriptions to add them.` +
    `</p>\n`
  );
}

// ── JWT helper for raw Admin API calls ────────────────────────────────────────

function buildJWT() {
  const [kid, secret] = GHOST_ADMIN_KEY.split(':');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 300;
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp, iat, aud: '/admin/' })).toString('base64url');
  const sigInput = `${header}.${payload}`;
  const sig = createHmac('sha256', Buffer.from(secret, 'hex')).update(sigInput).digest('base64url');
  return `${sigInput}.${sig}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const state = loadState();
  console.log('Watermark state:', JSON.stringify(state.sections));

  console.log('\nFetching all published posts (excluding #digest) …');
  const rawPosts = await api.posts.browse({
    filter: 'status:published+tag:-hash-digest',
    include: 'tags',
    limit:   'all',
  });

  const PREVIEW_URL_RE = /\/p\/[0-9a-f-]{36}\//;
  const posts = rawPosts.filter(p =>
    p.status === 'published' &&
    p.url &&
    !PREVIEW_URL_RE.test(p.url)
  );

  console.log(`Fetched ${rawPosts.length}, ${posts.length} with canonical URLs.`);

  // Group all posts by section key
  const grouped = new Map(); // sectionKey -> post[]
  for (const post of posts) {
    const dept = department(post);
    if (!dept) {
      console.log(`  SKIP [no-section] "${post.title}" primary_tag=${post.primary_tag?.slug ?? 'none'}`);
      continue;
    }
    if (!grouped.has(dept)) grouped.set(dept, []);
    grouped.get(dept).push(post);
  }

  // For each section, select the newest post and filter by watermark
  const groups        = new Map(); // rendering map: DEPT_ORDER key -> items[]
  const seenIssueSlugs = new Set();
  const newWatermarks  = new Map(); // sectionKey -> published_at (written on success)

  for (const { key } of DEPT_ORDER) {
    if (key === 'issue') {
      // Iterate all issue:* sections found in grouped
      for (const [sectionKey, sectionPosts] of grouped) {
        if (!sectionKey.startsWith('issue:')) continue;
        const issueSlug = sectionKey.slice('issue:'.length);

        sectionPosts.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
        const newest    = sectionPosts[0];
        const watermark = state.sections[sectionKey];

        if (watermark && new Date(newest.published_at) <= new Date(watermark)) {
          console.log(`  SKIP [watermark] ${sectionKey}: newest="${newest.title}" at ${newest.published_at} not after watermark ${watermark}`);
          sectionPosts.slice(1).forEach(p =>
            console.log(`  SKIP [not-newest] ${sectionKey}: "${p.title}" at ${p.published_at}`)
          );
          continue;
        }

        seenIssueSlugs.add(issueSlug);
        if (!groups.has('issue')) groups.set('issue', []);
        groups.get('issue').push({ type: 'issue', slug: issueSlug });
        newWatermarks.set(sectionKey, newest.published_at);

        sectionPosts.slice(1).forEach(p =>
          console.log(`  SKIP [not-newest] ${sectionKey}: "${p.title}" at ${p.published_at}`)
        );
      }
    } else {
      const sectionPosts = grouped.get(key);
      if (!sectionPosts?.length) continue;

      sectionPosts.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
      const newest    = sectionPosts[0];
      const watermark = state.sections[key];

      if (watermark && new Date(newest.published_at) <= new Date(watermark)) {
        console.log(`  SKIP [watermark] ${key}: newest="${newest.title}" at ${newest.published_at} not after watermark ${watermark}`);
        sectionPosts.slice(1).forEach(p =>
          console.log(`  SKIP [not-newest] ${key}: "${p.title}" at ${p.published_at}`)
        );
        continue;
      }

      groups.set(key, [{ type: 'post', post: newest }]);
      newWatermarks.set(key, newest.published_at);

      sectionPosts.slice(1).forEach(p =>
        console.log(`  SKIP [not-newest] ${key}: "${p.title}" at ${p.published_at}`)
      );
    }
  }

  const orderedKeys = DEPT_ORDER.map(d => d.key).filter(k => groups.has(k));
  if (orderedKeys.length < 2) {
    console.log(`\nOnly ${orderedKeys.length} section(s) after watermark filter — nothing to send.`);
    return;
  }

  // Fetch issue tag metadata (feature_image, description, count.posts)
  const issueTags = new Map();
  for (const slug of seenIssueSlugs) {
    try {
      const tag = await api.tags.read({ slug, include: 'count.posts' });
      issueTags.set(slug, tag);
    } catch (err) {
      console.warn(`Could not fetch tag ${slug}:`, err.message);
    }
  }

  // Feature image: issue cover first, then first post with one
  let featureImage = null;
  if (seenIssueSlugs.size > 0) {
    featureImage = issueTags.get([...seenIssueSlugs][0])?.feature_image ?? null;
  }
  if (!featureImage) {
    outer: for (const key of orderedKeys) {
      for (const item of groups.get(key)) {
        if (item.type === 'post' && item.post.feature_image) {
          featureImage = item.post.feature_image;
          break outer;
        }
      }
    }
  }

  // Subject line
  const leadKey    = orderedKeys[0];
  const extraCount = orderedKeys.length - 1;
  let emailSubject = leadKey === 'issue'
    ? formatIssueTitle(groups.get('issue')[0].slug)
    : groups.get(leadKey)[0].post.title;
  if (extraCount > 0) emailSubject += ` — and ${extraCount} more`;

  // Title (dated, for records)
  const now = new Date();
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const digestTitle = `Inkhorn Review — Week of ${fmt(now)}, ${now.getFullYear()}`;

  console.log(`\nTitle:    ${digestTitle}`);
  console.log(`Subject:  ${emailSubject}`);
  console.log(`Sections: ${orderedKeys.join(', ')}`);
  console.log(`Feature image: ${featureImage ? 'yes' : 'none'}`);
  console.log('Watermarks that will be written on success:');
  for (const [k, v] of newWatermarks) console.log(`  ${k}: ${v}`);

  // Build HTML
  const parts = [];
  for (const { key, label } of DEPT_ORDER) {
    if (!groups.has(key)) continue;
    const items = groups.get(key);

    let html = '';
    if (parts.length > 0) html += HR + '\n';

    if (key === 'issue') {
      for (const item of items) {
        html += issueBlock(item.slug, issueTags.get(item.slug));
      }
    } else {
      html += sectionHeading(label);
      const useThumb = key === 'art' || key === 'podcast';
      for (const item of items) {
        html += itemRow(item.post, { thumb: useThumb });
      }
    }
    parts.push(html);
  }
  parts.push(digestFooter());

  const digestHtml = `<!--kg-card-begin: html-->\n${parts.join('\n')}\n<!--kg-card-end: html-->`;

  if (DRY_RUN) {
    console.log('\n[DRY RUN] sections:', orderedKeys.join(', '));
    console.log('[DRY RUN] HTML:');
    console.log(digestHtml);
    return;
  }

  // Create draft
  console.log('\nCreating digest draft …');
  const draft = await api.posts.add({
    title:         digestTitle,
    email_subject: emailSubject,
    html:          digestHtml,
    status:        'draft',
    feature_image: featureImage,
    tags:          [{ name: '#digest' }],
    visibility:    'members',
  }, { source: 'html' });

  console.log(`Draft created: ${draft.id}`);
  console.log(`Title:   ${draft.title}`);
  console.log(`Subject: ${draft.email_subject}`);

  if (PUBLISH_MODE !== 'publish') {
    console.log('PUBLISH_MODE=draft — left as draft.');
    return;
  }

  console.log('PUBLISH_MODE=publish — sending …');
  await api.posts.edit(
    {
      id:         draft.id,
      status:     'published',
      updated_at: draft.updated_at,
    },
    {
      newsletter:    'inkhorn-review-digest',
      email_segment: 'all',
    }
  );

  // Verify: re-fetch with email and newsletter included
  const [sent] = await api.posts.browse({
    filter:  `id:${draft.id}`,
    include: 'email,newsletter',
    limit:   1,
  });

  console.log(`\nPost status: ${sent?.status}`);
  console.log(`email field: ${JSON.stringify(sent?.email ?? null)}`);
  console.log(`newsletter:  ${JSON.stringify(sent?.newsletter ?? null)}`);

  // Check /emails/ via raw API
  const jwt = buildJWT();
  const emailsResp = await fetch(
    `${GHOST_API_URL}/ghost/api/admin/emails/?filter=${encodeURIComponent(`post_id:${draft.id}`)}&limit=5`,
    { headers: { Authorization: `Ghost ${jwt}` } }
  );
  const emailsData  = await emailsResp.json();
  const emailRecords = emailsData.emails ?? [];
  console.log(`\n/emails/ records for this post: ${emailRecords.length}`);
  for (const e of emailRecords) {
    console.log(`  id:              ${e.id}`);
    console.log(`  status:          ${e.status}`);
    console.log(`  email_count:     ${e.email_count}`);
    console.log(`  delivered_count: ${e.delivered_count}`);
    console.log(`  failed_count:    ${e.failed_count}`);
  }

  if (!sent?.email) {
    console.error('\nFAILURE: email field is null after publish — newsletter was not associated, no emails queued.');
    process.exit(1);
  }

  console.log('\nSend confirmed by API.');

  // Write watermarks only after confirmed send
  for (const [k, v] of newWatermarks) {
    state.sections[k] = v;
  }
  saveState(state);
  console.log('Watermark state written to digest-state.json.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
