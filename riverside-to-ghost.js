#!/usr/bin/env node
/**
 * Riverside RSS -> Ghost. Creates one post per new episode.
 *
 * Designed to run unattended on a schedule.
 *
 * Required env:
 *   GHOST_API_URL      https://silky-mushroom.pikapod.net
 *   GHOST_ADMIN_KEY    the "id:secret" Admin API key
 *
 * Optional env:
 *   FEED_URL           default: the Life on Words feed
 *   BOOKSHOP_ID        Bookshop.org affiliate id (94291)
 *   ISBNDB_KEY         ISBNdb API key; checked first for book metadata
 *   HEADSHOT_DIR       default: ./headshots
 *   POST_STATUS        "draft" or "published"   (default: draft)
 *   NEWSLETTER_SLUG    Ghost newsletter slug to email on publish.
 *                      Omit to publish without sending.
 *   MAX_AGE_DAYS       skip episodes older than this (default: 14)
 *   DRY_RUN            "1" = log what would happen, change nothing
 *   INCLUDE_TRAILER    "1" to include the trailer
 *
 * Dedupe is on the RSS guid, stored two ways:
 *   1. Hidden internal tag (#rs-<guid>) on the Ghost post.
 *   2. imported-guids.json in the repo root (published episodes only).
 * A guid in either source is treated as done. The file is the backstop that
 * survives Ghost post deletion; the tag is the primary live source.
 * Editing a post title in Ghost will NOT cause a re-import.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const GhostAdminAPI = require('@tryghost/admin-api');
const Parser = require('rss-parser');

const FEED_URL = process.env.FEED_URL
  || 'https://api.riverside.com/hosting/V48At7Hk.rss';
const SHOP_ID = process.env.BOOKSHOP_ID;
const ISBNDB_KEY = process.env.ISBNDB_KEY;
const HEADSHOT_DIR = process.env.HEADSHOT_DIR || './headshots';
const POST_STATUS = process.env.POST_STATUS || 'draft';
const NEWSLETTER_SLUG = process.env.NEWSLETTER_SLUG;
const MAX_AGE_DAYS = parseInt(process.env.MAX_AGE_DAYS || '14', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
const CACHE_FILE  = path.join(process.cwd(), '.book-cache.json');
const GUIDS_FILE  = path.join(process.cwd(), 'imported-guids.json');

const api = new GhostAdminAPI({
  url: process.env.GHOST_API_URL,
  key: process.env.GHOST_ADMIN_KEY,
  version: 'v5.0'
});

const parser = new Parser({
  customFields: {
    item: [
      ['itunes:episode', 'episodeNumber'],
      ['itunes:episodeType', 'episodeType'],
      ['itunes:duration', 'duration'],
      ['content:encoded', 'contentEncoded']
    ]
  }
});

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {}
const saveCache = () =>
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

// Guids of episodes that were successfully published; persisted across runs
// so that deleting a Ghost post doesn't cause a re-import.
let publishedGuidFile = new Set();
try {
  const raw = JSON.parse(fs.readFileSync(GUIDS_FILE, 'utf8'));
  if (Array.isArray(raw)) for (const g of raw) publishedGuidFile.add(g);
} catch (e) {}

let credits = {};
{
  const creditsPath = path.resolve(HEADSHOT_DIR, 'credits.json');
  console.log(`credits: loading ${creditsPath}`);
  try {
    credits = JSON.parse(fs.readFileSync(creditsPath, 'utf8'));
    const keys = Object.keys(credits);
    console.log(`credits: ${keys.length} entries: ${keys.join(', ')}`);
  } catch (e) {
    console.warn(`credits: FAILED — ${e.message}`);
  }
}

// ---------- books ----------

async function fromIsbnDb(isbn) {
  if (!ISBNDB_KEY) return null;
  const res = await fetch(`https://api2.isbndb.com/book/${isbn}`, {
    headers: { Authorization: ISBNDB_KEY }
  });
  if (!res.ok) return null;
  const d = await res.json();
  const b = d.book;
  if (!b) return null;
  return {
    title: b.title || null,
    authors: b.authors || [],
    cover: b.image || null
  };
}

async function fromGoogle(isbn) {
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  if (!res.ok) return null;
  const d = await res.json();
  const v = d.items && d.items[0] && d.items[0].volumeInfo;
  if (!v) return null;
  const t = v.imageLinks
    && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
  return {
    title: v.title,
    authors: v.authors || [],
    cover: t ? t.replace(/^http:/, 'https:').replace(/&edge=curl/, '') : null
  };
}

async function fromOpenLibrary(isbn) {
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}`
    + `&format=json&jscmd=data`);
  if (!res.ok) return null;
  const d = await res.json();
  const b = d[`ISBN:${isbn}`];
  if (!b) return null;
  return {
    title: b.title,
    authors: (b.authors || []).map(a => a.name),
    cover: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
  };
}

async function lookupBook(isbn) {
  if (cache[isbn]) return cache[isbn];
  const sources = [fromIsbnDb, fromGoogle, fromOpenLibrary];
  let book = null;
  for (const src of sources) {
    try {
      const result = await src(isbn);
      if (!result) continue;
      if (!book) {
        book = result;
      } else {
        if (!book.title && result.title) book.title = result.title;
        if (!book.authors.length && result.authors.length)
          book.authors = result.authors;
        if (!book.cover && result.cover) book.cover = result.cover;
      }
      if (book.title && book.cover) break;
    } catch (e) {}
  }
  if (!book) {
    console.warn(`  no metadata for ${isbn}`);
    book = { title: null, authors: [], cover: null };
  }
  cache[isbn] = book;
  saveCache();
  return book;
}

// ---------- images ----------

async function uploadRemote(url, name) {
  if (!url || DRY_RUN) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) return null;
    const tmp = path.join(os.tmpdir(), `${name.replace(/[^\w.-]/g, '_')}.jpg`);
    fs.writeFileSync(tmp, buf);
    const img = await api.images.upload({ file: tmp });
    fs.unlinkSync(tmp);
    return img.url;
  } catch (e) {
    console.warn(`  cover upload failed (${name}): ${e.message}`);
    return null;
  }
}

async function uploadLocal(filePath) {
  if (DRY_RUN) return null;
  try {
    return (await api.images.upload({ file: filePath })).url;
  } catch (e) {
    console.warn(`  headshot upload failed: ${e.message}`);
    return null;
  }
}

function normalizeForMatch(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accent marks
    .replace(/[^\w\s]/g, ' ')         // punctuation → space
    .replace(/\s+/g, ' ')             // collapse whitespace
    .toLowerCase()
    .trim();
}

function isSubsequence(needle, haystack) {
  let hi = 0;
  for (const token of needle) {
    while (hi < haystack.length && haystack[hi] !== token) hi++;
    if (hi >= haystack.length) return false;
    hi++;
  }
  return true;
}

const HEADSHOT_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

// Returns the resolved file path or null.
// Tries three tiers in order; stops at the first match.
// Ambiguous matches (multiple files at the same tier) return null.
function findHeadshot(guest) {
  if (!guest) return null;
  let entries;
  try {
    entries = fs.readdirSync(HEADSHOT_DIR)
      .filter(f => HEADSHOT_EXTS.includes(path.extname(f).toLowerCase()))
      .map(f => ({ file: f, stem: path.basename(f, path.extname(f)) }));
  } catch { return null; }

  // Tier 1: exact stem match
  const t1 = entries.filter(e => e.stem === guest);
  if (t1.length === 1) {
    console.log(`  headshot tier 1 (exact): ${t1[0].file}`);
    return path.join(HEADSHOT_DIR, t1[0].file);
  }
  if (t1.length > 1) {
    console.warn(`  headshot ambiguous (tier 1) for "${guest}": ${t1.map(e => e.file).join(', ')}`);
    return null;
  }

  // Tier 2: case-folded, accent-stripped, punctuation-removed
  const normGuest = normalizeForMatch(guest);
  const t2 = entries.filter(e => normalizeForMatch(e.stem) === normGuest);
  if (t2.length === 1) {
    console.log(`  headshot tier 2 (normalized): ${t2[0].file}`);
    return path.join(HEADSHOT_DIR, t2[0].file);
  }
  if (t2.length > 1) {
    console.warn(`  headshot ambiguous (tier 2) for "${guest}": ${t2.map(e => e.file).join(', ')}`);
    return null;
  }

  // Tier 3: bidirectional token subsequence.
  // Either all guest tokens appear in the stem (handles middle names in filenames)
  // or all stem tokens appear in the guest name (handles honorifics in RSS titles).
  const guestTokens = normGuest.split(' ').filter(Boolean);
  const t3 = entries.filter(e => {
    const stemTokens = normalizeForMatch(e.stem).split(' ').filter(Boolean);
    return isSubsequence(guestTokens, stemTokens)
        || isSubsequence(stemTokens, guestTokens);
  });
  if (t3.length === 1) {
    console.log(`  headshot tier 3 (token subsequence): ${t3[0].file}`);
    return path.join(HEADSHOT_DIR, t3[0].file);
  }
  if (t3.length > 1) {
    console.warn(`  headshot ambiguous (tier 3) for "${guest}": ${t3.map(e => e.file).join(', ')}`);
    return null;
  }

  return null;
}

// ---------- content ----------

function guestFromTitle(title) {
  const i = title.indexOf(':');
  if (i === -1) return null;
  const name = title.slice(0, i).trim();
  if (name.length > 40 || name.split(' ').length > 4) return null;
  return name;
}

function extractIsbns(html) {
  // Find the paragraph/block containing "BOOKS:" (case-insensitive),
  // tolerating inline tags like <code> that Riverside sometimes injects.
  const blockRe = /<p[^>]*>[\s\S]*?<\/p>/gi;
  let booksBlock = null;
  const cleaned = html.replace(blockRe, block => {
    if (!/books\s*:/i.test(block.replace(/<[^>]*>/g, ''))) return block;
    booksBlock = block;
    return '';
  });
  if (!booksBlock) return { html, isbns: [] };
  // Strip all tags, decode entities, extract ISBN runs
  const text = booksBlock.replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, '');
  const isbns = [...text.matchAll(/\b(\d{10}|\d{13})\b/g)]
    .map(m => m[1]);
  return { html: cleaned, isbns };
}

// Wrap the "Topics & Timestamps" paragraph and all following timestamp
// paragraphs in a collapsed <details> HTML card. Works on both raw RSS HTML
// (no card markers) and stored Ghost HTML (which may have card markers after
// the timestamps section).
function wrapTimestamps(html) {
  const m = html.match(
    /(<p[^>]*>\s*Topics\s*(?:&amp;|&)\s*Timestamps\s*<\/p>)([\s\S]*?)(?=<!--kg-card-begin|$)/i
  );
  if (!m) return html;
  const before = html.slice(0, m.index);
  const after  = html.slice(m.index + m[0].length);
  return before
    + '<!--kg-card-begin: html-->\n'
    + '<details class="lw-toc">\n'
    + '<summary>Topics &amp; Timestamps</summary>\n'
    + m[2].trim()
    + '\n</details>\n'
    + '<!--kg-card-end: html-->\n'
    + after;
}

async function booksSection(isbns) {
  if (!isbns.length || !SHOP_ID) return '';
  const cards = [];
  for (const isbn of isbns) {
    const book = await lookupBook(isbn);
    const href = `https://bookshop.org/a/${SHOP_ID}/${isbn}`;
    const label = book.title || isbn;
    const by = book.authors.length
      ? `<span style="font-size:.8rem;opacity:.65;display:block;margin-top:.15rem">${book.authors.join(', ')}</span>` : '';
    // Try each cover URL from the sources until one uploads
    let cover = null;
    if (book.cover) {
      cover = await uploadRemote(book.cover, `cover-${isbn}`);
    }
    const img = cover
      ? `<a href="${href}"><img src="${cover}" alt="${label}" `
        + `style="width:110px;height:auto;display:block;margin-bottom:.5rem">`
        + `</a>`
      : '';
    cards.push(`<div style="width:110px">${img}`
      + `<a href="${href}" style="font-size:.95rem;font-weight:600;line-height:1.25">${label}</a>`
      + `${by}</div>`);
  }
  return `<!--kg-card-begin: html-->
<h3>Books mentioned</h3>
<div style="display:flex;flex-wrap:wrap;gap:1.5rem;align-items:flex-start">
${cards.join('\n')}
</div>
<!--kg-card-end: html-->`;
}

function trimExcerpt(raw) {
  if (!raw) return '';
  // Strip leading timestamp lines like "(01:05) ..."
  const text = raw.replace(/\s+/g, ' ').replace(/^\s*\(\d[\d:]*\)\s*/g, '').trim();
  if (text.length <= 290) return text;
  const sliced = text.slice(0, 290);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace === -1) return sliced + '\u2026';
  return sliced.slice(0, lastSpace).replace(/[.,;:!?\-—\s]+$/, '') + '\u2026';
}

