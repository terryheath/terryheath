#!/usr/bin/env node
/**
 * One-off Autumn/Winter 2026 edition build against Inkhorn's Ghost.
 * Source of truth: inkhorn/data/editions-2026.json
 *
 * Usage: node inkhorn/scripts/build-editions.cjs <phase> [--apply]
 *   phases: draft | tags | existing | new | schedule
 * Without --apply it prints what it would do. Idempotent: safe to re-run.
 * Credentials come from macOS Keychain (see CLAUDE.md).
 */
const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const getKey = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const api = new GhostAdminAPI({ url: getKey('ghost-url-inkhorn'), key: getKey('ghost-admin-inkhorn'), version: 'v5.0' });
const SITE = 'https://inkhornreview.com';
const pieces = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'editions-2026.json'), 'utf8')).pieces;
const LOG = path.join(__dirname, '..', 'build-log.md');
const [phase, flag] = process.argv.slice(2);
const APPLY = flag === '--apply';

const log = (line) => { console.log(line); if (APPLY) fs.appendFileSync(LOG, `- ${line}\n`); };
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const description = (p) => (p.bio ? p.bio + (p.nomination_line ? ' ' + p.nomination_line : '') : null);
const norm = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const emptyParas = (h) => (h.match(/<p>(\s|<br\s*\/?>)*<\/p>/g) || []).length;

// Schedule: position n -> 2026-12-01 04:00 PST (12:00Z) + (n-1) minutes
const winterTime = (pos) => new Date(Date.UTC(2026, 11, 1, 12, 0 + (pos - 1))).toISOString();

async function all(resource, opts) {
  const out = [];
  for (let page = 1; ; page++) {
    const b = await api[resource].browse({ ...opts, limit: 100, page });
    out.push(...b);
    if (b.length < 100) break;
  }
  return out;
}

// Locate the Ghost post for a record (live by slug, scheduled by title)
function findPost(posts, rec) {
  if (rec.status_now === 'scheduled') {
    return posts.find((p) => p.status === 'scheduled' && p.title === rec.match_scheduled_by_title);
  }
  return posts.find((p) => p.slug === rec.slug);
}

