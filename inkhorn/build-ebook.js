#!/usr/bin/env node
/**
 * Build a Vellum-ready .docx from an Inkhorn Review Ghost issue.
 * Uses the Ghost ADMIN API so it works on scheduled (pre-release) posts.
 *
 * Usage:
 *   INKHORN_ADMIN_API_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w) \
 *     node inkhorn/build-ebook.js <issue-slug> [--by-genre] [--status=published,scheduled]
 *
 * Output: inkhorn/build/<issue-slug>.docx — import into Vellum
 *
 * Paragraph styles in the output:
 *   Heading1          — piece title (Vellum chapter)
 *   Vellum Attribution — byline
 *   Vellum Verse       — one line of a poem (Vellum Verse element)
 *   Vellum Block Quote  — epigraph / block quote
 *   Normal            — prose body paragraph
 */

'use strict';

const crypto       = require('crypto');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const JSZip        = require('jszip');

// ── Args ──────────────────────────────────────────────────────────────────────

const rawArgs    = process.argv.slice(2);
const flags      = rawArgs.filter(a => a.startsWith('--'));
const posArgs    = rawArgs.filter(a => !a.startsWith('--'));
const slug       = posArgs[0];
const byGenre    = flags.includes('--by-genre');
const biosOnly   = flags.includes('--bios');
const statusFlag = (flags.find(f => f.startsWith('--status=')) || '--status=published,scheduled')
  .replace('--status=', '');

if (!slug) {
  console.error('Usage: INKHORN_ADMIN_API_KEY=... node inkhorn/build-ebook.js <issue-slug> [--by-genre] [--status=published,scheduled]');
  process.exit(1);
}

// ── Credentials & JWT ─────────────────────────────────────────────────────────

