#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const DIR = path.dirname(__filename);
const CONTRIBUTORS = path.join(DIR, "contributors.json");
const SHELVES = path.join(DIR, "shelves.json");
const CACHE = path.join(DIR, ".book-cache.json");
const ISBNDB_KEY = process.env.ISBNDB_KEY || null;

if (!ISBNDB_KEY) {
  console.error("FATAL: ISBNDB_KEY is not set. ISBNdb is the primary source; without it most lookups will silently fail.");
  process.exit(1);
}

let cache = {};
if (fs.existsSync(CACHE)) {
  try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch {}
}

function saveCache() {
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
}

// --- lookup sources (ISBNdb → Google Books → Open Library) ---

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
    cover: t ? t.replace(/^http:/, "https:").replace(/&edge=curl/, "") : null
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

async function verifyCover(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/")) return null;
    return url;
  } catch {
    return null;
  }
}

function isbn13to10(isbn13) {
  const digits = String(isbn13).replace(/[^0-9Xx]/g, "");
  if (digits.length !== 13 || !digits.startsWith("978")) return null;
  const core = digits.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? "X" : String(check));
}

async function runChain(isbn) {
  const sources = [fromIsbnDb, fromGoogle, fromOpenLibrary];
  let book = null;
  const candidateCovers = [];
  for (const src of sources) {
    try {
      const result = await src(isbn);
      if (!result) continue;
      if (!book) {
        book = { title: result.title, authors: result.authors, cover: null };
      } else {
        if (!book.title && result.title) book.title = result.title;
        if (!book.authors.length && result.authors.length)
          book.authors = result.authors;
      }
      if (result.cover) candidateCovers.push(result.cover);
    } catch {}
  }
  if (!book) return null;
  for (const url of candidateCovers) {
    const verified = await verifyCover(url);
    if (verified) { book.cover = verified; break; }
  }
  return book;
}

async function lookupBook(isbn) {
  const hit = cache[isbn];
  if (hit && (hit.title || hit.cover)) return hit;

  let book = await runChain(isbn);

  if (!book || (!book.title && !book.cover)) {
    const isbn10 = isbn13to10(isbn);
    if (!isbn10) {
      console.log(`  ↳ no ISBN-10 (979 prefix)`);
    } else {
      const fallback = await runChain(isbn10);
      if (fallback && (fallback.title || fallback.cover)) {
        console.log(`  ↳ resolved via ISBN-10 ${isbn10}`);
        book = fallback;
      } else {
        console.log(`  ↳ ISBN-10 ${isbn10} also failed`);
      }
    }
  }

  if (!book) book = { title: null, authors: [], cover: null };

  cache[isbn] = book;
  saveCache();
  return book;
}

// --- title search and author matching ---

// Normalize a name to sorted lowercase tokens, stripping punctuation.
// "E.P. Lande" → ["ep","lande"]   "Zhu Xiao Di" → ["di","xiao","zhu"]
// "Tucker, Veronica" → ["tucker","veronica"]
function nameTokens(str) {
  return str
    .toLowerCase()
    .replace(/\./g, "")          // E.P. → ep (before split so it's one token)
    .replace(/[,\-()[\]]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 0)
    .sort();
}

// Return true if any name in candidateAuthors (ISBNdb array) matches contributorName.
// Uses sorted-token subset: all tokens of the shorter name must appear in the longer,
// with single-letter tokens also matching any token that starts with that letter
// (handles "J." matching "James").
function authorsMatch(candidateAuthors, contributorName) {
  const contrib = nameTokens(contributorName);
  for (const auth of candidateAuthors) {
    const cand = nameTokens(auth);
    const [shorter, longer] = cand.length <= contrib.length
      ? [cand, contrib]
      : [contrib, cand];
    const matched = shorter.every(
      t => longer.includes(t) ||
           (t.length === 1 && longer.some(lt => lt.startsWith(t)))
    );
    if (matched) return true;
  }
  return false;
}

// Among candidates that passed the author filter, pick one automatically:
//   1. discard ebook formats entirely — Bookshop.org carries print only
//   2. if nothing remains, return null (caller reports as unresolved)
//   3. prefer those with a cover image
//   4. prefer most recent publication year
//   5. take first among ties
const EBOOK_RE = /kindle|ebook|e-book|digital/i;
function isEbook(b) { return EBOOK_RE.test(b.binding || ""); }

function selectBestCandidate(candidates) {
  const print = candidates.filter(b => !isEbook(b));
  if (!print.length) return null;
  const withCover = print.filter(b => b.image);
  const pool = withCover.length > 0 ? withCover : print;
  const dateYear = b => {
    const m = String(b.date_published || "").match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : 0;
  };
  pool.sort((a, b) => dateYear(b) - dateYear(a));
  return pool[0];
}

async function searchIsbnDbByTitle(title) {
  const encoded = encodeURIComponent(title);
  const res = await fetch(
    `https://api2.isbndb.com/books/${encoded}?column=title&pageSize=20`,
    { headers: { Authorization: ISBNDB_KEY } }
  );
  if (!res.ok) return [];
  const d = await res.json();
  return d.books || [];
}