function formatDuration(raw) {
  if (!raw) return '';
  const parts = raw.split(':').map(Number);
  let h, m;
  if (parts.length === 3) {
    [h, m] = parts;
  } else if (parts.length === 2) {
    h = 0; m = parts[0];
  } else {
    // Integer seconds
    const total = Math.round(Number(raw));
    if (!Number.isFinite(total) || total < 0) return '';
    h = Math.floor(total / 3600);
    m = Math.floor((total % 3600) / 60);
  }
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function audioPlayer(audioUrl, postUrl, duration) {
  if (!audioUrl) return '';
  const dur = formatDuration(duration);
  const listenLine = postUrl
    ? `<p class="lw-listen"><a href="${postUrl}">\u25B6 Listen to this episode</a>${dur ? ` \u00B7 ${dur}` : ''}</p>`
    : '';
  return `<!--kg-card-begin: html-->
${listenLine}
<figure class="kg-card kg-audio-card">
<audio src="${audioUrl}" controls preload="metadata" style="width:100%"></audio>
</figure>
<!--kg-card-end: html-->`;
}

// Build a guid → { url, type } map from raw RSS XML.
// rss-parser doesn't expose attributes on self-closing elements,
// so we parse <podcast:transcript> directly from the raw XML.
// Preference order: text/plain → text/html → text/vtt → application/x-subrip
const TRANSCRIPT_PREFERENCE = ['text/plain', 'text/html', 'text/vtt', 'application/x-subrip'];

function buildTranscriptMap(xml) {
  const map = new Map();
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const guidM = block.match(/<guid[^>]*>(.*?)<\/guid>/);
    if (!guidM) continue;
    const guid = guidM[1].trim();

    // Collect all podcast:transcript elements in this item.
    // Match both self-closing (<podcast:transcript ... />) and
    // paired (<podcast:transcript ...></podcast:transcript>) forms.
    const candidates = [];
    const txRe = /<podcast:transcript([^>]*?)(?:\/>|>[\s\S]*?<\/podcast:transcript>)/g;
    let tx;
    while ((tx = txRe.exec(block)) !== null) {
      const attrs = tx[1];
      const urlM  = attrs.match(/url="([^"]+)"/);
      const typeM = attrs.match(/type="([^"]+)"/);
      if (urlM) candidates.push({ url: urlM[1], type: (typeM?.[1] ?? '').toLowerCase() });
    }
    if (!candidates.length) continue;

    // Pick by preference order
    let chosen = null;
    for (const pref of TRANSCRIPT_PREFERENCE) {
      chosen = candidates.find(c => c.type === pref) ?? null;
      if (chosen) break;
    }
    if (!chosen) chosen = candidates[0]; // fallback: first available

    map.set(guid, chosen);
  }
  return map;
}