(async () => {
  const tags = await all('tags', {});
  const bySlug = Object.fromEntries(tags.map((t) => [t.slug, t]));
  const byName = Object.fromEntries(tags.map((t) => [t.name, t]));

  if (phase === 'draft') {
    const posts = await all('posts', { filter: 'status:draft' });
    const d = posts.find((p) => p.title.startsWith('[Edit before publishing] The Winter Issue Starts in January'));
    if (!d) return console.log('draft already gone');
    if (APPLY) await api.posts.delete({ id: d.id });
    log(`Step 2: deleted draft "${d.title}" (post ${d.id}); body is in backups/2026-10-09/posts.json`);
    return;
  }

  if (phase === 'tags') {
    // inkhorn-2
    if (!bySlug['inkhorn-2']) {
      if (APPLY) bySlug['inkhorn-2'] = await api.tags.add({ name: 'Inkhorn Review No. 2', slug: 'inkhorn-2', visibility: 'public' });
      log(`Step 5: created tag inkhorn-2 "Inkhorn Review No. 2" (${bySlug['inkhorn-2'] && bySlug['inkhorn-2'].id})`);
    }
    const seen = new Set();
    for (const p of pieces) {
      if (seen.has(p.author)) continue;
      seen.add(p.author);
      const slug = slugify(p.author);
      let t = byName[p.author] || bySlug[slug];
      const desc = description(p);
      if (!t) {
        if (APPLY) t = await api.tags.add({ name: p.author, slug, visibility: 'public', description: desc || undefined });
        log(`Step 5: created contributor tag ${slug} "${p.author}"${desc ? ' with bio' : ' (NO BIO)'} (${t && t.id})`);
        continue;
      }
      const upd = {};
      if (t.name !== p.author) upd.name = p.author;
      if (desc && t.description !== desc) upd.description = desc;
      if (Object.keys(upd).length) {
        if (APPLY) await api.tags.edit({ id: t.id, updated_at: t.updated_at, ...upd });
        const old = upd.description !== undefined && t.description ? ` | old description: ${JSON.stringify(t.description)}` : '';
        log(`Step 5: updated tag ${t.slug}: ${Object.keys(upd).join(', ')}${upd.name ? ` (name "${t.name}" -> "${p.author}")` : ''}${old}`);
      }
      if (!desc) log(`Step 5: ${p.author} (${t.slug}) has no bio in JSON; description left alone${t.description ? ' (existing kept)' : ' (none exists)'}`);
    }
    return;
  }

  const posts = await all('posts', { include: 'tags', formats: 'html', filter: 'status:[draft,published,scheduled]' });

  if (phase === 'existing') {
    for (const rec of pieces.filter((r) => r.status_now !== 'new')) {
      const post = findPost(posts, rec);
      if (!post) { console.log('NOT FOUND', rec.title); continue; }
      const season = rec.edition;
      const want = [];
      if (season === 'winter-2026') want.push('inkhorn-2');
      else want.push('inkhorn-1');
      const have = post.tags.map((t) => t.slug);
      const add = want.filter((s) => !have.includes(s));
      const tagList = post.tags.map((t) => ({ id: t.id })).concat(add.map((s) => ({ id: bySlug[s].id })));
      if (APPLY) {
        const edited = await api.posts.edit(
          { id: post.id, updated_at: post.updated_at, html: rec.html, custom_excerpt: rec.custom_excerpt, tags: tagList },
          { source: 'html' }
        );
        const back = await api.posts.read({ id: post.id }, { formats: 'html' });
        const okText = norm(back.html) === norm(rec.html);
        const empties = `${emptyParas(back.html)}/${emptyParas(rec.html)}`;
        log(`Step 3: updated ${rec.edition} #${rec.position} "${rec.title}" (${post.id}, ${post.status}) ${post.url}${add.length ? ' +tags ' + add.join(',') : ''}; text match ${okText}; empty paras read-back/source ${empties}`);
        if (!okText) console.log('  !! TEXT MISMATCH', rec.title);
      } else console.log('would update', rec.title, post.status, add);
    }
    return;
  }

  if (phase === 'new') {
    for (const rec of pieces.filter((r) => r.status_now === 'new')) {
      const prior = posts.find((p) => p.slug === rec.slug);
      if (prior && prior.status === 'draft' && rec.edition === 'autumn-2026') {
        if (APPLY) await api.posts.edit({ id: prior.id, updated_at: prior.updated_at, status: 'published' });
        log(`Step 4: published previously created draft ${rec.edition} #${rec.position} "${rec.title}" (${prior.id})`);
        continue;
      }
      if (prior) { console.log('exists', rec.slug); continue; }
      const t = (s) => { const x = bySlug[s] || byName[s]; if (!x) throw new Error('missing tag ' + s); return { id: x.id }; };
      const contributor = byName[rec.author] || bySlug[slugify(rec.author)];
      if (!contributor) throw new Error('missing contributor tag ' + rec.author);
      const tagList = [t(rec.edition), { id: contributor.id }, t(rec.genre), t(rec.edition === 'autumn-2026' ? 'inkhorn-1' : 'inkhorn-2')];
      const autumn = rec.edition === 'autumn-2026';
      if (!APPLY) { console.log('would create', rec.edition, rec.position, rec.title); continue; }
      const data = { title: rec.title, slug: rec.slug, html: rec.html, custom_excerpt: rec.custom_excerpt, tags: tagList, status: 'draft' };
      if (!autumn) { data.status = 'scheduled'; data.published_at = winterTime(Number(rec.position)); }
      let post = await api.posts.add(data, { source: 'html' });
      if (autumn) post = await api.posts.edit({ id: post.id, updated_at: post.updated_at, status: 'published' });
      const back = await api.posts.read({ id: post.id }, { formats: 'html' });
      const okText = norm(back.html) === norm(rec.html);
      log(`Step 4: created ${rec.edition} #${rec.position} "${rec.title}" (${post.id}) ${post.status} ${autumn ? 'published now' : post.published_at} ${post.url}; text match ${okText}; empty paras ${emptyParas(back.html)}/${emptyParas(rec.html)}`);
    }
    return;
  }

  if (phase === 'schedule') {
    for (const rec of pieces.filter((r) => r.edition === 'winter-2026' && r.status_now !== 'live')) {
      const post = findPost(posts, rec) || posts.find((p) => p.slug === rec.slug);
      if (!post) { console.log('NOT FOUND', rec.title); continue; }
      const when = winterTime(Number(rec.position));
      if (post.status === 'scheduled' && new Date(post.published_at).toISOString() === when) continue;
      if (APPLY) await api.posts.edit({ id: post.id, updated_at: post.updated_at, status: 'scheduled', published_at: when });
      log(`Step 4: rescheduled Winter #${rec.position} "${rec.title}" (${post.id}) to ${when} (04:${String(Number(rec.position) - 1).padStart(2, "0")} PST)`);
    }
    return;
  }
  console.log('unknown phase');
})().catch((e) => { console.error(e.message || e, e.context || ''); process.exit(1); });