// Resolve a title string for a given contributor to { isbn13, book }.
// Returns null if no result passes the author check.
// Caches resolved ISBNs under "title-search:{title}" in the book cache.
async function resolveTitle(title, contributorName) {
  const cacheKey = `title-search:${title.toLowerCase()}`;
  if (cache[cacheKey]) {
    const isbn13 = cache[cacheKey];
    console.log(`  ↳ title cache hit → ${isbn13}`);
    const book = await lookupBook(isbn13);
    return { isbn13, book };
  }

  const results = await searchIsbnDbByTitle(title);
  const matched = results.filter(b =>
    authorsMatch(b.authors || [], contributorName)
  );

  if (matched.length === 0) return null;

  const best = selectBestCandidate(matched);
  if (!best) return null;   // all matched results were ebook formats
  const isbn13 = best.isbn13;

  cache[cacheKey] = isbn13;
  saveCache();

  console.log(`  ↳ title search → ${isbn13} (${best.binding || "?"}, ${best.date_published || "?"})`);
  const book = await lookupBook(isbn13);
  return { isbn13, book };
}

// --- main ---

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")  // any run of non-alphanumeric → single hyphen
    .replace(/^-|-$/g, "");        // trim leading/trailing hyphens
}

function normalizeAuthor(raw) {
  if (!raw) return raw;
  // "Doreski, William" → "William Doreski"
  if (/,/.test(raw)) raw = raw.split(",").map(s => s.trim()).reverse().join(" ");
  // Title-case and strip stray periods from ALL-CAPS entries
  return raw.replace(/\./g, "").replace(/\b\w+/g,
    w => w[0].toUpperCase() + w.slice(1).toLowerCase()).trim();
}

async function main() {
  const contributors = JSON.parse(fs.readFileSync(CONTRIBUTORS, "utf8"));
  const shelves = {};
  const problems = [];
  // Track titles resolved this run: { contributorName → { title → isbn13 } }
  const resolved = {};

  for (const [name, data] of Object.entries(contributors)) {
    const slug = slugify(name);
    const books = [];
    console.log(`\n${name}  (slug: ${slug})`);
    console.log("─".repeat(50));

    // --- ISBN entries ---
    for (const isbn of (data.isbns || [])) {
      const b = await lookupBook(isbn);
      const entry = {
        isbn,
        title: b.title || null,
        authors: normalizeAuthor(Array.isArray(b.authors) ? b.authors.join(", ") : (b.authors || null)),
        cover: b.cover || null
      };
      books.push(entry);

      const ok = entry.title && entry.cover;
      const flag = ok ? "  OK" : "  !!";
      console.log(`${flag}  ${isbn}`);
      console.log(`      title:  ${entry.title || "MISSING"}`);
      console.log(`      author: ${entry.authors || "MISSING"}`);
      console.log(`      cover:  ${entry.cover ? "yes" : "MISSING"}`);

      if (!ok) problems.push(`${name}: ${isbn} — ${!entry.title ? "no title" : ""}${!entry.title && !entry.cover ? ", " : ""}${!entry.cover ? "no cover" : ""}`);
    }

    // --- Title entries ---
    for (const title of (data.titles || [])) {
      console.log(`  >> title search: "${title}"`);
      let result = null;
      try { result = await resolveTitle(title, name); } catch {}

      if (!result) {
        console.log(`  !!  "${title}" — no result by that author`);
        problems.push(`${name}: "${title}" — no result by that author`);
        continue;
      }

      const { isbn13, book: b } = result;
      const entry = {
        isbn: isbn13,
        title: b.title || null,
        authors: normalizeAuthor(Array.isArray(b.authors) ? b.authors.join(", ") : (b.authors || null)),
        cover: b.cover || null
      };
      books.push(entry);

      const ok = entry.title && entry.cover;
      console.log(`${ok ? "  OK" : "  !!"} resolved to ${isbn13}`);
      console.log(`      title:  ${entry.title || "MISSING"}`);
      console.log(`      author: ${entry.authors || "MISSING"}`);
      console.log(`      cover:  ${entry.cover ? "yes" : "MISSING"}`);

      if (!ok) problems.push(`${name}: ${isbn13} (from "${title}") — ${!entry.title ? "no title" : ""}${!entry.title && !entry.cover ? ", " : ""}${!entry.cover ? "no cover" : ""}`);

      // Mark for write-back
      if (!resolved[name]) resolved[name] = {};
      resolved[name][title] = isbn13;
    }

    shelves[slug] = { name, books };
  }

  fs.writeFileSync(SHELVES, JSON.stringify(shelves, null, 2) + "\n");
  console.log(`\nWrote shelves.json — ${Object.keys(shelves).length} contributor(s)`);

  // --- Write resolved titles back into contributors.json ---
  if (Object.keys(resolved).length > 0) {
    for (const [name, titleMap] of Object.entries(resolved)) {
      const data = contributors[name];
      for (const [title, isbn13] of Object.entries(titleMap)) {
        if (!data.isbns.includes(isbn13)) data.isbns.push(isbn13);
        data.titles = (data.titles || []).filter(t => t !== title);
      }
      if (data.titles && data.titles.length === 0) delete data.titles;
    }
    fs.writeFileSync(CONTRIBUTORS, JSON.stringify(contributors, null, 2) + "\n");
    const count = Object.values(resolved).reduce((n, m) => n + Object.keys(m).length, 0);
    console.log(`\nWrote contributors.json — moved ${count} resolved title(s) to isbns.`);
  }

  if (problems.length) {
    console.log("\nPROBLEMS:");
    problems.forEach(p => console.log(`  ${p}`));
  } else {
    console.log("No problems.");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