// Strip VTT/SRT caption formatting and merge cues into speaker paragraphs.
//
// Processing order:
//   1. Remove WEBVTT header, NOTE blocks, STYLE blocks.
//   2. Split into cue blocks (double-newline separated).
//   3. For each cue block: discard cue numbers (bare integers) and timestamp
//      lines (HH:MM or MM:SS prefix). What remains is the cue payload.
//   4. Strip VTT voice tags: <v Speaker Name>text</v> → "Speaker Name: text".
//      <v> with no name just drops the tag.
//   5. Strip any remaining VTT inline tags (<c>, <b>, <i>, <u>, <ruby>, etc.).
//   6. Merge cues into paragraphs: start a new paragraph on a speaker change
//      or after a cue ending in sentence-final punctuation (. ! ?). Otherwise
//      append to the current paragraph with a space.
//   7. Collapse whitespace within each paragraph.
function stripCaptionFormat(text) {
  // 1. Remove WEBVTT header line, NOTE blocks, STYLE blocks
  text = text
    .replace(/^WEBVTT[^\n]*\n/i, '')
    .replace(/\bNOTE\b[\s\S]*?(?=\n\n|\n?$)/g, '')
    .replace(/\bSTYLE\b[\s\S]*?(?=\n\n|\n?$)/g, '');

  const TIMESTAMP_RE = /^\d{1,2}:\d{2}[:\d.]*\s*-->/;
  const CUE_NUMBER_RE = /^\d+$/;
  // VTT voice tag: <v.optional-class Speaker Name> ... </v>
  const VOICE_RE = /^<v(?:\.[^>]*)?\s+([^>]+)>([\s\S]*)<\/v>$/;
  const VOICE_OPEN_RE = /^<v(?:\.[^>]*)?\s+([^>]+)>/;    // without closing tag
  const INLINE_TAG_RE = /<\/?(?:c|b|i|u|ruby|rt|lang|v)[^>]*>/g;
  const SENTENCE_END_RE = /[.!?](\s*["»›"'])?$/;

  // 2. Split into cue blocks
  const cueBlocks = text.split(/\n{2,}/);

  // 3–5. Parse each cue block into { speaker, text }
  const cues = [];
  for (const block of cueBlocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    // Drop cue number and timestamp lines
    const payload = lines.filter(l => !CUE_NUMBER_RE.test(l) && !TIMESTAMP_RE.test(l));
    if (!payload.length) continue;

    let speaker = null;
    let cueText = payload.join(' ');

    // Extract voice tag speaker from start of cue text
    let vm = cueText.match(VOICE_RE);
    if (vm) {
      speaker = vm[1].trim();
      cueText = vm[2];
    } else {
      vm = cueText.match(VOICE_OPEN_RE);
      if (vm) {
        speaker = vm[1].trim() || null;
        cueText = cueText.slice(vm[0].length).replace(/<\/v>/g, '');
      }
    }

    // Strip remaining VTT inline tags, collapse whitespace
    cueText = cueText.replace(INLINE_TAG_RE, '').replace(/\s+/g, ' ').trim();
    if (!cueText) continue;

    cues.push({ speaker, text: cueText });
  }

  // 6. Merge cues into paragraphs
  const paragraphs = [];
  let currentSpeaker = null;
  let currentText = '';

  for (const cue of cues) {
    const speakerChanged = cue.speaker !== null && cue.speaker !== currentSpeaker;
    const sentenceEnd = currentText && SENTENCE_END_RE.test(currentText);

    if (currentText && (speakerChanged || sentenceEnd)) {
      // Emit current paragraph
      const para = currentSpeaker
        ? `${currentSpeaker}: ${currentText}`
        : currentText;
      paragraphs.push(para.replace(/\s+/g, ' ').trim());
      currentText = '';
    }

    if (cue.speaker !== null) currentSpeaker = cue.speaker;
    currentText = currentText ? `${currentText} ${cue.text}` : cue.text;
  }

  // Flush last paragraph
  if (currentText) {
    const para = currentSpeaker
      ? `${currentSpeaker}: ${currentText}`
      : currentText;
    paragraphs.push(para.replace(/\s+/g, ' ').trim());
  }

  return paragraphs.join('\n\n');
}

// Fetch transcript text and convert to HTML paragraphs with bold speaker names.
// Returns a collapsed <!--kg-card-begin: html--> block, or '' on failure.
// `type` is the MIME type from podcast:transcript (e.g. 'text/plain', 'text/vtt').
async function transcriptSection(url, type = 'text/plain') {
  if (!url) return '';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return '';
    let text = (await res.text()).trim();
    if (!text) return '';

    // Strip caption formatting for VTT and SRT before paragraph parsing
    if (type === 'text/vtt' || type === 'application/x-subrip') {
      text = stripCaptionFormat(text);
      if (!text) return '';
    }

    // For HTML transcripts, strip tags to get plain text
    if (type === 'text/html') {
      text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = text
      .split(/\n\n+/)
      .filter(p => p.trim())
      .map(p => {
        p = p.replace(/\n/g, ' ').trim();
        const colon = p.indexOf(': ');
        if (colon > 0 && colon < 60) {
          return `<p><strong>${esc(p.slice(0, colon))}:</strong> ${esc(p.slice(colon + 2))}</p>`;
        }
        return `<p>${esc(p)}</p>`;
      })
      .join('\n');
    if (!body) return '';
    return `<!--kg-card-begin: html-->
<details class="lw-transcript">
<summary>Transcript</summary>
${body}
</details>
<!--kg-card-end: html-->`;
  } catch {
    return '';
  }
}

async function buildHtml(item, postUrl, transcriptEntry) {
  const raw = item.contentEncoded || item.content || item.description || '';
  const { html, isbns } = extractIsbns(raw);
  const audioUrl = item.enclosure && item.enclosure.url;
  const { url: txUrl, type: txType } = transcriptEntry ?? {};
  return [audioPlayer(audioUrl, postUrl, item.duration),
    wrapTimestamps(html),
    await transcriptSection(txUrl, txType),
    await booksSection(isbns)].filter(Boolean).join('\n');
}

// ---------- dedupe on guid ----------

const guidTag = guid => `#rs-${guid}`;

// Returns { published: Set<guid>, drafts: Map<guid, {id, updated_at, slug}> }.
// published = guids whose Ghost post is published or scheduled (treat as done).
// drafts    = guids whose Ghost post is still a draft (eligible for upgrade).
async function importedGuids() {
  const published = new Set();
  const drafts    = new Map();
  let page = 1;
  while (true) {
    const posts = await api.posts.browse({
      limit: 100, page,
      fields: 'id,status,updated_at,slug',
      include: 'tags',
      filter: 'status:[draft,published,scheduled]'
    });
    for (const p of posts) {
      for (const t of (p.tags || [])) {
        if (t.name && t.name.startsWith('#rs-')) {
          const guid = t.name.slice(4);
          if (p.status === 'draft') {
            drafts.set(guid, { id: p.id, updated_at: p.updated_at, slug: p.slug });
          } else {
            published.add(guid);
            drafts.delete(guid); // published wins if both exist somehow
          }
        }
      }
    }
    if (!posts.meta || !posts.meta.pagination.next) break;
    page = posts.meta.pagination.next;
  }
  return { published, drafts };
}

// ---------- main ----------

async function main() {
  if (!process.env.GHOST_API_URL || !process.env.GHOST_ADMIN_KEY) {
    console.error('Set GHOST_API_URL and GHOST_ADMIN_KEY.');
    process.exit(1);
  }

  console.log(`status=${POST_STATUS}`
    + ` newsletter=${NEWSLETTER_SLUG || '(none)'}`
    + ` maxAge=${MAX_AGE_DAYS}d${DRY_RUN ? ' DRY_RUN' : ''}`);

  const rawXml = await fetch(FEED_URL).then(r => r.text());
  const transcriptUrls = buildTranscriptMap(rawXml);
  const feed = await parser.parseString(rawXml);
  const { published: ghostPublished, drafts: ghostDrafts } = await importedGuids();
  // Merge Ghost published guids with the file-based backstop.
  const publishedGuids = new Set([...ghostPublished, ...publishedGuidFile]);
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;

  let created = 0, skipped = 0, guidFileChanged = false;

  for (const item of feed.items.slice().reverse()) {
    const title = (item.title || '').trim();
    const guid = item.guid;

    if (item.episodeType === 'trailer'
        && process.env.INCLUDE_TRAILER !== '1') {
      skipped++; continue;
    }

    // Already published (Ghost tag or file backstop) — permanently done.
    if (publishedGuids.has(guid)) {
      console.log(`skip  imported   ${title}`);
      skipped++; continue;
    }

    // Check for an existing draft that may be upgradeable.
    const existingDraft = ghostDrafts.get(guid);

    // Age filter applies only to genuinely new episodes, not draft upgrades.
    const pubDate = item.isoDate ? Date.parse(item.isoDate) : Date.now();
    if (!existingDraft && pubDate < cutoff) {
      console.log(`skip  too old    ${title}`);
      skipped++; continue;
    }

    const guest = guestFromTitle(title);
    const tags = [{ name: 'Podcast' }, { name: guidTag(guid) }];
    if (guest) tags.push({ name: guest });

    const shotPath = findHeadshot(guest);
    const missingHeadshot = !!guest && !shotPath;
    const wantPublish = POST_STATUS === 'published';
    const wantEmail   = wantPublish && NEWSLETTER_SLUG;

    // Existing draft running in draft mode is already in the desired state.
    if (existingDraft && !wantPublish) {
      console.log(`skip  draft      ${title}`);
      skipped++; continue;
    }

    // A missing headshot on a publish run is a hard failure: the newsletter
    // email cannot be recalled after send.
    // - New episode:      create as draft, fail.
    // - Existing draft:   leave it as-is, fail.
    // On dry runs, report without failing.
    if (missingHeadshot && wantPublish) {
      const note = existingDraft ? 'leaving draft' : 'will create as draft';
      console.warn(`  no headshot for "${guest}" — ${note}, no newsletter`);
      if (!DRY_RUN) process.exitCode = 1;
    } else if (missingHeadshot) {
      console.warn(`  no headshot for "${guest}"`);
    }

    // Actual publish/email intent, after applying the headshot downgrade.
    const actualPublish = wantPublish && !missingHeadshot;
    const actualEmail   = actualPublish && NEWSLETTER_SLUG;

    if (DRY_RUN) {
      let label;
      if (existingDraft && actualPublish)      label = 'WOULD upgrade draft      ';
      else if (existingDraft)                  label = 'WOULD leave draft        ';
      else if (missingHeadshot && wantPublish) label = 'WOULD draft (no headshot)';
      else                                     label = 'WOULD create             ';
      console.log(`${label}  ${title}`
        + `${guest ? `  [${guest}]` : ''}`
        + `${shotPath ? '  +headshot' : ''}`);
      created++; continue;
    }

    // Existing draft with missing headshot: can't upgrade yet; leave as-is.
    // (process.exitCode already set above.)
    if (existingDraft && !actualPublish) {
      skipped++; continue;
    }

    const feature = shotPath ? await uploadLocal(shotPath) : null;
    const caption = (guest && credits[guest]) || undefined;
    if (guest && feature) {
      console.log(`  credit for ${guest}: ${caption ? `"${caption}"` : 'not found in credits.json'}`);
    }

    try {
      if (existingDraft) {
        // ── UPGRADE PATH ──────────────────────────────────────────────────
        // The draft already has the correct slug, tags, template, and
        // published_at. Patch in the headshot + final HTML and publish.
        const postUrl  = `${process.env.GHOST_API_URL}/${existingDraft.slug}/`;
        const finalHtml = await buildHtml(item, postUrl, transcriptUrls.get(guid));
        const editPayload = {
          id: existingDraft.id,
          html: finalHtml,
          custom_excerpt: trimExcerpt(item.contentSnippet) || undefined,
          feature_image: feature || undefined,
          feature_image_caption: feature ? caption : undefined,
          status: 'published',
          updated_at: existingDraft.updated_at
        };
        const editOpts = { source: 'html' };
        if (actualEmail) editOpts.newsletter = NEWSLETTER_SLUG;

        await api.posts.edit(editPayload, editOpts);

        console.log(`UPGRADED           ${title}${guest ? `  [${guest}]` : ''}`
          + `${feature ? '  +headshot' : ''}`
          + `${actualEmail ? '  +emailed' : ''}`);
      } else {
        // ── CREATE PATH ───────────────────────────────────────────────────
        // Step 1: create as draft (no listen link yet — need the slug first).
        const draft = await api.posts.add(
          {
            title,
            html: await buildHtml(item, null, transcriptUrls.get(guid)),
            custom_excerpt: trimExcerpt(item.contentSnippet) || undefined,
            feature_image: feature || undefined,
            feature_image_caption: feature ? caption : undefined,
            custom_template: 'custom-narrow-feature-image',
            tags,
            status: 'draft',
            published_at: item.isoDate || undefined
          },
          { source: 'html' }
        );

        // Step 2: rebuild HTML with the listen link now that we have the slug.
        const postUrl = `${process.env.GHOST_API_URL}/${draft.slug}/`;
        const finalHtml = await buildHtml(item, postUrl, transcriptUrls.get(guid));
        const editPayload = {
          id: draft.id,
          html: finalHtml,
          status: actualPublish ? 'published' : 'draft',
          updated_at: draft.updated_at
        };
        const editOpts = { source: 'html' };
        if (actualEmail) editOpts.newsletter = NEWSLETTER_SLUG;

        await api.posts.edit(editPayload, editOpts);

        const statusLabel = actualPublish    ? 'PUBLISHED          '
                          : missingHeadshot  ? 'DRAFT (no headshot)'
                          :                   'created            ';
        console.log(`${statusLabel}  ${title}${guest ? `  [${guest}]` : ''}`
          + `${feature ? '  +headshot' : ''}`
          + `${actualEmail ? '  +emailed' : ''}`);
      }

      created++;
      // Record the guid in the file backstop only once the episode is published.
      if (actualPublish) {
        publishedGuidFile.add(guid);
        guidFileChanged = true;
      }
    } catch (err) {
      const op = existingDraft ? 'UPGRADE FAILED    ' : 'FAILED            ';
      console.error(`${op}  ${title}\n  ${err.message}`);
      process.exitCode = 1;
    }
  }

  // Persist any newly published guids to the backstop file.
  if (guidFileChanged) {
    const sorted = [...publishedGuidFile].sort();
    fs.writeFileSync(GUIDS_FILE, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`\nupdated imported-guids.json (${sorted.length} entries)`);
  }

  console.log(`\n${created} ${DRY_RUN ? 'would be created' : 'created'},`
    + ` ${skipped} skipped.`);
}

main().catch(err => { console.error(err); process.exit(1); });
