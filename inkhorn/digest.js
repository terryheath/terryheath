#!/usr/bin/env node
// inkhorn/digest.js — Inkhorn Review weekly digest generator
//
// Queries Ghost for posts published in the last 7 days, groups them by
// department, and composes a digest post.
//
// PUBLISH_MODE (from env var PUBLISH_MODE):
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

if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const api = new GhostAdminAPI({
  url: GHOST_API_URL,
  key: GHOST_ADMIN_KEY,
  version: 'v5.0',
});

// ── Season/year tag detection ─────────────────────────────────────────────────

const SEASONS = ['autumn', 'winter', 'spring', 'summer'];
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
// Returns the department key for a post, based on primary_tag slug.

function department(post) {
  const pt = post.primary_tag?.slug || '';
  if (isIssueTag(pt)) return 'issue:' + pt;
  if (pt === 'poetry')    return 'poetry';
  if (pt === 'fiction')   return 'fiction';
  if (pt === 'nonfiction') return 'nonfiction';
  if (pt === 'micro')     return 'micro';
  if (pt === 'podcast')   return 'podcast';
  if (pt === 'art')       return 'art';
  if (pt === 'letter')    return 'letter';
  return 'other';
}

// Department display order and labels.
const DEPT_ORDER = [
  { key: 'issue',       label: 'New Issue' },
  { key: 'fiction',     label: 'Fiction' },
  { key: 'nonfiction',  label: 'Nonfiction' },
  { key: 'poetry',      label: 'Poetry' },
  { key: 'micro',       label: 'Micro' },
  { key: 'art',         label: 'Art' },
  { key: 'letter',      label: 'Letter from the Editor' },
  { key: 'podcast',     label: 'Podcast' },
  { key: 'other',       label: 'From the Site' },
];

// ── HTML builders ─────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function issueCard(slug) {
  const title = formatIssueTitle(slug);
  const publicUrl = `${SITE_URL}/${slug}/`;
  return `<p><strong><a href="${esc(publicUrl)}">${esc(title)}</a></strong> — Read the full issue.</p>`;
}

function postCard(post, opts = {}) {
  const title = esc(post.title || 'Untitled');
  const slug = post.slug;
  // Try to get the issue-scoped URL for the post
  const issueTags = (post.tags || []).filter(t => isIssueTag(t.slug));
  const issueSlug = issueTags.length > 0 ? issueTags[0].slug : null;
  const postUrl = issueSlug
    ? `${SITE_URL}/${issueSlug}/${slug}/`
    : `${SITE_URL}/p/${slug}/`;

  const excerpt = post.custom_excerpt ? `<br><em>${esc(post.custom_excerpt)}</em>` : '';
  const thumb = opts.thumb && post.feature_image
    ? `<img src="${esc(post.feature_image)}" width="72" height="72" style="float:left;margin:0 12px 4px 0;object-fit:cover;border-radius:4px;" alt="">`
    : '';
  const clear = opts.thumb && post.feature_image ? '<br style="clear:both">' : '';
  return `${thumb}<p><a href="${esc(postUrl)}">${title}</a>${excerpt}</p>${clear}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 7-day window ending now
  const now = new Date();
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since = windowStart.toISOString();

  console.log(`Querying posts published after ${since} …`);

  const posts = await api.posts.browse({
    filter: `status:published+email_only:false+published_at:>'${since}'`,
    include: 'tags',
    fields: 'id,title,slug,custom_excerpt,feature_image,primary_tag,published_at',
    limit: 'all',
  });

  console.log(`Found ${posts.length} post(s).`);

  if (posts.length === 0) {
    console.log('Nothing to digest. Exiting.');
    return;
  }

  // Group by department. Issue-tagged posts collapse to one entry per issue slug.
  const groups = new Map(); // key → { label, items }
  const seenIssues = new Set();

  for (const post of posts) {
    const dept = department(post);
    if (dept.startsWith('issue:')) {
      const issueSlug = dept.slice('issue:'.length);
      if (seenIssues.has(issueSlug)) continue; // already have this issue
      seenIssues.add(issueSlug);
      if (!groups.has('issue')) groups.set('issue', { label: 'New Issue', items: [] });
      groups.get('issue').items.push({ type: 'issue', slug: issueSlug });
    } else {
      if (!groups.has(dept)) {
        const meta = DEPT_ORDER.find(d => d.key === dept) || { label: dept };
        groups.set(dept, { label: meta.label, items: [] });
      }
      groups.get(dept).items.push({ type: 'post', post });
    }
  }

  // Count how many distinct sections we have
  const sectionCount = groups.size;
  if (sectionCount < 2) {
    console.log(`Only ${sectionCount} section(s) — not enough for a digest. Exiting.`);
    return;
  }

  // Build HTML in display order
  const sections = [];
  for (const { key, label } of DEPT_ORDER) {
    const group = groups.get(key);
    if (!group) continue;
    let html = `<h2>${esc(label)}</h2>\n`;
    for (const item of group.items) {
      if (item.type === 'issue') {
        html += issueCard(item.slug) + '\n';
      } else {
        const useThumb = (key === 'podcast' || key === 'art');
        html += postCard(item.post, { thumb: useThumb }) + '\n';
      }
    }
    sections.push(html);
  }

  // Also emit any 'other' group
  const otherGroup = groups.get('other');
  if (otherGroup) {
    let html = `<h2>${esc(otherGroup.label)}</h2>\n`;
    for (const item of otherGroup.items) {
      html += postCard(item.post) + '\n';
    }
    sections.push(html);
  }

  const body = sections.join('\n');
  const digestHtml = `<!--kg-card-begin: html-->\n${body}\n<!--kg-card-end: html-->`;

  // Format date range for title: "Sep 1–7, 2026"
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const titleRange = `${fmt(windowStart)}–${fmt(now).replace(/^\w+ /, '')}, ${now.getFullYear()}`;
  const digestTitle = `Inkhorn Review — Week of ${titleRange}`;

  console.log(`\nDigest title: ${digestTitle}`);
  console.log(`Sections: ${[...groups.keys()].join(', ')}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would create post:');
    console.log(digestHtml);
    return;
  }

  // Create the post as draft
  console.log('\nCreating digest post as draft …');
  const draft = await api.posts.add({
    title: digestTitle,
    html: digestHtml,
    status: 'draft',
    email_only: true,
    tags: [{ name: '#digest' }],
    visibility: 'members',
  }, { source: 'html' });

  console.log(`Draft created: ${draft.id} — ${draft.title}`);

  if (PUBLISH_MODE === 'publish') {
    console.log('PUBLISH_MODE=publish — sending digest …');
    const newsletter = await getDigestNewsletter();
    await api.posts.edit({
      id: draft.id,
      status: 'published',
      updated_at: draft.updated_at,
      newsletter: newsletter ? newsletter.slug : undefined,
    });
    console.log(`Published and sent via newsletter: ${newsletter?.slug || '(none found)'}`);
  } else {
    console.log('PUBLISH_MODE=draft — leaving as draft. Switch setting to publish when ready.');
  }
}

async function getDigestNewsletter() {
  try {
    const newsletters = await api.newsletters.browse({ limit: 'all' });
    // Look for digest newsletter by name
    const match = newsletters.find(n =>
      /digest/i.test(n.name) && n.status === 'active'
    );
    return match || null;
  } catch (err) {
    console.warn('Could not fetch newsletters:', err.message);
    return null;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
