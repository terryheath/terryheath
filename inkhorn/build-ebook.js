#!/usr/bin/env node
/**
 * Build a Vellum-ready .docx from an Inkhorn Review Ghost issue.
 *
 * Usage:
 *   INKHORN_CONTENT_API_KEY=$(security find-generic-password -s "ghost-content-inkhorn" -w) \
 *     node inkhorn/build-ebook.js <issue-slug> [--by-genre]
 *
 * Examples:
 *   node inkhorn/build-ebook.js september-2026
 *   node inkhorn/build-ebook.js september-2026 --by-genre
 *
 * Output:
 *   inkhorn/build/<issue-slug>.docx  — import this into Vellum
 *   inkhorn/build/<issue-slug>.html  — intermediate; inspect to verify line breaks
 *
 * Requires: pandoc (brew install pandoc)
 * API key:  macOS Keychain, service name "ghost-content-inkhorn"
 *           Ghost URL: service name "ghost-url-inkhorn"
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Args ──────────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const flags   = new Set(rawArgs.filter(a => a.startsWith('--')));
const args    = rawArgs.filter(a => !a.startsWith('--'));
const slug    = args[0];
const byGenre = flags.has('--by-genre');

if (!slug) {
  console.error('Usage: INKHORN_CONTENT_API_KEY=... node inkhorn/build-ebook.js <issue-slug> [--by-genre]');
  console.error('');
  console.error('  INKHORN_CONTENT_API_KEY=$(security find-generic-password -s "ghost-content-inkhorn" -w) \\');
  console.error('    node inkhorn/build-ebook.js september-2026');
  process.exit(1);
}

// ── Credentials ───────────────────────────────────────────────────────────────

const API_KEY = process.env.INKHORN_CONTENT_API_KEY;
if (!API_KEY) {
  console.error('INKHORN_CONTENT_API_KEY is not set.');
  console.error('  export INKHORN_CONTENT_API_KEY=$(security find-generic-password -s "ghost-content-inkhorn" -w)');
  process.exit(1);
}

function getKeychain(service) {
  try {
    return execSync(`security find-generic-password -s "${service}" -w`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim();
  } catch {
    console.error(`Keychain entry not found: ${service}`);
    process.exit(1);
  }
}

const GHOST_URL = getKeychain('ghost-url-inkhorn').replace(/\/$/, '');

// ── Ghost Content API ─────────────────────────────────────────────────────────

async function fetchTag(tagSlug) {
  const url = `${GHOST_URL}/ghost/api/content/tags/slug/${encodeURIComponent(tagSlug)}/?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch tag "${tagSlug}": HTTP ${res.status}`);
  const data = await res.json();
  if (!data.tags || !data.tags[0]) throw new Error(`Tag not found: ${tagSlug}`);
  return data.tags[0];
}

async function fetchPosts(tagSlug) {
  const params = new URLSearchParams({
    key:     API_KEY,
    filter:  `tag:${tagSlug}`,
    include: 'tags',
    order:   'published_at asc',
    limit:   'all',
    formats: 'html',
  });
  const url = `${GHOST_URL}/ghost/api/content/posts/?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch posts: HTTP ${res.status}`);
  const data = await res.json();
  return data.posts || [];
}

// ── HTML builder ──────────────────────────────────────────────────────────────

const GENRE_SLUGS = new Set(['poetry', 'fiction', 'nonfiction']);
const GENRE_ORDER = ['Poetry', 'Fiction', 'Nonfiction'];

/** Escape plain text for HTML. Never use on post.html — it's already HTML. */
function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Page break recognised by pandoc when converting HTML → docx.
 * The div is empty so it carries no content — just a break signal.
 */
function pageBreak() {
  return '<div style="page-break-after: always;"></div>';
}

function genreOf(post) {
  const tag = (post.tags || []).find(t => GENRE_SLUGS.has(t.slug));
  if (!tag) return 'Other';
  return tag.name.charAt(0).toUpperCase() + tag.name.slice(1);
}

