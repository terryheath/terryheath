#!/usr/bin/env node
// inkhorn/welcome.js — weekly refresh of the free-member welcome flow
//
// Rewrites two HTML cards in the Ghost "Free member welcome flow" automation:
//   <!--welcome:archive-->  (email 2) the next two unused journal pieces
//   <!--welcome:podcast-->  (email 3) the newest unused podcast episode
// Everything else in the automation is sent back exactly as read.
//
// Reading and writing the automation needs a staff access token
// (GHOST_STAFF_TOKEN); posts and tags use the integration key.
// A post placed in a block gets the internal tag #welcome-used and is never
// selected again.
//
// Runs from digest.js on the same schedule, or alone: `node inkhorn/welcome.js`
// (DRY_RUN=1 prints what it would write and changes nothing).

import GhostAdminAPI from '@tryghost/admin-api';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { esc, itemRow } from './digest-html.js';

const AUTOMATION_SLUG = 'member-welcome-email-free';
const ARCHIVE_MARKER  = '<!--welcome:archive-->';
const PODCAST_MARKER  = '<!--welcome:podcast-->';
const USED_NAME       = '#welcome-used';
const USED_SLUG       = 'hash-welcome-used';
const GENRES          = ['fiction', 'nonfiction', 'poetry', 'micro'];
const POST_FIELDS     = 'id,title,slug,url,custom_excerpt,feature_image,published_at,updated_at,status,visibility';

const HERE = dirname(fileURLToPath(import.meta.url));

