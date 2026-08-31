#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const DIR = path.dirname(__filename);
const CONTRIBUTORS = path.join(DIR, "contributors.json");
const SHELVES = path.join(DIR, "shelves.json");
const CACHE = path.join(DIR, ".book-cache.json");
const ISBNDB_KEY = process.env.ISBNDB_KEY || null;

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

async function lookupBook(isbn) {
  if (cache[isbn]) return cache[isbn];
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
  if (!book) {
    book = { title: null, authors: [], cover: null };
  }
  for (const url of candidateCovers) {
    const verified = await verifyCover(url);
    if (verified) { book.cover = verified; break; }
  }
  cache[isbn] = book;
  saveCache();
  return book;
}

// --- main ---

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, "-");
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

  for (const [name, data] of Object.entries(contributors)) {
    const slug = slugify(name);
    const books = [];
    console.log(`\n${name}  (slug: ${slug})`);
    console.log("─".repeat(50));
    for (const isbn of data.isbns) {
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
    shelves[slug] = { name, books };
  }

  fs.writeFileSync(SHELVES, JSON.stringify(shelves, null, 2) + "\n");
  console.log(`\nWrote shelves.json — ${Object.keys(shelves).length} contributor(s)`);

  if (problems.length) {
    console.log("\nPROBLEMS:");
    problems.forEach(p => console.log(`  ${p}`));
  } else {
    console.log("No problems.");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
