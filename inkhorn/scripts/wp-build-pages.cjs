#!/usr/bin/env node
/**
 * Pages the network still needed (2026-11-20): About pages for White Rabbit, Muse and Life on Words, a cover image per publication for the hub cards,
 * and the sample content WordPress ships with set aside. Idempotent (upserts by site, type, slug).
 *   node inkhorn/scripts/wp-build-pages.cjs [--dry]
 */
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const DRY = process.argv.includes('--dry');
const WP = (process.env.WP_URL || 'https://wordpress-production-754b3e08.up.railway.app').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
async function put(o) {
  if (DRY) { console.log('would import', o.site, o.type, o.slug); return; }
  for (let i = 0; i < 5; i++) {
    const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify(o) });
    const t = await r.text(); if (r.ok) { console.log('ok', o.site, o.type, o.slug); return; }
    console.log('retry', o.slug, r.status, t.slice(0, 120)); await new Promise((res) => setTimeout(res, 4000 * (i + 1)));
  }
  throw new Error('failed ' + o.slug);
}
const about = (site, title, html) => put({ site, type: 'page', slug: 'about', title, content: html, status: 'publish' });
(async () => {
  await about('whiterabbit', 'About White Rabbit', '<p class="ih-note">White Rabbit is published only on Friday the 13th.</p><p>It is a publication of Inkhorn Press, the nonprofit press that also publishes Inkhorn Review and Muse. Issue No. 1 comes out on Friday, August 13, 2027.</p><p>Details coming soon. Sign up below and we will tell you when the first call for work opens.</p>');
  await about('muse', 'About Muse', '<p class="ih-note">A literary magazine chosen by its readers and writers.</p><p>Post a poem or a short piece of prose. Readers see new work without the names and vote for what is published each season. Muse is a publication of Inkhorn Press.</p><p>Create an account to post and vote, or just read the issues.</p>');
  await about('lifeonwords', 'About Life on Words', '<p class="ih-note">Conversations with writers about their work and their lives.</p><p>Life on Words with Terry Heath is a podcast. Terry Heath hosts; it is produced by Follow the Rabbit LLC. Every episode comes with a full transcript, and the guests are listed on the Guests page.</p><p>Follow in any podcast app with the feed at <a href="/lifeonwords/podcast/rss/">the episode feed</a>, or get a note when a new episode is out by signing up for email below.</p>');
  // a cover image per publication for the hub cards when there is no issue cover yet (from art we already have)
  await put({ site: 'whiterabbit', type: 'page', slug: 'cover', title: 'Cover', content: '', status: 'draft', thumbnail_url: 'https://inkhorn.press/content/images/2026/11/tenniel-white-rabbit-1865.jpg' });
  const muse = path.join(process.env.HOME, 'muse/docs/muse-cover.png');
  if (fs.existsSync(muse)) await put({ site: 'muse', type: 'page', slug: 'cover', title: 'Cover', content: '', status: 'draft', thumbnail_b64: fs.readFileSync(muse).toString('base64'), thumbnail_name: 'muse-cover.png' });
  // the old Support page is the Donate page now (/support redirects to /donate)
  await put({ site: 'hub', type: 'page', slug: 'support', title: 'Support the press', content: '<p>See Donate.</p>', status: 'draft' });
  // WordPress sample content: set aside as drafts
  await put({ site: 'terryheath', type: 'post', slug: 'hello-world', title: 'Hello world!', content: '<p>Welcome to WordPress.</p>', status: 'draft' });
  for (const s of ['hub', 'review', 'whiterabbit', 'muse', 'terryheath', 'lifeonwords']) await put({ site: s, type: 'page', slug: 'sample-page', title: 'Sample Page', content: '<p>Sample.</p>', status: 'draft' }).catch(() => {});
})().catch((e) => { console.error(e.message); process.exit(1); });