function signJWT(key) {
  const [kid, secret] = key.split(':');
  const iat = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat, exp: iat + 300, aud: '/admin/' })).toString('base64url');
  const sig = createHmac('sha256', Buffer.from(secret, 'hex')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ── Selection ────────────────────────────────────────────────────────────────

function loadRunningOrder() {
  const { pieces } = JSON.parse(readFileSync(join(HERE, 'data', 'editions-2026.json'), 'utf8'));
  const bySlug = new Map();
  const byTitle = new Map();
  for (const p of pieces) {
    const info = { edition: p.edition, position: p.position };
    if (p.slug) bySlug.set(p.slug, info);
    byTitle.set(p.title.trim().toLowerCase(), info);
  }
  return (post) => bySlug.get(post.slug) || byTitle.get((post.title || '').trim().toLowerCase()) || null;
}

// All published, public journal pieces (used or not), tags included.
async function fetchPieces(api) {
  return api.posts.browse({
    filter: `status:published+visibility:public+tag:[${GENRES.join(',')}]`,
    include: 'tags',
    fields: POST_FIELDS,
    order: 'published_at desc',
    limit: 'all',
  });
}

const isUsed = (post) => (post.tags || []).some((t) => t.slug === USED_SLUG);

function pickArchive(pieces, orderOf) {
  const tagged = pieces.map((p) => ({ post: p, order: orderOf(p) }));

  // Edition rank: most recent publish date among the edition's published pieces.
  const newest = new Map();
  for (const { post, order } of tagged) {
    if (!order) continue;
    const t = new Date(post.published_at).getTime();
    if (!newest.has(order.edition) || t > newest.get(order.edition)) newest.set(order.edition, t);
  }

  const unused = tagged.filter(({ post }) => !isUsed(post));
  const inEdition = unused
    .filter((x) => x.order)
    .sort((a, b) =>
      (newest.get(b.order.edition) - newest.get(a.order.edition)) ||
      (a.order.position - b.order.position));
  const noOrder = unused
    .filter((x) => !x.order)
    .sort((a, b) => new Date(b.post.published_at) - new Date(a.post.published_at));

  return [...inEdition, ...noOrder].slice(0, 2).map((x) => x.post);
}

async function pickPodcast(api) {
  const eps = await api.posts.browse({
    filter: `primary_tag:podcast+status:published+tag:-${USED_SLUG}`,
    include: 'tags',
    fields: POST_FIELDS,
    order: 'published_at desc',
    limit: 1,
  });
  return eps[0] || null;
}

// ── Rendering ────────────────────────────────────────────────────────────────

// Always the public site URL, never the PikaPod host.
function publicUrl(post, siteUrl) {
  return siteUrl + new URL(post.url).pathname;
}

function renderArchive(posts, siteUrl) {
  return ARCHIVE_MARKER + '\n' +
    posts.map((p) => itemRow({ title: p.title, custom_excerpt: p.custom_excerpt, url: publicUrl(p, siteUrl) })).join('');
}

function renderPodcast(post, siteUrl) {
  const url = publicUrl(post, siteUrl);
  return PODCAST_MARKER + '\n' +
    itemRow({ title: post.title, feature_image: post.feature_image, url }, { thumb: true }) +
    `<p style="margin:0 0 10px;font-size:15px;line-height:1.4"><a href="${esc(url)}" ` +
    `style="color:#1a1a1a;font-weight:700;text-decoration:none">Listen to the episode &rarr;</a></p>\n`;
}

// ── Automation read / write (staff token) ────────────────────────────────────

async function staffFetch(ghostApiUrl, token, path, init = {}) {
  const res = await fetch(`${ghostApiUrl}/ghost/api/admin${path}`, {
    ...init,
    headers: { Authorization: `Ghost ${signJWT(token)}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function readAutomation(ghostApiUrl, token) {
  const list = await staffFetch(ghostApiUrl, token, '/automations/');
  const row = list.automations.find((a) => a.slug === AUTOMATION_SLUG);
  if (!row) throw new Error(`automation ${AUTOMATION_SLUG} not found`);
  const full = await staffFetch(ghostApiUrl, token, `/automations/${row.id}/`);
  return full.automations[0];
}

// Finds the html card whose content starts with the marker. Returns
// { action, lexical, node } or null. Exactly one card may match.
function findCard(automation, marker) {
  const hits = [];
  for (const action of automation.actions) {
    if (action.type !== 'send_email') continue;
    const lexical = JSON.parse(action.data.email_lexical);
    for (const node of lexical.root.children) {
      if (node.type === 'html' && typeof node.html === 'string' && node.html.trimStart().startsWith(marker)) {
        hits.push({ action, lexical, node });
      }
    }
  }
  if (hits.length !== 1) throw new Error(`expected exactly one ${marker} card, found ${hits.length}`);
  return hits[0];
}

// ── Used tag ─────────────────────────────────────────────────────────────────

async function usedTagRef(api) {
  try {
    const t = await api.tags.read({ slug: USED_SLUG });
    return { id: t.id };
  } catch {
    return { name: USED_NAME };
  }
}

async function markUsed(api, post, ref) {
  const tags = [...(post.tags || []).map((t) => ({ id: t.id })), ref];
  await api.posts.edit({ id: post.id, updated_at: post.updated_at, tags });
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runWelcome({ api, ghostApiUrl, siteUrl, dryRun = false }) {
  const token = process.env.GHOST_STAFF_TOKEN;
  if (!token) throw new Error('GHOST_STAFF_TOKEN is required');

  console.log('\n── Welcome flow ──');
  const automation = await readAutomation(ghostApiUrl, token);
  const archiveCard = findCard(automation, ARCHIVE_MARKER);
  const podcastCard = findCard(automation, PODCAST_MARKER);

  const placements = []; // { block, html, posts }

  const pieces = await fetchPieces(api);
  const archivePosts = pickArchive(pieces, loadRunningOrder());
  if (archivePosts.length < 2) {
    console.log(`Archive block: ${archivePosts.length} unused piece(s) — left as is.`);
  } else {
    placements.push({ block: 'archive', card: archiveCard, html: renderArchive(archivePosts, siteUrl), posts: archivePosts });
  }

  const episode = await pickPodcast(api);
  if (!episode) {
    console.log('Podcast block: no unused episode — left as is.');
  } else {
    placements.push({ block: 'podcast', card: podcastCard, html: renderPodcast(episode, siteUrl), posts: [episode] });
  }

  for (const p of placements) {
    console.log(`${p.block}: ${p.posts.map((x) => `"${x.title}"`).join(', ')}`);
  }

  const changed = placements.filter((p) => p.card.node.html !== p.html);
  if (changed.length) {
    if (dryRun) {
      console.log('[DRY RUN] would write:', changed.map((p) => p.block).join(', '));
      for (const p of changed) console.log(p.html);
      return;
    }
    for (const p of changed) {
      p.card.node.html = p.html;
      p.card.action.data.email_lexical = JSON.stringify(p.card.lexical);
    }
    // The whole graph goes back; only the two card strings differ from the read.
    const body = {
      automations: [{
        status: automation.status,
        actions: automation.actions.map((a) => ({ id: a.id, type: a.type, data: a.data })),
        edges: automation.edges.map((e) => ({ source_action_id: e.source_action_id, target_action_id: e.target_action_id })),
      }],
    };
    await staffFetch(ghostApiUrl, token, `/automations/${automation.id}/`, { method: 'PUT', body: JSON.stringify(body) });
    console.log(`Automation updated (${changed.map((p) => p.block).join(', ')}).`);
  } else {
    console.log('Cards already hold this content — no write.');
  }

  // Only after the automation holds the content: mark the posts as used.
  if (dryRun) return;
  const ref = await usedTagRef(api);
  const failures = [];
  for (const p of placements) {
    for (const post of p.posts) {
      try {
        await markUsed(api, post, ref);
        console.log(`  tagged ${USED_NAME}: "${post.title}"`);
      } catch (err) {
        failures.push(post.title);
        console.error(`  could not tag "${post.title}": ${err.message}`);
      }
    }
  }
  if (failures.length) throw new Error(`placed but not tagged ${USED_NAME}: ${failures.join('; ')}`);
}

// Standalone: node inkhorn/welcome.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { GHOST_API_URL, GHOST_ADMIN_KEY } = process.env;
  if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
    console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
    process.exit(1);
  }
  const api = new GhostAdminAPI({ url: GHOST_API_URL, key: GHOST_ADMIN_KEY, version: 'v5.0' });
  runWelcome({
    api,
    ghostApiUrl: GHOST_API_URL,
    siteUrl: 'https://inkhornreview.com',
    dryRun: process.env.DRY_RUN === '1',
  }).catch((err) => { console.error(err); process.exit(1); });
}
