#!/usr/bin/env node
/** Episode 12 (Adria Goetz): guest bio (the notes paragraph that describes her), and "Books mentioned" built the way riverside-to-wp.js builds it
 *  (ISBNs from the BOOKS: line of the notes, metadata from Google Books then Open Library, Bookshop.org links, covers copied to the media library),
 *  in the format Terry set for every episode (title case, a colon before the subtitle, First Last, a set listed once). Idempotent. */
const { execSync } = require('child_process');
const WP = (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
const SHOP_ID = '94291';
const SLUG = 'draconianly-picky-agent-adria-goetz-on-the-other-side-of-the-query';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);
const titleCase = (t) => t.split(/(\s+|:\s*)/).reduce((acc, w, i, arr) => { if (/^\s+$|^:\s*$/.test(w) || !w) return acc + w; const first = acc === '' || /:\s*$/.test(acc); const lw = w.toLowerCase(); return acc + ((!first && SMALL.has(lw)) ? lw : w.charAt(0).toUpperCase() + w.slice(1)); }, '');
const firstLast = (a) => (/^[^,]+,\s*[^,]+$/.test(a) && !/ .* /.test(a.split(',')[0]) ? a.split(',').reverse().map((x) => x.trim()).join(' ') : a);
async function lookup(isbn) {
  try { const d = await (await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)).json(); const v = d.items && d.items[0] && d.items[0].volumeInfo; if (v && v.title) return { title: v.title + (v.subtitle ? ': ' + v.subtitle : ''), authors: v.authors || [] }; } catch {}
  try { const d = await (await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`)).json(); const b = d['ISBN:' + isbn]; if (b) return { title: b.title + (b.subtitle ? ': ' + b.subtitle : ''), authors: (b.authors || []).map((x) => x.name) }; } catch {}
  return null;
}
const post = async (o) => { const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify(o) }); console.log(r.status, o.slug || o.action, (await r.text()).slice(0, 160)); };
(async () => {
  const feed = await (await fetch('https://api.riverside.com/hosting/V48At7Hk.rss')).text();
  const it = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]).find((x) => /<itunes:episode>12</.test(x));
  const desc = it.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)[1];
  const paras = [...desc.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  const booksLine = paras.find((p) => /^BOOKS:/i.test(p.replace(/<[^>]+>/g, '').trim()));
  const isbns = [...(booksLine || '').matchAll(/\b(\d{13}|\d{10})\b/g)].map((m) => m[1]);
  // guest bio: the notes paragraph that describes her (the first), as for the other guests
  const bio = paras[0].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
  await post({ site: 'lifeonwords', type: 'ih_guest', slug: 'adria-goetz', meta_only: true, meta: { ih_bio: bio } });
  // books
  const seen = new Map();
  for (const isbn of isbns) {
    const m = await lookup(isbn); const title = m ? titleCase(m.title.replace(/\s+/g, ' ').trim()) : null;
    const key = (title || isbn).toLowerCase();
    if (seen.has(key)) { seen.get(key).count++; continue; }
    seen.set(key, { isbn, title, authors: m ? m.authors.map(firstLast) : [], count: 1 });
  }
  const cards = [...seen.values()].filter((b) => b.title).map((b) => {
    const label = b.title + (b.count > 1 ? `, ${b.count} vols.` : '');
    return `<div style="width:110px"><a href="https://bookshop.org/a/${SHOP_ID}/${b.isbn}"><img decoding="async" src="https://covers.openlibrary.org/b/isbn/${b.isbn}-L.jpg?default=false" alt="${esc(label)}" style="width:110px;height:auto;display:block;margin-bottom:.5rem"></a><a href="https://bookshop.org/a/${SHOP_ID}/${b.isbn}" style="font-size:.95rem;font-weight:600;line-height:1.25">${esc(label)}</a>${b.authors.length ? `<span style="font-size:.8rem;opacity:.65;display:block;margin-top:.15rem">${esc(b.authors.join(', '))}</span>` : ''}</div>`;
  });
  console.log('isbns', isbns.length, 'books', cards.length, [...seen.values()].map((b) => b.title + ' | ' + b.authors.join(', ')));
  // the page content: rebuild from the feed so the BOOKS: line is not left in the timestamps, then add the section
  const ti = paras.findIndex((p) => /Topics (&amp;|&) Timestamps/.test(p));
  const toc = paras.slice(ti + 1).filter((p) => !/^BOOKS:/i.test(p.replace(/<[^>]+>/g, '').trim()));
  const got = await (await fetch(`${WP}/lifeonwords/wp-json/wp/v2/ih_episode?slug=${SLUG}&_fields=content`)).json();
  let c = got[0].content.rendered;
  c = c.replace(/<h3>Books mentioned<\/h3>[\s\S]*$/, '');
  c = c.replace(/<details class="lw-toc">[\s\S]*?<\/details>/, `<details class="lw-toc">\n<summary>Topics &amp; Timestamps</summary>\n${toc.map((p) => `<p>${p}</p>`).join('\n')}\n</details>`);
  if (cards.length) c = c.trimEnd() + `\n<h3>Books mentioned</h3>\n<div style="display:flex;flex-wrap:wrap;gap:1.5rem;align-items:flex-start">\n${cards.join('\n')}\n</div>\n`;
  await post({ site: 'lifeonwords', type: 'ih_episode', slug: SLUG, only_content: true, content: c });
})();
