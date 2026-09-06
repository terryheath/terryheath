#!/usr/bin/env node
/**
 * One-off: find the Elena Taylor post by guid tag and set its feature_image.
 * Runs via GitHub Actions so it has access to GHOST_API_URL + GHOST_ADMIN_KEY.
 *
 * A posts.edit() on a published post with no `newsletter` option does NOT
 * resend email — Ghost only sends on the draft→published transition.
 */

const GhostAdminAPI = require('@tryghost/admin-api');
const path = require('path');

const GUID = 'd140d1f1-457d-4a0e-86fa-1afa3bc1436c';
const HEADSHOT = path.resolve('./headshots/Elena Taylor.jpg');

const api = new GhostAdminAPI({
  url: process.env.GHOST_API_URL,
  key: process.env.GHOST_ADMIN_KEY,
  version: 'v5.0'
});

async function main() {
  // Browse all published posts with tags to find by guid tag name
  let found = null;
  let page = 1;
  while (!found) {
    const posts = await api.posts.browse({
      limit: 100, page,
      fields: 'id,title,status,feature_image,updated_at',
      include: 'tags',
      filter: 'status:[draft,published,scheduled]'
    });
    for (const p of posts) {
      if ((p.tags || []).some(t => t.name === `#rs-${GUID}`)) {
        found = p;
        break;
      }
    }
    if (!posts.meta || !posts.meta.pagination.next) break;
    page = posts.meta.pagination.next;
  }

  if (!found) {
    console.error('Post not found for guid', GUID);
    process.exit(1);
  }
  console.log(`Found: "${found.title}" | status: ${found.status} | current feature_image: ${found.feature_image || '(none)'}`);

  const img = await api.images.upload({ file: HEADSHOT });
  console.log('Uploaded:', img.url);

  // No newsletter option → no email resend
  await api.posts.edit({
    id: found.id,
    feature_image: img.url,
    updated_at: found.updated_at
  });

  console.log('Done. Feature image patched. No email resent.');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
