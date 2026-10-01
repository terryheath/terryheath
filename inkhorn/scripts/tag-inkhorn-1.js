#!/usr/bin/env node
// inkhorn/scripts/tag-inkhorn-1.js
// One-time setup: create the inkhorn-1 publication tag and apply it.
//
// 1. Reads catalog page inkhorn-review-no-1-autumn-2026 to get its feature_image.
// 2. Creates public tag  slug=inkhorn-1  name="Inkhorn Review No. 1"
//    feature_image taken from the catalog page.
// 3. Appends inkhorn-1 to the catalog page (keeps all existing tags, adds at end).
// 4. Appends inkhorn-1 to each of the 14 content posts (keeps existing tag order).
//
// Sends only tags + updated_at on every write (no post body changes).
//
// Usage:
//   GHOST_API_URL=$(security find-generic-password -s "ghost-url-inkhorn" -w) \
//   GHOST_ADMIN_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w) \
//   node inkhorn/scripts/tag-inkhorn-1.js

import GhostAdminAPI from '@tryghost/admin-api';

const GHOST_API_URL   = process.env.GHOST_API_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;

if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const api = new GhostAdminAPI({
  url:     GHOST_API_URL,
  key:     GHOST_ADMIN_KEY,
  version: 'v5.0',
});

// Posts to tag — slugs only; URL prefixes are just for locating them.
// /autumn-2026/ pieces:
const POST_SLUGS = [
  'the-lobster-tank',
  'five-chairs',
  'every-word-bitter',
  'death-and-the-maiden',
  'the-crow',
  'dance-partner',
  'lineage',
  'a-flight-from-manila',
  'he-thought-i-would-come-back',
  'dead-lines-24-weeks',
  'amalia-and-the-crows',
  'along-with-lemon-and-ginger',
  'twenty-four',
  // /micro/ piece:
  'tolls',
];

const CATALOG_PAGE_SLUG = 'inkhorn-review-no-1-autumn-2026';
const TAG_SLUG          = 'inkhorn-1';
const TAG_NAME          = 'Inkhorn Review No. 1';

async function main() {
  // ── 1. Read catalog page ────────────────────────────────────────────────────
  console.log(`Reading catalog page: ${CATALOG_PAGE_SLUG}…`);
  let catalogPage;
  try {
    catalogPage = await api.pages.read({ slug: CATALOG_PAGE_SLUG }, { include: 'tags' });
  } catch (err) {
    console.error(`Catalog page not found: ${CATALOG_PAGE_SLUG}`);
    console.error(err.message);
    process.exit(1);
  }
  const featureImage = catalogPage.feature_image || null;
  console.log(`  feature_image: ${featureImage || '(none)'}`);

  // ── 2. Create or fetch the inkhorn-1 tag ────────────────────────────────────
  let tag;
  try {
    tag = await api.tags.read({ slug: TAG_SLUG });
    console.log(`Tag "${TAG_SLUG}" already exists (id: ${tag.id}) — will reuse.`);
  } catch {
    // Tag doesn't exist — create it
    console.log(`Creating tag: ${TAG_SLUG} "${TAG_NAME}"…`);
    tag = await api.tags.add({
      slug:          TAG_SLUG,
      name:          TAG_NAME,
      feature_image: featureImage,
      visibility:    'public',
    });
    console.log(`  Created: id=${tag.id}`);
  }

  const tagRef = { id: tag.id };

  // ── 3. Append inkhorn-1 to catalog page ─────────────────────────────────────
  console.log(`\nTagging catalog page: ${CATALOG_PAGE_SLUG}…`);
  const existingPageTags = (catalogPage.tags || []).map(t => ({ id: t.id }));
  const alreadyOnPage = existingPageTags.some(t => t.id === tag.id);
  if (alreadyOnPage) {
    console.log(`  Already tagged — skipping.`);
  } else {
    await api.pages.edit({
      id:         catalogPage.id,
      tags:       [...existingPageTags, tagRef],
      updated_at: catalogPage.updated_at,
    });
    console.log(`  OK`);
  }

  // ── 4. Append inkhorn-1 to each content post ────────────────────────────────
  console.log(`\nTagging ${POST_SLUGS.length} posts…`);
  let updated = 0, skipped = 0, errors = 0;

  for (const slug of POST_SLUGS) {
    let post;
    try {
      post = await api.posts.read({ slug }, { include: 'tags' });
    } catch {
      console.error(`  NOT FOUND: ${slug}`);
      errors++;
      continue;
    }

    const existingTags = (post.tags || []).map(t => ({ id: t.id }));
    const alreadyTagged = existingTags.some(t => t.id === tag.id);
    if (alreadyTagged) {
      console.log(`  SKIP (already tagged): ${post.title}`);
      skipped++;
      continue;
    }

    try {
      await api.posts.edit({
        id:         post.id,
        tags:       [...existingTags, tagRef],
        updated_at: post.updated_at,
      });
      console.log(`  OK: ${post.title}`);
      updated++;
    } catch (err) {
      console.error(`  ERROR: ${post.title} — ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone. ${updated} tagged, ${skipped} already correct, ${errors} errors.`);
  if (errors > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
