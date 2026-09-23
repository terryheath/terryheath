#!/usr/bin/env node
'use strict';

/**
 * patreon-sync — fetch active Patreon supporters and write to Ghost page.
 * Runs daily via Railway cron (0 6 * * * UTC).
 *
 * Required env vars:
 *   PATREON_CREATOR_TOKEN  — Patreon OAuth creator access token
 *   GHOST_API_URL          — Ghost instance root URL (no trailing slash)
 *   GHOST_ADMIN_KEY        — Ghost Admin API key (kid:hex format)
 *
 * Writes (or updates) the Ghost page at slug "patreon-supporters".
 * Skips the Ghost write when the supporter list is unchanged.
 * Never prints token values to stdout.
 */

import https  from 'https';
import crypto from 'crypto';

const PATREON_TOKEN = process.env.PATREON_CREATOR_TOKEN;
const GHOST_URL     = (process.env.GHOST_API_URL  || '').replace(/\/$/, '');
const ADMIN_KEY     = process.env.GHOST_ADMIN_KEY;
const PAGE_SLUG     = 'patreon-supporters';

if (!PATREON_TOKEN) { console.error('Missing PATREON_CREATOR_TOKEN'); process.exit(1); }
if (!GHOST_URL)     { console.error('Missing GHOST_API_URL');         process.exit(1); }
if (!ADMIN_KEY)     { console.error('Missing GHOST_ADMIN_KEY');        process.exit(1); }

// ── Ghost JWT ──────────────────────────────────────────────────────────────

