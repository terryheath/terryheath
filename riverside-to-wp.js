#!/usr/bin/env node
/**
 * Riverside RSS -> WordPress (Life on Words site). Creates one Episode per new episode. Replaces riverside-to-ghost.js.
 * Env: WP_URL, INKHORN_IMPORT_TOKEN (instead of GHOST_*). Publishing an episode makes WordPress create a DRAFT listmonk campaign (never sent; NEWSLETTER_SLUG is ignored).
 *
 * Designed to run unattended on a schedule.
 *
 * Required env:
 *   GHOST_API_URL      https://smoky-hyena.pikapod.net  (terryheath.com)
 *                      Episodes of Life on Words with Terry Heath land in the
 *                      /podcast/ collection by way of the "podcast" tag (since
 *                      2026-11-13; they used to go to inkhornreview.com).
 *   GHOST_ADMIN_KEY    the "id:secret" Admin API key
 *
 * Optional env:
 *   FEED_URL           default: the Life on Words feed
 *   BOOKSHOP_ID        Bookshop.org affiliate id (94291)
 *   ISBNDB_KEY         ISBNdb API key; checked first for book metadata
 *   HUB_URL            the admin hub (default https://admin.terryheath.com). Guest headshots and photo credits live ONLY there (uploaded by guests on
 *                      terryheath.com/podcast/guests/, credit typed in the hub's /podcast list); this script fetches them per episode.
 *   HUB_API_SECRET     shared secret for the hub's server-to-server endpoint /podcast/api/headshot (same value as on the hub service). Without it, or
 *                      if the hub can't be reached, a guest counts as having no headshot (no publish, no newsletter).
 *   POST_STATUS        "draft" or "published"   (default: draft)
 *   NEWSLETTER_SLUG    Ghost newsletter slug to email on publish.
 *                      Omit to publish without sending.
 *   MAX_AGE_DAYS       skip episodes older than this (default: 14)
 *   DRY_RUN            "1" = log what would happen, change nothing
 *   SITE_URL           public site URL used for the "Listen to this episode"
 *                      link (default: https://terryheath.com; PODCAST_PATH, default /podcast, is
 *                      added before the slug). Never derived
 *                      from GHOST_API_URL, which is the admin host.
 *   REFRESH_GUID       RSS guid of an already-published episode. Instead of the
 *                      normal import, rebuild that one post's body from the
 *                      current feed (audio, duration, notes, transcript, books)
 *                      in place. Status, dates, slug, title, excerpt, feature
 *                      image and tags are not touched and no newsletter is sent.
 *                      This REPLACES the whole body, including hand edits.
 *   INCLUDE_TRAILER    "1" to include the trailer
 *
 * Dedupe is on the RSS guid, stored two ways:
 *   1. Hidden internal tag (#rs-<guid>) on the Ghost post.
 *   2. imported-guids.json in the repo root (published episodes only).
 * A guid in either source is treated as done. The file is the backstop that
 * survives Ghost post deletion; the tag is the primary live source.
 * Editing a post title in Ghost will NOT cause a re-import.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import Parser from 'rss-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FEED_URL = process.env.FEED_URL
  || 'https://api.riverside.com/hosting/V48At7Hk.rss';
const SHOP_ID = process.env.BOOKSHOP_ID;
const SITE_URL = (process.env.SITE_URL || 'https://terryheath.com').replace(/\/+$/, '');
const PODCAST_PATH = process.env.PODCAST_PATH ?? '/podcast';
const ISBNDB_KEY = process.env.ISBNDB_KEY;
const HUB_URL = (process.env.HUB_URL || 'https://admin.terryheath.com').replace(/\/+$/, '');
const HUB_API_SECRET = process.env.HUB_API_SECRET || '';
const POST_STATUS = process.env.POST_STATUS || 'draft';
const NEWSLETTER_SLUG = process.env.NEWSLETTER_SLUG;
const MAX_AGE_DAYS = parseInt(process.env.MAX_AGE_DAYS || '14', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
const STATE_DIR   = path.resolve(process.env.STATE_DIR || process.cwd());
const CACHE_FILE  = path.join(STATE_DIR, '.book-cache.json');
const GUIDS_FILE  = path.join(STATE_DIR, 'imported-guids.json');

const WP = (process.env.WP_URL || '').replace(/\/+$/, '');
const WPH = { 'X-Import-Token': process.env.INKHORN_IMPORT_TOKEN || '', 'Content-Type': 'application/json' };
const wpj = async (method, p, body) => {
  const r = await fetch(WP + '/wp-json/inkhorn/v1' + p, { method, headers: WPH, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`WordPress ${method} ${p}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
};
const slugify = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

// On first Railway run, seed from repo copy if volume is empty
if (!fs.existsSync(GUIDS_FILE)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const repoCopy = path.resolve(__dirname, 'imported-guids.json');
  if (fs.existsSync(repoCopy) && path.resolve(GUIDS_FILE) !== repoCopy) {
    fs.copyFileSync(repoCopy, GUIDS_FILE);
    console.log(`Seeded imported-guids.json from repo copy.`);
  }
}

// Guids of episodes that were successfully published; persisted across runs
// so that deleting a Ghost post doesn't cause a re-import.
let publishedGuidFile = new Set();
try {
  const raw = JSON.parse(fs.readFileSync(GUIDS_FILE, 'utf8'));
  if (Array.isArray(raw)) for (const g of raw) publishedGuidFile.add(g);
} catch (e) {}

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

// Headshots are sent to WordPress with the episode (base64), which stores them in the media library.
async function uploadLocal(filePath) {
  if (DRY_RUN) return null;
  try { return { b64: fs.readFileSync(filePath).toString('base64'), name: path.basename(filePath) }; } catch (e) { console.warn(`  headshot read failed: ${e.message}`); return null; }
}

// The guest's headshot and photo credit come from the admin hub, the only place they are kept. Returns
//   { file: <temp file path>, credit: <caption or undefined>, bytes } when the hub has a headshot for this guest, else null.
// Not found, ambiguous, unauthorized and "hub unreachable" all return null (the caller treats null as "no headshot": no publish, no newsletter),
// each with its own clear log line. Read-only: safe on dry runs. The temp file is the caller's to delete.
async function fetchHeadshot(guest) {
  if (!guest) return null;
  if (!HUB_API_SECRET) { console.warn(`  headshot lookup SKIPPED for "${guest}": HUB_API_SECRET is not set, treating as no headshot`); return null; }
  let res;
  try {
    res = await fetch(`${HUB_URL}/podcast/api/headshot?name=${encodeURIComponent(guest)}`, { headers: { Authorization: `Bearer ${HUB_API_SECRET}` }, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    console.warn(`  headshot lookup FAILED for "${guest}": the hub at ${HUB_URL} could not be reached (${e.message}); treating as no headshot`);
    return null;
  }
  if (!res.ok) {
    let why = ''; try { why = (await res.json()).error || ''; } catch {}
    console.warn(`  headshot lookup for "${guest}": hub answered ${res.status}${why ? ` (${why})` : ''}; treating as no headshot`);
    return null;
  }
  const type = res.headers.get('content-type') || '';
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[type];
  const buf = Buffer.from(await res.arrayBuffer());
  if (!ext || buf.length < 100) { console.warn(`  headshot lookup for "${guest}": the hub sent something that is not an image (${type}, ${buf.length} bytes); treating as no headshot`); return null; }
  let credit; try { credit = decodeURIComponent(res.headers.get('x-photo-credit') || '') || undefined; } catch { credit = undefined; }
  const file = path.join(os.tmpdir(), `headshot-${guest.replace(/[^\w]+/g, '_')}-${process.pid}${ext}`);
  fs.writeFileSync(file, buf);
  console.log(`  headshot from the hub: ${buf.length} bytes (${type}); photo credit: ${credit ? `"${credit}"` : 'none set'}`);
  return { file, credit, bytes: buf.length };
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
    const label = book.title || `Find this book on Bookshop (ISBN ${isbn})`;
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

function headshotCard(url, alt, caption) {
  if (!url) return '';
  const figcaption = caption ? `\n<figcaption>${caption}</figcaption>` : '';
  return `<!--kg-card-begin: html-->
<figure class="kg-card kg-image-card">
<img src="${url}" class="kg-image" alt="${alt || ''}">${figcaption}
</figure>
<!--kg-card-end: html-->`;
}

async function buildHtml(item, postUrl, transcriptEntry, { headshotUrl, headshotAlt, headshotCaption } = {}) {
  const raw = item.contentEncoded || item.content || item.description || '';
  const { html, isbns } = extractIsbns(raw);
  const audioUrl = item.enclosure && item.enclosure.url;
  const { url: txUrl, type: txType } = transcriptEntry ?? {};
  return [headshotCard(headshotUrl, headshotAlt, headshotCaption),
    audioPlayer(audioUrl, postUrl, item.duration),
    wrapTimestamps(html),
    await transcriptSection(txUrl, txType),
    await booksSection(isbns)].filter(Boolean).join('\n');
}

// ---------- dedupe on guid ----------

// Returns { published: Set<guid>, drafts: Map<guid, {id, slug, number}> } from WordPress (GET /episodes-state), and the highest episode number.
let _state = null;
async function wpState() { return _state || (_state = await wpj('GET', '/episodes-state')); }
async function importedGuids() {
  const published = new Set(), drafts = new Map();
  for (const e of await wpState()) {
    if (!e.guid) continue;
    if (e.status === 'draft') drafts.set(e.guid, { id: e.id, slug: e.slug, number: e.number });
    else published.add(e.guid);
  }
  return { published, drafts };
}
async function highestEpisodeNo() { return (await wpState()).reduce((m, e) => Math.max(m, e.number || 0), 0); }

// ---------- refresh one published episode (opt-in) ----------

// REFRESH_GUID=<guid>: rebuild the body of an already-published episode from the
// current feed, in place. Only html + updated_at are sent: status, published_at,
// slug, title, excerpt, feature image and tags stay as they are, and no
// newsletter option is passed, so nothing is emailed.
async function refreshOne(guid) {
  const rawXml = await fetch(FEED_URL).then(r => r.text());
  const transcriptUrls = buildTranscriptMap(rawXml);
  const feed = await parser.parseString(rawXml);
  const item = feed.items.find(i => i.guid === guid);
  if (!item) { console.error(`No feed item with guid ${guid}`); process.exit(1); }
  const found = (await wpState()).filter(e => e.guid === guid);
  if (found.length !== 1) { console.error(`Expected exactly one episode for ${guid}, found ${found.length}`); process.exit(1); }
  const post = found[0];
  const guest = guestFromTitle((item.title || '').trim());
  const html = await buildHtml(item, `${SITE_URL}${PODCAST_PATH}/${post.slug}/`, transcriptUrls.get(guid), { headshotAlt: guest || undefined });
  if (DRY_RUN) { console.log(`WOULD refresh  ${post.slug} — ${html.length} chars`); return; }
  await wpj('POST', '/import', { site: 'lifeonwords', type: 'ih_episode', slug: post.slug, only_content: true, content: html });
  console.log(`REFRESHED          ${post.slug}`);
}

// ---------- main ----------

async function main() {
  if (!WP || !process.env.INKHORN_IMPORT_TOKEN) {
    console.error('Set WP_URL and INKHORN_IMPORT_TOKEN.');
    process.exit(1);
  }

  if (process.env.REFRESH_GUID) return refreshOne(process.env.REFRESH_GUID.trim());

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
  let nextEpisodeNo = await highestEpisodeNo() + 1;

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

    // Age filter applies to both new episodes and existing drafts.
    const pubDate = item.isoDate ? Date.parse(item.isoDate) : Date.now();
    if (pubDate < cutoff) {
      console.log(`skip  too old    ${title}`);
      skipped++; continue;
    }

    const guest = guestFromTitle(title);

    // An upgraded draft keeps the number it was given when it was created.
    let episodeNo;
    if (existingDraft && existingDraft.number) episodeNo = existingDraft.number;
    else { episodeNo = nextEpisodeNo; nextEpisodeNo++; }

    const shot = await fetchHeadshot(guest);
    const shotPath = shot ? shot.file : null;
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
        + `${shotPath ? '  +headshot' : ''}`
        + `${shot && shot.credit ? `  caption: ${shot.credit}` : ''}`);
      if (shotPath) { try { fs.unlinkSync(shotPath); } catch {} }
      created++; continue;
    }

    // Existing draft with missing headshot: can't upgrade yet; leave as-is.
    // (process.exitCode already set above.)
    if (existingDraft && !actualPublish) {
      if (shotPath) { try { fs.unlinkSync(shotPath); } catch {} }
      skipped++; continue;
    }

    const feature = shotPath ? await uploadLocal(shotPath) : null;
    const caption = (shot && shot.credit) || undefined;
    if (shotPath) { try { fs.unlinkSync(shotPath); } catch {} }

    try {
      const slug = existingDraft ? existingDraft.slug : slugify(title);
      const postUrl = `${SITE_URL}${PODCAST_PATH}/${slug}/`;
      const html = await buildHtml(item, postUrl, transcriptUrls.get(guid), { headshotAlt: guest || undefined, headshotCaption: caption });
      const body = {
        site: 'lifeonwords', type: 'ih_episode', slug, title: existingDraft ? undefined : title, content: html,
        excerpt: trimExcerpt(item.contentSnippet) || '', status: actualPublish ? 'publish' : 'draft', date: item.isoDate || undefined,
        meta: { ih_guid: guid, ih_number: episodeNo, ih_creator: 'Terry Heath', ih_categories: ['Life on Words with Terry Heath', guest, `Life on Words No. ${episodeNo}`].filter(Boolean).join('|') },
      };
      if (!existingDraft) body.title = title;
      if (feature) { body.thumbnail_b64 = feature.b64; body.thumbnail_name = feature.name; }
      if (guest) body.guest_name = guest;
      await wpj('POST', '/import', body);
      const statusLabel = existingDraft ? 'UPGRADED          ' : actualPublish ? 'PUBLISHED          ' : missingHeadshot ? 'DRAFT (no headshot)' : 'created            ';
      console.log(`${statusLabel}  ${title}${guest ? `  [${guest}]` : ''}${feature ? '  +headshot' : ''}${actualPublish ? '  (draft campaign made)' : ''}`);

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

export { buildHtml, transcriptSection, booksSection, wrapTimestamps, formatDuration, buildTranscriptMap, SITE_URL };

// Run only when executed directly, so one-off scripts can import the builders.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(err => { console.error(err); process.exit(1); });
}
