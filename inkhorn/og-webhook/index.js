'use strict';
const http   = require('http');
const crypto = require('crypto');

const PORT          = parseInt(process.env.PORT || '8080', 10);
const GHOST_URL     = (process.env.GHOST_URL || 'https://accelerated-basilisk.pikapod.net').replace(/\/$/, '');
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET;

if (!GHOST_ADMIN_KEY) { console.error('FATAL: GHOST_ADMIN_KEY not set'); process.exit(1); }
if (!WEBHOOK_SECRET)  { console.error('FATAL: WEBHOOK_SECRET not set');  process.exit(1); }

const [kid, hex] = GHOST_ADMIN_KEY.split(':');

function makeToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const s = crypto.createHmac('sha256', Buffer.from(hex, 'hex')).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

function adminHeaders() {
  return { Authorization: `Ghost ${makeToken()}`, 'Content-Type': 'application/json' };
}

// Verify X-Ghost-Signature: sha256=<hex>, t=<timestamp>
// Signed content: rawBody + timestamp (concatenated strings)
function verifySignature(rawBody, header) {
  const parts = {};
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    parts[k] = v;
  }
  if (!parts.sha256 || !parts.t) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody + parts.t)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(parts.sha256, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false; // buffer length mismatch = invalid hex
  }
}

async function setOgImagesForTag(tagSlug) {
  // Fetch the tag and its feature_image from the Admin API
  const tr = await fetch(`${GHOST_URL}/ghost/api/admin/tags/slug/${tagSlug}/`, { headers: adminHeaders() });
  if (!tr.ok) { console.error(`Tag not found: ${tagSlug} (${tr.status})`); return; }
  const tag = (await tr.json()).tags[0];
  const ogImage = tag.feature_image;

  if (!ogImage) {
    console.log(`Tag "${tagSlug}" has no cover image — skipping og_image update`);
    return;
  }
  console.log(`Tag: ${tag.name}  cover: ${ogImage}`);

  // Fetch all posts with this tag
  const params = new URLSearchParams({
    filter: `tag:${tagSlug}`,
    fields: 'id,title,og_image,updated_at',
    limit: 'all',
  });
  const pr = await fetch(`${GHOST_URL}/ghost/api/admin/posts/?${params}`, { headers: adminHeaders() });
  if (!pr.ok) { console.error(`Failed to fetch posts for ${tagSlug}: ${pr.status}`); return; }
  const posts = (await pr.json()).posts || [];
  console.log(`${posts.length} post(s) tagged ${tagSlug}`);

  let updated = 0, skipped = 0, errors = 0;
  for (const post of posts) {
    if (post.og_image === ogImage) { skipped++; continue; }
    const u = await fetch(`${GHOST_URL}/ghost/api/admin/posts/${post.id}/`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ posts: [{ og_image: ogImage, updated_at: post.updated_at }] }),
    });
    if (!u.ok) {
      console.error(`ERROR updating "${post.title}": ${u.status} ${await u.text()}`);
      errors++;
    } else {
      console.log(`OK: ${post.title}`);
      updated++;
    }
  }
  console.log(`Done: ${updated} updated, ${skipped} skipped, ${errors} errors`);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(); return;
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');

    const sigHeader = req.headers['x-ghost-signature'];
    if (!sigHeader || !verifySignature(rawBody, sigHeader)) {
      console.warn('Invalid or missing webhook signature');
      res.writeHead(401); res.end('Unauthorized'); return;
    }

    let payload;
    try { payload = JSON.parse(rawBody); } catch {
      res.writeHead(400); res.end('Bad JSON'); return;
    }

    const post       = payload?.post?.current;
    const primaryTag = post?.primary_tag;

    if (!primaryTag?.slug) {
      console.log(`"${post?.title}" has no primary tag — skipping`);
      res.writeHead(200); res.end('ok'); return;
    }

    console.log(`post.published: "${post.title}"  primary tag: ${primaryTag.slug}`);

    try {
      await setOgImagesForTag(primaryTag.slug);
    } catch (err) {
      // Log but return 200 — missing data is not a retryable failure
      console.error('setOgImagesForTag error:', err.message || err);
    }

    res.writeHead(200); res.end('ok');
  });
});

server.listen(PORT, () => console.log(`inkhorn-og-webhook listening on :${PORT}`));