function makeJwt() {
  const [kid, hex] = ADMIN_KEY.split(':');
  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sig     = crypto.createHmac('sha256', Buffer.from(hex, 'hex'))
                    .update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function httpRequest(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(urlStr);
    const data = body != null ? JSON.stringify(body) : null;
    const opts = {
      hostname : url.hostname,
      port     : url.port || 443,
      path     : url.pathname + url.search,
      method,
      headers  : Object.assign(
        { 'User-Agent': 'inkhorn-patreon-sync/1.0', 'Accept-Version': 'v5.0' },
        headers,
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
      )
    };
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', d => { buf += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} ${method} ${urlStr}: ${buf.slice(0, 300)}`));
        }
        try   { resolve(buf ? JSON.parse(buf) : {}); }
        catch { reject(new Error('JSON parse failed for ' + urlStr)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const get  = (url, hdrs)       => httpRequest('GET',  url, hdrs || {});
const post = (url, hdrs, body) => httpRequest('POST', url, hdrs, body);
const put  = (url, hdrs, body) => httpRequest('PUT',  url, hdrs, body);

// ── Patreon ────────────────────────────────────────────────────────────────

async function fetchSupporters() {
  const auth = { Authorization: 'Bearer ' + PATREON_TOKEN };

  // Step 1: resolve campaign ID
  const camps = await get(
    'https://www.patreon.com/api/oauth2/v2/campaigns?fields[campaign]=patron_count',
    auth
  );
  const campaignId = camps.data?.[0]?.id;
  if (!campaignId) throw new Error('No Patreon campaign found for this token');
  console.log('Campaign ID:', campaignId);

  // Step 2: fetch active members — page[count]=1000 covers any realistic campaign
  const membersResp = await get(
    'https://www.patreon.com/api/oauth2/v2/campaigns/' + campaignId + '/members' +
    '?fields[member]=full_name,patron_status,currently_entitled_amount_cents' +
    '&fields[user]=full_name,hide_pledges' +
    '&include=user' +
    '&filter[patron_status]=active_patron' +
    '&page[count]=1000',
    auth
  );

  if (membersResp.meta?.pagination?.cursors?.next) {
    console.warn('Warning: campaign has >1000 active members; only first 1000 fetched');
  }

  // Build user-attribute map from the included sideloaded resources
  const userMap = {};
  for (const item of membersResp.included || []) {
    if (item.type === 'user') userMap[item.id] = item.attributes;
  }

  const members = membersResp.data || [];
  console.log('Active members returned:', members.length);

  const names = [];
  let anonymous = 0;

  for (const member of members) {
    const userId = member.relationships?.user?.data?.id;
    const user   = userId ? userMap[userId] : null;

    // Skip free-tier members (active_patron but paying $0)
    if ((member.attributes?.currently_entitled_amount_cents ?? 0) === 0) continue;

    if (user?.hide_pledges === true) {
      // Patron opted out of public visibility — count toward anonymous total
      anonymous++;
      continue;
    }

    // Prefer the current user.full_name; fall back to the member-level snapshot
    const name = (user?.full_name || member.attributes?.full_name || '').trim();
    if (!name) continue; // no usable name — skip silently, do not count

    names.push(name);
  }

  // Sort by surname (last whitespace-delimited token), then full name as tiebreak
  names.sort((a, b) => {
    const la = a.split(' ').pop().toLowerCase();
    const lb = b.split(' ').pop().toLowerCase();
    return la !== lb ? (la < lb ? -1 : 1)
                     : a.toLowerCase().localeCompare(b.toLowerCase());
  });

  console.log('Named:', names.length, '| Anonymous:', anonymous);
  return { names, anonymous };
}

// ── Ghost page storage ─────────────────────────────────────────────────────

function buildGhostHtml(data) {
  // Store as data-attributes on a <div>. Ghost's Content API strips <script> tags
  // but passes HTML card <div> elements through untouched.
  const namesEncoded = JSON.stringify(data.names)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return '<!--kg-card-begin: html-->' +
    `<div id="ih-patron-data" data-names="${namesEncoded}" data-anonymous="${data.anonymous}"></div>` +
    '<!--kg-card-end: html-->';
}

function extractStoredData(html) {
  if (!html) return null;
  const divM = html.match(/<div[^>]+id="ih-patron-data"([^>]*)>/);
  if (!divM) return null;
  const tag   = divM[0];
  const namesM = tag.match(/data-names="([^"]*)"/);
  const anonM  = tag.match(/data-anonymous="(\d+)"/);
  if (!namesM || !anonM) return null;
  try {
    const names = JSON.parse(namesM[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    return { names, anonymous: parseInt(anonM[1]) || 0 };
  } catch { return null; }
}

async function getExistingPage() {
  const resp = await get(
    GHOST_URL + '/ghost/api/admin/pages/?filter=slug:' + PAGE_SLUG +
    '&fields=id,html,updated_at',
    { Authorization: 'Ghost ' + makeJwt() }
  );
  return resp.pages?.[0] ?? null;
}

async function upsertGhostPage(existing, html) {
  const jwt = makeJwt();
  const pageData = {
    title             : 'Patreon Supporters',
    slug              : PAGE_SLUG,
    status            : 'published',
    visibility        : 'public',
    featured          : false,
    html,
    tags              : [{ name: '#patreon' }],
    codeinjection_head: '<meta name="robots" content="noindex,nofollow">'
  };

  if (existing) {
    await put(
      GHOST_URL + '/ghost/api/admin/pages/' + existing.id + '/',
      { Authorization: 'Ghost ' + jwt },
      { pages: [Object.assign({}, pageData, { updated_at: existing.updated_at })] }
    );
    console.log('Ghost page updated:', PAGE_SLUG);
  } else {
    await post(
      GHOST_URL + '/ghost/api/admin/pages/',
      { Authorization: 'Ghost ' + jwt },
      { pages: [pageData] }
    );
    console.log('Ghost page created:', PAGE_SLUG);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const data     = await fetchSupporters();
  const newHtml  = buildGhostHtml(data);
  const existing = await getExistingPage();

  if (existing) {
    const stored = extractStoredData(existing.html);
    if (stored &&
        JSON.stringify(stored.names) === JSON.stringify(data.names) &&
        stored.anonymous === data.anonymous) {
      console.log('No change — Ghost page unchanged.');
      return;
    }
  }

  await upsertGhostPage(existing, newHtml);
}

main().catch(err => { console.error(err.message); process.exit(1); });
