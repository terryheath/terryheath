// Bios and mailing addresses from signed agreements (2026-11-11). Shared by agreements.cjs (cron) and agreements-accept.cjs (payouts page).
//
// A contributor's bio lives in two places: the description of their Ghost contributor tag (slug = the author's name, e.g. victoria-k-butler),
// and the piece's `bio`/`bio_html` in inkhorn/data/editions-2026.json (also `author` = name in print and `custom_excerpt` "by NAME").
// When an agreement is signed we read its Name in print, Bio and Mailing address:
//   - bio blank in BOTH places  -> filled in automatically (bio_state 'filled', Terry is told);
//   - a bio exists in either    -> nothing changes (bio_state 'pending'); the payouts page shows both with Apply and Ignore;
//   - Apply replaces the bio and name in print in Ghost and in editions-2026.json (the nomination line is always kept); Ignore leaves it.
// Changing a name in print changes the byline in the edition partial, so the partials are regenerated, committed, and the theme uploaded.
const L = require('./agreements-lib.cjs');

const slugify = (s) => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ---- what the contributor typed -------------------------------------------------------------------------------------------
async function readSigned(submissionId) {
  const sub = await L.ds('GET', `/submissions/${submissionId}`);
  const sm = sub.submitters && sub.submitters[0];
  if (!sm || sm.status !== 'completed') return null;
  const v = Object.fromEntries((sm.values || []).map((x) => [x.field, x.value]));
  return { name_in_print: clean(v['Name in print']), bio: clean(v['Bio']), address: String(v['Mailing address'] || '').replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean).join('\n'), signed_at: sm.completed_at };
}

// ---- GitHub: the latest editions file (never the copy baked into the container) -----------------------------------------------
async function githubFile(path) {
  const r = await fetch(`https://api.github.com/repos/terryheath/terryheath/contents/${path}?ref=main`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'inkhorn-agreements' } });
  if (!r.ok) throw new Error(`GitHub ${path} -> ${r.status}`);
  const j = await r.json();
  return Buffer.from(j.content, 'base64').toString('utf8');
}
const editionsLive = async () => (process.env.GITHUB_TOKEN ? JSON.parse(await githubFile('inkhorn/data/editions-2026.json')) : JSON.parse(require('fs').readFileSync(L.editionsPath, 'utf8')));

const pieceOf = (data, rec) => data.pieces.find((p) => p.edition === rec.issue && (rec.slug ? L.resolvedSlug(p) === rec.slug : false));

// ---- what is there now ------------------------------------------------------------------------------------------------------
async function currentFor(api, data, rec) {
  const piece = pieceOf(data, rec);
  if (!piece) return null;
  const tags = await api.tags.browse({ filter: `slug:${slugify(piece.author)}`, limit: 1 });
  const tag = tags[0] || null;
  return { piece, tag, json_bio: clean(piece.bio), ghost_bio: clean(tag && tag.description), author: piece.author };
}

// ---- apply ------------------------------------------------------------------------------------------------------------------
// Replaces bio + name in print in editions-2026.json (committed to GitHub, theme re-uploaded if the byline changed) and in Ghost.
async function applyBio(api, rec, signed, { commit = true } = {}) {
  const data = await editionsLive();
  const cur = await currentFor(api, data, rec);
  if (!cur) throw new Error(`"${rec.title}" is not in editions-2026.json for ${rec.issue}`);
  const name = signed.name_in_print || cur.author;
  const piece = cur.piece;
  const nameChanged = name !== piece.author;
  piece.author = name; piece.bio = signed.bio; piece.bio_html = escHtml(signed.bio); piece.custom_excerpt = `by ${name}`; // nomination_line is kept as it is
  const partials = require('./scripts/gen-edition-partials.cjs').generate(data.pieces);
  const files = { 'inkhorn/data/editions-2026.json': JSON.stringify(data, null, 2) + '\n' };
  const themeFiles = {};
  for (const [ed, text] of Object.entries(partials)) { files[`inkhorn/theme/partials/editions/${ed}.hbs`] = text; themeFiles[`partials/editions/${ed}.hbs`] = text; }
  let sha = null;
  if (commit) {
    sha = await L.githubCommit(files, `Bio and name in print from the signed agreement: ${name} ("${rec.title}")\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`);
    if (nameChanged) await L.uploadTheme(L.themeZip(themeFiles));
  }
  // Ghost: the contributor tag (name + bio) and the post's "by NAME" line
  if (cur.tag) await api.tags.edit({ id: cur.tag.id, updated_at: cur.tag.updated_at, name, description: signed.bio });
  else await api.tags.add({ name, slug: slugify(name), description: signed.bio });
  const posts = await api.posts.browse({ filter: `slug:${rec.slug}`, fields: 'id,updated_at', limit: 1 });
  if (posts.length) await api.posts.edit({ id: posts[0].id, updated_at: posts[0].updated_at, custom_excerpt: `by ${name}` });
  return { name, nameChanged, sha };
}

// ---- cron entry: look at every signed record that has not been looked at ---------------------------------------------------------
async function processSigned(api, tracker, events, { dry = false } = {}) {
  const todo = tracker.records.filter((r) => r.status === 'signed' && !r.bio_state);
  if (!todo.length) return;
  const data = await editionsLive();
  for (const r of todo) {
    try {
      const signed = await readSigned(r.submission_id);
      if (!signed) continue;
      r.signed_info = signed;
      if (!signed.bio) { r.bio_state = 'none'; continue; } // nothing typed
      const cur = await currentFor(api, data, r);
      if (!cur) { r.bio_state = 'pending'; events.bios.push({ r, kind: 'pending', note: 'piece not in editions-2026.json yet' }); continue; }
      if (!cur.json_bio && !cur.ghost_bio) {
        if (!dry) { await applyBio(api, r, signed); }
        r.bio_state = 'filled';
        events.bios.push({ r, kind: 'filled', name: signed.name_in_print || cur.author });
      } else {
        r.bio_state = 'pending';
        events.bios.push({ r, kind: 'pending' });
      }
    } catch (e) { console.error('bio step failed for', r.title, e.message); events.bioErrors.push(`${r.title}: ${e.message}`); }
  }
}

module.exports = { readSigned, currentFor, applyBio, processSigned, editionsLive, slugify, clean };