function groupByGenre(posts) {
  const groups = new Map(GENRE_ORDER.map(g => [g, []]));
  for (const post of posts) {
    const g = genreOf(post);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(post);
  }
  for (const [k, v] of groups) {
    if (v.length === 0) groups.delete(k);
  }
  return groups;
}

function contentsBlock(posts, byGenre) {
  const lines = ['<p><strong>Contents</strong></p>', '<p>'];
  if (byGenre) {
    for (const [genre, gPosts] of groupByGenre(posts)) {
      lines.push(`<strong>${esc(genre)}</strong><br>`);
      for (const post of gPosts) {
        const bl = post.custom_excerpt ? ` \u2014 ${esc(post.custom_excerpt)}` : '';
        lines.push(`${esc(post.title)}${bl}<br>`);
      }
    }
  } else {
    for (const post of posts) {
      const bl = post.custom_excerpt ? ` \u2014 ${esc(post.custom_excerpt)}` : '';
      lines.push(`${esc(post.title)}${bl}<br>`);
    }
  }
  lines.push('</p>');
  return lines.join('\n');
}

/**
 * Render one piece. headingLevel: 1 (default) or 2 (by-genre mode).
 *
 * post.html is Ghost-rendered HTML and is inserted raw — do NOT escape it.
 * <br> tags inside it survive into the docx as line breaks, which is
 * essential for poems.
 */
function pieceBlock(post, headingLevel) {
  const h = `h${headingLevel}`;
  const parts = [`<${h}>${esc(post.title)}</${h}>`];
  if (post.custom_excerpt) {
    parts.push(`<p>${esc(post.custom_excerpt)}</p>`);
  }
  parts.push(post.html || '');
  return parts.join('\n');
}

function buildHTML(tag, posts, byGenre) {
  const out = [];

  out.push(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(tag.name)}</title>
</head>
<body>`);

  // ── Front matter ────────────────────────────────────────────────────────────
  out.push(`<h1>${esc(tag.name)}</h1>`);
  if (tag.description) out.push(`<p>${esc(tag.description)}</p>`);
  out.push(contentsBlock(posts, byGenre));
  out.push(pageBreak());

  // ── Pieces ──────────────────────────────────────────────────────────────────
  if (byGenre) {
    for (const [genre, gPosts] of groupByGenre(posts)) {
      out.push(`<h1>${esc(genre)}</h1>`);
      for (const post of gPosts) {
        out.push(pieceBlock(post, 2));
        out.push(pageBreak());
      }
    }
  } else {
    for (const post of posts) {
      out.push(pieceBlock(post, 1));
      out.push(pageBreak());
    }
  }

  out.push('</body>\n</html>');
  return out.join('\n\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Building ebook: ${slug}${byGenre ? '  (by genre)' : ''}\n`);

  const [tag, posts] = await Promise.all([fetchTag(slug), fetchPosts(slug)]);

  console.log(`Issue:  ${tag.name}`);
  console.log(`Posts:  ${posts.length}\n`);
  posts.forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  [${genreOf(p).padEnd(10)}]  ${p.title}`);
  });
  console.log('');

  const html = buildHTML(tag, posts, byGenre);

  const buildDir = path.join(__dirname, 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  const htmlOut = path.join(buildDir, `${slug}.html`);
  const docxOut = path.join(buildDir, `${slug}.docx`);

  fs.writeFileSync(htmlOut, html, 'utf8');
  console.log(`HTML → ${htmlOut}`);

  try {
    execSync(`pandoc "${htmlOut}" -o "${docxOut}" --from=html --to=docx`, { stdio: 'inherit' });
  } catch {
    console.error('\npandoc failed. Install it with: brew install pandoc');
    process.exit(1);
  }

  console.log(`DOCX → ${docxOut}`);
  console.log('\nDone.');
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
