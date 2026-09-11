#!/usr/bin/env node
// inkhorn/digest.js — Inkhorn Review weekly digest generator
//
// PUBLISH_MODE (env var, also in GCP Secret Manager):
//   draft   — creates post as draft, no newsletter send (default)
//   publish — two-step: create draft → publish with digest newsletter
//
// Required env vars:
//   GHOST_API_URL      e.g. https://accelerated-basilisk.pikapod.net
//   GHOST_ADMIN_KEY    e.g. kid:hex
//   PUBLISH_MODE       draft | publish

import GhostAdminAPI from '@tryghost/admin-api';

const GHOST_API_URL = process.env.GHOST_API_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
const PUBLISH_MODE = (process.env.PUBLISH_MODE || 'draft').trim().toLowerCase();
const DRY_RUN = process.env.DRY_RUN === '1';
const SITE_URL = 'https://inkhornreview.com';

// Ebook download URLs keyed by issue slug. Add entries as issues are released.
// Example: 'autumn-2026': { epub: 'https://...', pdf: 'https://...' }
const EBOOK_URLS = {
};

if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const api = new GhostAdminAPI({
  url: GHOST_API_URL,
  key: GHOST_ADMIN_KEY,
  version: 'v5.0',
});

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
  { key: 'issue',      label: null },            // issue block has no heading
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
  const cover = tag?.feature_image  || null;
  const desc  = tag?.description    || null;
  const count = tag?.count?.posts   || null;
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
  const postUrl = post.url;

  const titleLink = `<a href="${esc(postUrl)}" style="color:#1a1a1a;font-weight:600;text-decoration:none">${esc(post.title || 'Untitled')}</a>`;
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const now         = new Date();
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since       = windowStart.toISOString();

  console.log(`Querying posts published after ${since} …`);

  const rawPosts = await api.posts.browse({
    filter: `status:published+email_only:false+published_at:>'${since}'`,
    include: 'tags',
    limit: 'all',
  });

  // Post-filter: must be truly published (not scheduled), published_at must be
  // in the past, and must have a real canonical URL (not a /p/{uuid}/ preview).
  const PREVIEW_URL_RE = /\/p\/[0-9a-f-]{36}\//;
  const posts = rawPosts.filter(p =>
    p.status === 'published' &&
    new Date(p.published_at) <= now &&
    p.url &&
    !PREVIEW_URL_RE.test(p.url)
  );

  console.log(`Found ${rawPosts.length} post(s) in window, ${posts.length} publicly published.`);
  if (posts.length === 0) {
    console.log('Nothing to digest. Exiting.');
    return;
  }

  // Group by department
  const groups     = new Map();
  const seenIssues = new Set();

  for (const post of posts) {
    const dept = department(post);
    if (!dept) continue;

    if (dept.startsWith('issue:')) {
      const issueSlug = dept.slice('issue:'.length);
      if (seenIssues.has(issueSlug)) continue;
      seenIssues.add(issueSlug);
      if (!groups.has('issue')) groups.set('issue', []);
      groups.get('issue').push({ type: 'issue', slug: issueSlug });
    } else {
      if (!groups.has(dept)) groups.set(dept, []);
      groups.get(dept).push({ type: 'post', post });
    }
  }

  const orderedKeys = DEPT_ORDER.map(d => d.key).filter(k => groups.has(k));
  if (orderedKeys.length < 2) {
    console.log(`Only ${orderedKeys.length} section(s) — skipping.`);
    return;
  }

  // Fetch issue tag data (feature_image, description, count.posts)
  const issueTags = new Map();
  for (const slug of seenIssues) {
    try {
      const tag = await api.tags.read({ slug, include: 'count.posts' });
      issueTags.set(slug, tag);
    } catch (err) {
      console.warn(`Could not fetch tag ${slug}:`, err.message);
    }
  }

  // Feature image: issue cover first, then first post with one
  let featureImage = null;
  if (seenIssues.size > 0) {
    featureImage = issueTags.get([...seenIssues][0])?.feature_image || null;
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

  // Subject line: lead item + "and N more" when multiple sections
  const leadKey     = orderedKeys[0];
  const extraCount  = orderedKeys.length - 1;
  let emailSubject;
  if (leadKey === 'issue') {
    emailSubject = formatIssueTitle(groups.get('issue')[0].slug);
  } else {
    emailSubject = groups.get(leadKey)[0].post.title;
  }
  if (extraCount > 0) {
    emailSubject += ` — and ${extraCount} more`;
  }

  // Title (dated, for records)
  const fmt         = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const titleRange  = `${fmt(windowStart)}–${fmt(now).replace(/^\w+ /, '')}, ${now.getFullYear()}`;
  const digestTitle = `Inkhorn Review — Week of ${titleRange}`;

  console.log(`\nTitle:   ${digestTitle}`);
  console.log(`Subject: ${emailSubject}`);
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
    console.log('\n[DRY RUN] HTML:');
    console.log(digestHtml);
    return;
  }

  // Create draft
  console.log('\nCreating digest post as draft …');
  const draft = await api.posts.add({
    title:          digestTitle,
    email_subject:  emailSubject,
    html:           digestHtml,
    status:         'draft',
    email_only:     true,
    feature_image:  featureImage,
    tags:           [{ name: '#digest' }],
    visibility:     'members',
  }, { source: 'html' });

  console.log(`Draft created: ${draft.id}`);
  console.log(`Title:   ${draft.title}`);
  console.log(`Subject: ${draft.email_subject}`);

  if (PUBLISH_MODE === 'publish') {
    console.log('PUBLISH_MODE=publish — sending …');
    const newsletter = await getDigestNewsletter();
    await api.posts.edit({
      id:          draft.id,
      status:      'published',
      updated_at:  draft.updated_at,
      newsletter:  newsletter ? newsletter.slug : undefined,
    });
    console.log(`Sent via: ${newsletter?.slug || '(none found)'}`);
  } else {
    console.log('PUBLISH_MODE=draft — left as draft.');
  }
}

async function getDigestNewsletter() {
  try {
    const newsletters = await api.newsletters.browse({ limit: 'all' });
    return newsletters.find(n => /digest/i.test(n.name) && n.status === 'active') || null;
  } catch (err) {
    console.warn('Could not fetch newsletters:', err.message);
    return null;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
