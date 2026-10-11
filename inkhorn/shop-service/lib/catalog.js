'use strict';

// Release times come from the Ghost catalog pages: the page tagged #catalog whose
// ih-book JSON names the sku. A scheduled page releases at its published_at;
// a published page means the title is available now.

const crypto = require('crypto');
const cfg = require('./config');

const TTL = cfg.cacheMs;
let cache = null;
let cacheAt = 0;

function ghostJwt() {
  const [kid, secret] = cfg.ghostAdminKey.split(':');
  const iat = Math.floor(Date.now() / 1000);
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b({ alg: 'HS256', kid, typ: 'JWT' })}.${b({ iat, exp: iat + 300, aud: '/admin/' })}`;
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(head).digest('base64url');
  return `${head}.${sig}`;
}

async function loadPages() {
  const url = `${cfg.ghostUrl}/ghost/api/admin/pages/?filter=${encodeURIComponent('tag:hash-catalog')}` +
    `&limit=all&fields=slug,status,published_at,codeinjection_head`;
  const res = await fetch(url, { headers: { Authorization: `Ghost ${ghostJwt()}` } });
  if (!res.ok) throw new Error(`Ghost catalog lookup failed: ${res.status}`);
  const { pages } = await res.json();
  const bySku = new Map();
  for (const p of pages) {
    const m = (p.codeinjection_head || '').match(/<script id="ih-book"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) continue;
    let sku;
    try { sku = JSON.parse(m[1]).sku; } catch (_) { continue; }
    if (!sku) continue;
    const info = { status: p.status, publishedAt: p.published_at };
    // If several pages carry the same sku, a scheduled one wins
    if (!bySku.has(sku) || info.status === 'scheduled') bySku.set(sku, info);
  }
  return bySku;
}

async function catalog() {
  if (!cfg.ghostUrl || !cfg.ghostAdminKey) return new Map();
  if (cache && Date.now() - cacheAt < TTL) return cache;
  try {
    cache = await loadPages();
    cacheAt = Date.now();
  } catch (err) {
    if (!cache) throw err; // no stale copy: let the caller fail and retry later
    console.error('catalog refresh failed, using stale copy:', err.message);
  }
  return cache;
}

// Date the title releases, or null if it is available now.
// metaReleaseAt (Stripe product metadata release_at) is the fallback when no catalog page carries the sku.
async function releaseAt(sku, metaReleaseAt) {
  const page = (await catalog()).get(sku);
  let date = null;
  if (page) {
    if (page.status === 'scheduled' && page.publishedAt) date = new Date(page.publishedAt);
  } else if (metaReleaseAt) {
    date = new Date(metaReleaseAt);
    if (Number.isNaN(date.getTime())) date = null;
  }
  return date && date.getTime() > Date.now() ? date : null;
}

// Preorder flag: derived from the catalog page when one exists, else the Stripe metadata flag.
async function isPreorder(sku, meta = {}) {
  const page = (await catalog()).get(sku);
  if (page) return page.status === 'scheduled';
  if (meta.release_at) return (await releaseAt(sku, meta.release_at)) !== null;
  return meta.preorder === 'true';
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' });
}

module.exports = { releaseAt, isPreorder, formatDate };
