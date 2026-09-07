#!/usr/bin/env node
/**
 * Set og_image on all posts in an Inkhorn Review issue.
 *
 * Each post in the issue gets its og_image set to the issue tag's
 * feature_image. This makes social sharing previews show the issue
 * cover art regardless of whether the post has a feature image.
 * The value is stored on the post record permanently — future issues
 * do not overwrite it.
 *
 * Usage:
 *   node inkhorn/set-og-images.js <issue-slug>
 *
 * Example:
 *   node inkhorn/set-og-images.js autumn-2026
 *
 * Credentials come from macOS Keychain automatically.
 * Run after the issue tag's feature_image is set in Ghost Admin.
 */

const crypto = require('crypto');
const { execSync } = require('child_process');

const issueSlug = process.argv[2];
if (!issueSlug) {
  console.error('Usage: node inkhorn/set-og-images.js <issue-slug>');
  console.error('Example: node inkhorn/set-og-images.js autumn-2026');
  process.exit(1);
}

function getKey(service) {
  return execSync(`security find-generic-password -s "${service}" -w`,
    { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
}

const ADMIN_KEY = getKey('ghost-admin-inkhorn');
const GHOST_URL = getKey('ghost-url-inkhorn').replace(/\/$/, '');
const [kid, hex] = ADMIN_KEY.split(':');

function makeToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const s = crypto.createHmac('sha256', Buffer.from(hex, 'hex')).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function headers() {
  return { Authorization: `Ghost ${makeToken()}`, 'Content-Type': 'application/json' };
}

async function main() {
  // 1. Fetch the issue tag and its feature_image
  console.log(`Fetching tag: ${issueSlug}...`);
  const tr = await fetch(`${GHOST_URL}/ghost/api/admin/tags/slug/${issueSlug}/`, { headers: headers() });
  if (!tr.ok) throw new Error(`Tag not found: ${issueSlug} (${tr.status})`);
  const td = await tr.json();
  const tag = td.tags[0];
  const ogImage = tag.feature_image;

  if (!ogImage) {
    console.error(`"${issueSlug}" tag has no cover image. To fix: Ghost Admin → Tags → ${tag.name} → upload a cover image, then re-run.`);
    process.exit(1);
  }
  console.log(`Issue: ${tag.name}`);
  console.log(`og_image will be set to: ${ogImage}\n`);

  // 2. Fetch all posts in the issue (published + scheduled)
  const params = new URLSearchParams({
    filter: `tag:${issueSlug}`,
    fields: 'id,title,status,og_image,updated_at',
    limit: 'all',
  });
  const pr = await fetch(`${GHOST_URL}/ghost/api/admin/posts/?${params}`, { headers: headers() });
  if (!pr.ok) throw new Error(`Failed to fetch posts: ${pr.status}`);
  const pd = await pr.json();
  const posts = pd.posts || [];
  console.log(`Found ${posts.length} posts tagged ${issueSlug}\n`);

  // 3. Update each post
  let updated = 0, skipped = 0, errors = 0;
  for (const post of posts) {
    if (post.og_image === ogImage) {
      console.log(`  SKIP (already set): ${post.title}`);
      skipped++;
      continue;
    }
    const u = await fetch(`${GHOST_URL}/ghost/api/admin/posts/${post.id}/`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ posts: [{ og_image: ogImage, updated_at: post.updated_at }] }),
    });
    if (!u.ok) {
      console.log(`  ERROR: ${post.title} — ${u.status} ${await u.text()}`);
      errors++;
      continue;
    }
    const was = post.og_image ? `was: ${post.og_image}` : 'was: (none)';
    console.log(`  OK  ${post.title}  [${was}]`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} already correct, ${errors} errors.`);

  if (errors > 0) process.exit(1);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