const ADMIN_KEY = process.env.INKHORN_ADMIN_API_KEY;
if (!ADMIN_KEY || !ADMIN_KEY.includes(':')) {
  console.error('INKHORN_ADMIN_API_KEY is not set or is not in id:secret format.');
  console.error('  export INKHORN_ADMIN_API_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w)');
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

function makeJWT(adminKey) {
  const [id, hexSecret] = adminKey.split(':');
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid: id, typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sigKey  = Buffer.from(hexSecret, 'hex');
  const sig     = crypto.createHmac('sha256', sigKey).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function adminHeaders() {
  return { Authorization: `Ghost ${makeJWT(ADMIN_KEY)}` };
}

// ── Admin API fetches ─────────────────────────────────────────────────────────

async function fetchTag(tagSlug) {
  const url = `${GHOST_URL}/ghost/api/admin/tags/slug/${encodeURIComponent(tagSlug)}/`;
  const res = await fetch(url, { headers: adminHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch tag "${tagSlug}": HTTP ${res.status}`);
  const data = await res.json();
  if (!data.tags || !data.tags[0]) throw new Error(`Tag not found: ${tagSlug}`);
  return data.tags[0];
}

async function fetchTagById(tagId) {
  const url = `${GHOST_URL}/ghost/api/admin/tags/${encodeURIComponent(tagId)}/`;
  const res = await fetch(url, { headers: adminHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch tag id "${tagId}": HTTP ${res.status}`);
  const data = await res.json();
  if (!data.tags || !data.tags[0]) throw new Error(`Tag not found: ${tagId}`);
  return data.tags[0];
}

async function fetchPosts(tagSlug, statuses) {
  const statusFilter = statuses.length === 1
    ? `status:${statuses[0]}`
    : `status:[${statuses.join(',')}]`;
  const params = new URLSearchParams({
    filter:  `tag:${tagSlug}+${statusFilter}`,
    include: 'tags',
    order:   'published_at asc',
    limit:   'all',
    formats: 'html',
  });
  const url = `${GHOST_URL}/ghost/api/admin/posts/?${params}`;
  const res = await fetch(url, { headers: adminHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch posts: HTTP ${res.status}`);
  const data = await res.json();
  return data.posts || [];
}

/**
 * Collect contributor tags from posts and fetch their full data (with description).
 * Contributor tag is at index 2 — after the issue tag (index 0) and genre tag (index 1).
 * Returns { tags: Tag[], skipped: string[] } where skipped are names with empty descriptions.
 */
async function fetchContributorTags(posts, issueSlug) {
  const SKIP_SLUGS = new Set([issueSlug, 'poetry', 'fiction', 'nonfiction']);
  const seen = new Map(); // id → shallow tag from post

  for (const post of posts) {
    for (const ctag of post.tags || []) {
      if (!SKIP_SLUGS.has(ctag.slug) && !seen.has(ctag.id)) {
        seen.set(ctag.id, ctag);
      }
    }
  }

  // Fetch full tag objects (description may not be sideloaded on posts)
  const full = await Promise.all([...seen.keys()].map(id => fetchTagById(id)));

  const tags    = full.filter(t => t.description && t.description.trim());
  const skipped = full.filter(t => !t.description || !t.description.trim()).map(t => t.name);

  // Sort alphabetically by last word of name
  tags.sort((a, b) => {
    const lastWord = name => name.trim().split(/\s+/).pop().toLowerCase();
    return lastWord(a.name).localeCompare(lastWord(b.name));
  });

  return { tags, skipped };
}

// ── Genre helpers ─────────────────────────────────────────────────────────────

const GENRE_SLUGS = new Set(['poetry', 'fiction', 'nonfiction']);
const GENRE_ORDER = ['Poetry', 'Fiction', 'Nonfiction'];

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
  for (const [k, v] of groups) if (v.length === 0) groups.delete(k);
  return groups;
}

// ── OOXML / XML helpers ───────────────────────────────────────────────────────

/** Escape a string for XML character data / attribute values. */
function xe(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Decode common HTML entities to plain Unicode. */
function de(s) {
  return (s || '')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g,      (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/**
 * Parse inline HTML into run descriptors.
 * Returns [{text, bold, italic, sup, sub}] or [{br:true}] for line-break elements.
 * Limitation: formatting that spans a <br> boundary will lose state on the far side.
 */
function parseInline(html) {
  const runs = [];
  let bold = 0, italic = 0, sup = 0, sub = 0;
  const parts = html.split(/(<[^>]*>)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('<')) {
      const isClose = part.startsWith('</');
      const tag = part.slice(isClose ? 2 : 1).replace(/[\s>\/].*/, '').toLowerCase();
      const d   = isClose ? -1 : 1;
      if      (tag === 'strong' || tag === 'b') bold = Math.max(0, bold + d);
      else if (tag === 'em'    || tag === 'i') italic = Math.max(0, italic + d);
      else if (tag === 'sup')                  sup  = Math.max(0, sup  + d);
      else if (tag === 'sub')                  sub  = Math.max(0, sub  + d);
      else if (tag === 'br')                   runs.push({ br: true });
      // a, span, code, mark, etc.: swallow the tag, keep text
    } else {
      const text = de(part);
      if (text) runs.push({ text, bold: bold > 0, italic: italic > 0, sup: sup > 0, sub: sub > 0 });
    }
  }
  return runs;
}

/**
 * Parse plain-text bio with *asterisk* italic markers into run descriptors.
 * Asterisks must be balanced; odd-positioned segments are italic.
 */
function parseBioAsterisks(text) {
  const runs = [];
  const segments = text.split('*');
  for (let i = 0; i < segments.length; i++) {
    if (segments[i]) {
      runs.push({ text: segments[i], bold: false, italic: i % 2 === 1, sup: false, sub: false });
    }
  }
  return runs;
}

/** Build a <w:r> element from a run descriptor. */
function runXml(run) {
  if (run.br) return '<w:r><w:br/></w:r>';
  let rPr = '';
  if (run.bold)   rPr += '<w:b/><w:bCs/>';
  if (run.italic) rPr += '<w:i/><w:iCs/>';
  if (run.sup)    rPr += '<w:vertAlign w:val="superscript"/>';
  if (run.sub)    rPr += '<w:vertAlign w:val="subscript"/>';
  const rPrXml = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
  // Word requires xml:space="preserve" when text has leading/trailing whitespace
  const attr = /^\s|\s$/.test(run.text) ? ' xml:space="preserve"' : '';
  return `<w:r>${rPrXml}<w:t${attr}>${xe(run.text)}</w:t></w:r>`;
}

/** Build a <w:p> element. styleId may be null for Normal. align: 'left'|'right'|'center' */
function paraXml(styleId, runs, { pageBreakBefore = false, align = null } = {}) {
  let pPrInner = '';
  if (styleId)         pPrInner += `<w:pStyle w:val="${styleId}"/>`;
  if (pageBreakBefore) pPrInner += '<w:pageBreakBefore/>';
  if (align)           pPrInner += `<w:jc w:val="${align}"/>`;
  const pPrXml = pPrInner ? `<w:pPr>${pPrInner}</w:pPr>` : '';
  const runsXml = (runs || []).map(runXml).join('');
  return `<w:p>${pPrXml}${runsXml}</w:p>`;
}

/** <w:p> with only a style and no runs (stanza break, empty prose para, etc.) */
function emptyParaXml(styleId) {
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr></w:p>`;
}

/** A standalone page-break paragraph (sits immediately before an h1). */
function pageBreakParaXml() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

// ── HTML block tokenizer ──────────────────────────────────────────────────────

/**
 * Break block-level Ghost HTML into tokens.
 * Returns [{type:'p'|'blockquote'|'pre'|'hr', content:string}]
 *
 * Ghost generates clean, non-nested <p> tags. <blockquote> may contain <p>.
 * Anything else (figure, div, h1-h6, ul/ol/li) is skipped — not expected in
 * Inkhorn prose or poetry bodies.
 */
function tokenizeBlocks(html) {
  const tokens = [];
  let pos = 0;
  const n = html.length;

  while (pos < n) {
    // Skip whitespace
    if (/\s/.test(html[pos])) { pos++; continue; }
    if (html[pos] !== '<')    { pos++; continue; }

    // Self-closing <hr>
    const hrM = html.slice(pos).match(/^<hr\s*\/?>/i);
    if (hrM) { tokens.push({ type: 'hr' }); pos += hrM[0].length; continue; }

    // Opening block tag
    const openM = html.slice(pos).match(/^<(pre|blockquote|p)([^>]*)>/i);
    if (!openM) { pos++; continue; }

    const tagName  = openM[1].toLowerCase();
    const openLen  = openM[0].length;
    const closeTag = `</${tagName}>`;

    // Find the matching close tag, accounting for nesting in blockquote
    let depth = 1;
    let search = pos + openLen;
    let contentEnd = -1;

    while (depth > 0 && search < n) {
      const nextOpen  = html.indexOf(`<${tagName}`,  search);
      const nextClose = html.indexOf(closeTag, search);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        search = nextOpen + tagName.length + 1;
      } else {
        depth--;
        if (depth === 0) contentEnd = nextClose;
        else search = nextClose + closeTag.length;
      }
    }

    if (contentEnd === -1) { pos += openLen; continue; }

    tokens.push({ type: tagName, content: html.slice(pos + openLen, contentEnd) });
    pos = contentEnd + closeTag.length;
  }

  return tokens;
}

// ── Post HTML → OOXML paragraph arrays ───────────────────────────────────────

/**
 * Convert the HTML of a poetry post to OOXML paragraphs.
 *
 * Markup rules (no heuristics):
 *   <blockquote>…</blockquote>     → Vellum Block Quote (epigraph set in Ghost editor)
 *   <pre><code>…</code></pre>      → Vellum Block Quote (epigraph arriving as code block)
 *   <p>line1<br>\nline2</p>        → Vellum Verse, one paragraph per line
 *   <p></p>                        → empty Vellum Verse (stanza break)
 *   anything else                  → ignored
 *
 * Whitespace: leading HTML newlines/tabs after a <br> are HTML formatting noise and
 * stripped. Leading spaces are intentional indentation and kept. Runs of 2+ consecutive
 * spaces become the same count of non-breaking spaces so Word/Vellum preserve them.
 */
function poetryPostParas(html) {
  const paras = [];
  const tokens = tokenizeBlocks(html);

  for (const tok of tokens) {
    if (tok.type === 'blockquote') {
      // Epigraph (marked with Ghost's blockquote): flatten inner <p>, emit as one paragraph
      const flat = tok.content.replace(/<\/?p[^>]*>/gi, ' ').trim();
      if (flat) paras.push(paraXml('Vellum Block Quote', parseInline(flat)));
    } else if (tok.type === 'pre') {
      // Epigraph arriving as code block: one Vellum Block Quote line per non-empty line
      const text = de(tok.content.replace(/<[^>]+>/g, ''));
      for (const line of text.split('\n')) {
        if (line.trim()) paras.push(paraXml('Vellum Block Quote', parseInline(line.trim())));
      }
    } else if (tok.type === 'p') {
      const inner = tok.content.trim();
      if (!inner) {
        paras.push(emptyParaXml('Vellum Verse'));
      } else {
        for (const frag of inner.split(/<br\s*\/?>/i)) {
          // Strip leading newlines/tabs (HTML line-wrap noise) but keep leading spaces
          // (intentional indentation). Strip trailing whitespace. Convert runs of 2+
          // spaces to non-breaking spaces so Word preserves the indentation.
          const line = frag.replace(/^[\n\r\t]+/, '').replace(/[ \t]*$/, '');
          if (!line.trim()) continue;
          const t = line.replace(/ {2,}/g, m => '\u00a0'.repeat(m.length));
          paras.push(paraXml('Vellum Verse', parseInline(t)));
        }
      }
    }
    // Other block types in poetry: ignored
  }

  // Drop leading / trailing stanza-break placeholders
  const EMPTY_VERSE = emptyParaXml('Vellum Verse');
  while (paras.length && paras[0]               === EMPTY_VERSE) paras.shift();
  while (paras.length && paras[paras.length - 1] === EMPTY_VERSE) paras.pop();

  return paras;
}

/**
 * Convert the HTML of a prose post to OOXML paragraphs.
 *
 * Ghost prose structure:
 *   <p>…</p>            → Normal
 *   <blockquote>…</blockquote> → Vellum Block Quote
 *   <pre><code>…</code></pre>  → Vellum Block Quote
 *   <hr>                → empty Normal (section break)
 */
function prosePostParas(html) {
  const paras = [];
  const tokens = tokenizeBlocks(html);

  for (const tok of tokens) {
    if (tok.type === 'p') {
      const inner = tok.content.trim();
      if (!inner) continue;
      paras.push(paraXml(null, parseInline(inner)));
    } else if (tok.type === 'blockquote') {
      // Flatten any inner <p> tags, then parse as one block
      const flat = tok.content.replace(/<\/?p[^>]*>/gi, ' ').trim();
      if (flat) paras.push(paraXml('Vellum Block Quote', parseInline(flat)));
    } else if (tok.type === 'pre') {
      const text = de(tok.content.replace(/<[^>]+>/g, ''));
      for (const line of text.split('\n')) {
        if (line.trim()) {
          paras.push(paraXml('Vellum Block Quote',
            [{ text: line.trim(), bold: false, italic: false, sup: false, sub: false }]));
        }
      }
    } else if (tok.type === 'hr') {
      paras.push(emptyParaXml('Normal'));
    }
  }

  return paras;
}

// ── Document body ─────────────────────────────────────────────────────────────

function buildBodyXml(tag, posts, byGenre, contributorTags) {
  const parts = [];

  // Front matter — issue title and description, no contents page
  parts.push(paraXml('Heading1',
    [{ text: tag.name, bold: false, italic: false, sup: false, sub: false }]));
  if (tag.description) {
    parts.push(paraXml(null,
      [{ text: tag.description, bold: false, italic: false, sup: false, sub: false }]));
  }

  const emitPiece = (post, needsPageBreak) => {
    if (needsPageBreak) parts.push(pageBreakParaXml());

    parts.push(paraXml('Heading1',
      [{ text: post.title, bold: false, italic: false, sup: false, sub: false }]));

    if (post.custom_excerpt) {
      parts.push(paraXml('Heading2',
        [{ text: post.custom_excerpt, bold: false, italic: false, sup: false, sub: false }]));
    }

    const isPoetry = genreOf(post) === 'Poetry';
    const contentParas = isPoetry
      ? poetryPostParas(post.html || '')
      : prosePostParas(post.html || '');
    parts.push(...contentParas);
  };

  if (byGenre) {
    for (const [genre, gPosts] of groupByGenre(posts)) {
      parts.push(pageBreakParaXml());
      parts.push(paraXml('Heading1',
        [{ text: genre, bold: false, italic: false, sup: false, sub: false }]));
      for (const p of gPosts) emitPiece(p, true);
    }
  } else {
    let first = true;
    for (const post of posts) {
      emitPiece(post, !first);
      first = false;
    }
  }

  // Back matter — Contributors
  if (contributorTags && contributorTags.length > 0) {
    parts.push(pageBreakParaXml());
    parts.push(paraXml('Heading1',
      [{ text: 'Contributors', bold: false, italic: false, sup: false, sub: false }]));

    for (const ctag of contributorTags) {
      // Run-in bold name followed by the bio in the same Normal paragraph.
      // Bio may contain *text* markers for italics (used for book titles).
      const bio = (ctag.description || '').trim();
      const bioRuns = parseBioAsterisks(' ' + bio);
      parts.push(paraXml(null, [
        { text: ctag.name, bold: true, italic: false, sup: false, sub: false },
        ...bioRuns,
      ]));
    }
  }

  return parts.join('\n');
}

// ── styles.xml ────────────────────────────────────────────────────────────────

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="160" w:line="276" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="24"/><w:szCs w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:outlineLvl w:val="0"/>
      <w:spacing w:before="480" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:b/><w:bCs/>
      <w:sz w:val="32"/><w:szCs w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:outlineLvl w:val="1"/>
      <w:spacing w:before="240" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:i/><w:iCs/>
      <w:sz w:val="28"/><w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Vellum Verse">
    <w:name w:val="Vellum Verse"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>
      <w:ind w:left="720"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="24"/><w:szCs w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Vellum Attribution">
    <w:name w:val="Vellum Attribution"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="right"/>
      <w:spacing w:before="0" w:after="240"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Vellum Block Quote">
    <w:name w:val="Vellum Block Quote"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="720" w:right="720"/>
      <w:spacing w:before="120" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:i/><w:iCs/>
    </w:rPr>
  </w:style>
</w:styles>`;
}

// ── docx assembler ────────────────────────────────────────────────────────────

function buildDocx(tag, posts, byGenre, contributorTags) {
  const bodyXml = buildBodyXml(tag, posts, byGenre, contributorTags);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`;

  const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels',         relsXml);
  zip.file('word/document.xml',   documentXml);
  zip.file('word/styles.xml',     stylesXml());
  zip.file('word/_rels/document.xml.rels', wordRelsXml);

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Diagnostic summary ────────────────────────────────────────────────────────

function showDiagnostic(posts) {
  const poem  = posts.find(p => genreOf(p) === 'Poetry');
  const prose = posts.find(p => genreOf(p) !== 'Poetry');

  const summarise = (post) => {
    const isPoetry = genreOf(post) === 'Poetry';
    const tokens = tokenizeBlocks(post.html || '');
    const lines = [];

    if (post.custom_excerpt) lines.push(`  [Heading2          ]  ${post.custom_excerpt}`);

    if (isPoetry) {
      for (const tok of tokens) {
        if (tok.type === 'pre') {
          const t = de(tok.content.replace(/<[^>]+>/g, '')).trim().split('\n')[0];
          lines.push(`  [Vellum Block Quote  ]  ${t.slice(0, 70)}`);
        } else if (tok.type === 'p') {
          const inner = tok.content.trim();
          if (!inner) {
            lines.push('  [Vellum Verse       ]  (stanza break)');
          } else {
            for (const frag of inner.split(/<br\s*\/?>/i)) {
              const t = de(frag.replace(/<[^>]+>/g, '')).trim();
              if (t) lines.push(`  [Vellum Verse       ]  ${t.slice(0, 70)}`);
            }
          }
        }
      }
    } else {
      for (const tok of tokens) {
        const raw = de(tok.content ? tok.content.replace(/<[^>]+>/g, '') : '').trim();
        if (tok.type === 'p' && raw) {
          lines.push(`  [Normal            ]  ${raw.slice(0, 70)}`);
        } else if (tok.type === 'blockquote' && raw) {
          lines.push(`  [Vellum Block Quote  ]  ${raw.slice(0, 70)}`);
        } else if (tok.type === 'hr') {
          lines.push('  [Normal            ]  (section break)');
        }
      }
    }
    return lines;
  };

  if (poem) {
    const lines = summarise(poem);
    console.log(`\n── ${poem.title} (Poetry) — ${lines.length} paragraphs ──`);
    lines.slice(0, 14).forEach(l => console.log(l));
    if (lines.length > 14) console.log(`  … ${lines.length - 14} more`);
  }

  if (prose) {
    const lines = summarise(prose);
    console.log(`\n── ${prose.title} (${genreOf(prose)}) — ${lines.length} paragraphs ──`);
    lines.slice(0, 8).forEach(l => console.log(l));
    if (lines.length > 8) console.log(`  … ${lines.length - 8} more`);
  }

  console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const statuses = statusFlag.split(',').map(s => s.trim()).filter(Boolean);

  // ── --bios mode: print all contributor bios and exit ──────────────────────
  if (biosOnly) {
    const posts = await fetchPosts(slug, statuses);
    const SKIP_SLUGS = new Set([slug, 'poetry', 'fiction', 'nonfiction']);
    const seen = new Map();
    for (const post of posts) {
      for (const ctag of post.tags || []) {
        if (!SKIP_SLUGS.has(ctag.slug) && !seen.has(ctag.id)) seen.set(ctag.id, ctag);
      }
    }
    const full = await Promise.all([...seen.keys()].map(id => fetchTagById(id)));
    full.sort((a, b) => {
      const last = name => name.trim().split(/\s+/).pop().toLowerCase();
      return last(a.name).localeCompare(last(b.name));
    });
    for (const t of full) {
      const bio = (t.description || '').trim();
      console.log('---');
      console.log(`TAG NAME: ${t.name}`);
      console.log(`SLUG: ${t.slug}`);
      console.log(`LENGTH: ${bio.length}`);
      console.log(`BIO: ${bio || 'EMPTY'}`);
    }
    return;
  }

  // ── Normal ebook build ─────────────────────────────────────────────────────
  console.log(`Building ebook: ${slug}${byGenre ? '  (by genre)' : ''}  [status: ${statuses.join(', ')}]\n`);

  const [tag, posts] = await Promise.all([fetchTag(slug), fetchPosts(slug, statuses)]);

  console.log(`Issue:  ${tag.name}`);
  console.log(`Posts:  ${posts.length}\n`);

  const { tags: contributorTags, skipped: skippedContributors } =
    await fetchContributorTags(posts, slug);

  console.log(`Contributors: ${contributorTags.length} with bios`);
  if (skippedContributors.length) {
    console.log(`\n⚠  Skipped (no bio in Ghost tag description):`);
    for (const name of skippedContributors) console.log(`     ${name}`);
  }
  console.log('');

  const scheduledCount = posts.filter(p => p.status === 'scheduled').length;
  if (scheduledCount > 0) {
    console.log(`⚠  ${scheduledCount} post(s) are still scheduled — this is a pre-release build.\n`);
  }

  posts.forEach((p, i) => {
    const status = p.status === 'scheduled' ? ' [scheduled]' : '';
    console.log(`  ${String(i + 1).padStart(2)}  [${genreOf(p).padEnd(10)}]  ${p.title}${status}`);
  });

  showDiagnostic(posts);

  const buildDir = path.join(__dirname, 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  const docxOut = path.join(buildDir, `${slug}.docx`);
  const docxBuf = buildDocx(tag, posts, byGenre, contributorTags);
  fs.writeFileSync(docxOut, docxBuf);

  console.log(`DOCX → ${docxOut}`);
  console.log('Done.');
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
