#!/usr/bin/env node
// inkhorn/digest.js — Inkhorn Review weekly digest generator
//
// PUBLISH_MODE (env var):
//   publish — two-step: create draft → publish with digest newsletter (default)
//   draft   — creates post as draft, no newsletter send
//
// Required env vars:
//   GHOST_API_URL   e.g. https://accelerated-basilisk.pikapod.net
//   GHOST_ADMIN_KEY e.g. kid:hex
//   PUBLISH_MODE    draft | publish

import GhostAdminAPI from '@tryghost/admin-api';
import { createHmac } from 'crypto';
import { postToBluesky } from './social-bluesky.js';
import { esc, HR, sectionHeading, itemRow } from './digest-html.js';
import { runWelcome } from './welcome.js';

const GHOST_API_URL   = process.env.GHOST_API_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
const PUBLISH_MODE    = (process.env.PUBLISH_MODE || 'publish').trim().toLowerCase();
const DRY_RUN         = process.env.DRY_RUN === '1';
const SITE_URL        = 'https://inkhornreview.com';

if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const api = new GhostAdminAPI({
  url:     GHOST_API_URL,
  key:     GHOST_ADMIN_KEY,
  version: 'v5.0',
});

// ── Issue tag helpers ─────────────────────────────────────────────────────────

// Season tags (kept for backward-compat with autumn-2026 posts)
const SEASON_RE = /^(autumn|winter|spring|summer)-(\d{4})$/;
// Publication tags (inkhorn-N, whiterabbit-N, anthology-N, awards-N)
const PUB_RE    = /^(inkhorn|whiterabbit|anthology|awards)-(\d+)$/;
// Combined pattern
const ISSUE_RE  = /^(autumn|winter|spring|summer)-\d{4}$|^(inkhorn|whiterabbit|anthology|awards)-\d+$/;

function isIssueTag(slug) {
  return ISSUE_RE.test(slug);
}

function formatIssueTitle(slug) {
  const pm = slug.match(PUB_RE);
  if (pm) {
    const type = pm[1].charAt(0).toUpperCase() + pm[1].slice(1);
    return type + ' No. ' + pm[2];
  }
  const sm = slug.match(SEASON_RE);
  if (!sm) return slug;
  return sm[1].charAt(0).toUpperCase() + sm[1].slice(1) + ' ' + sm[2];
}

// ── Department mapping ────────────────────────────────────────────────────────

function department(post) {
  const pt = post.primary_tag?.slug || '';
  if (isIssueTag(pt))      return 'issue:' + pt;
  if (pt === 'letter')     return 'letter';
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
  { key: 'poetry',     label: 'Poetry' },
  { key: 'fiction',    label: 'Fiction' },
  { key: 'nonfiction', label: 'Nonfiction' },
  { key: 'art',        label: 'Art' },
  { key: 'podcast',    label: 'Podcast' },
];

// ── HTML helpers ──────────────────────────────────────────────────────────────

function issueBlock(issueSlug, tag) {
  // Prefer tag name over computed title (tag.name = "Inkhorn Review No. 1" etc.)
  const title = tag?.name || formatIssueTitle(issueSlug);
  // Publication tags have no collection route — link to their tag page
  const url   = PUB_RE.test(issueSlug)
    ? `${SITE_URL}/tag/${issueSlug}/`
    : `${SITE_URL}/${issueSlug}/`;
  const cover = tag?.feature_image || null;
  const desc  = tag?.description   || null;
  const count = tag?.count?.posts  || null;

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

  return html;
}

function digestFooter() {
  // ISSN 3144-1998 (Online)
  // Print ISSN: [placeholder — add when assigned]
  const link = `${SITE_URL}/#/portal/account/newsletters`;
  return (
    HR +
    `<p style="margin:0;font-size:13px;color:#999;line-height:1.5">` +
    `Also from Inkhorn Review: ` +
    `<a href="${esc(link)}" style="color:#999">The Colophon</a> and ` +
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

// ── Ghost-derived watermark ───────────────────────────────────────────────────
// Replaces digest-state.json. Returns the published_at of the most recently
// published digest post, or null if no digest has ever been sent.
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const lastDigestAt = await getLastDigestAt();
  console.log('Last digest published_at:', lastDigestAt ?? '(none — first run)');

  // Never include paid (visibility:paid) posts in the digest.
  const postsFilter = lastDigestAt
    ? `status:published+tag:-hash-digest+visibility:-paid+published_at:>'${lastDigestAt}'`
    : 'status:published+tag:-hash-digest+visibility:-paid';
  console.log('\nFetching posts newer than last digest …');
  const rawPosts = await api.posts.browse({
    filter: postsFilter,
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

  for (const { key } of DEPT_ORDER) {
    if (key === 'issue') {
      // Iterate all issue:* sections found in grouped
      for (const [sectionKey, sectionPosts] of grouped) {
        if (!sectionKey.startsWith('issue:')) continue;
        const issueSlug = sectionKey.slice('issue:'.length);

        sectionPosts.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
        const newest    = sectionPosts[0];

        seenIssueSlugs.add(issueSlug);
        if (!groups.has('issue')) groups.set('issue', []);
        groups.get('issue').push({ type: 'issue', slug: issueSlug });

        sectionPosts.slice(1).forEach(p =>
          console.log(`  SKIP [not-newest] ${sectionKey}: "${p.title}" at ${p.published_at}`)
        );
      }
    } else {
      const sectionPosts = grouped.get(key);
      if (!sectionPosts?.length) continue;

      sectionPosts.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
      const newest = sectionPosts[0];
      groups.set(key, [{ type: 'post', post: newest }]);

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
    ? (issueTags.get(groups.get('issue')[0].slug)?.name || formatIssueTitle(groups.get('issue')[0].slug))
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
    throw new Error('email field is null after publish — newsletter was not associated, no emails queued.');
  }

  console.log('\nSend confirmed by API.');

  // Post to Bluesky (failure must not fail the digest)
  if (!DRY_RUN) {
    try {
      const sectionNames = orderedKeys.map(key => {
        if (key === 'issue') {
          return groups.get('issue').map(item => issueTags.get(item.slug)?.name || formatIssueTitle(item.slug)).join(' & ');
        }
        return DEPT_ORDER.find(d => d.key === key)?.label ?? key;
      });
      await postToBluesky({
        title:           digestTitle,
        sectionNames,
        url:             sent.url,
        featureImageUrl: featureImage,
      });
    } catch (bskyErr) {
      console.error('\n⚠️  Bluesky post failed (digest still succeeded):');
      console.error(bskyErr.message);
    }
  }
}

// The digest and the welcome-email step run independently: a failure in one
// must not stop the other. Exit non-zero if either failed.
const failed = [];
try {
  await main();
} catch (err) {
  console.error('\nDIGEST FAILED:', err);
  failed.push('digest');
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
