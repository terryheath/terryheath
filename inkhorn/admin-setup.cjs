#!/usr/bin/env node
// admin-setup.js — One-time Ghost Admin API setup for the Inkhorn theme build.
// Creates the Autumn 2026 catalog page and writes the season artwork credit
// to the autumn-2026 tag's codeinjection_head.
// Run: node inkhorn/admin-setup.js
// Credentials read from macOS Keychain (ghost-url-inkhorn, ghost-admin-inkhorn).
'use strict';
const { execSync } = require('child_process');
const crypto = require('crypto');

function getKeychain(service) {
  return execSync(`security find-generic-password -s "${service}" -w`).toString().trim();
}

const GHOST_URL  = getKeychain('ghost-url-inkhorn');
const ADMIN_KEY  = getKeychain('ghost-admin-inkhorn');
const [kid, hex] = ADMIN_KEY.split(':');

function buildJWT() {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const s = crypto.createHmac('sha256', Buffer.from(hex, 'hex')).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

function headers() {
  return { Authorization: `Ghost ${buildJWT()}`, 'Content-Type': 'application/json' };
}

async function run() {
  // ── 1. Check / create catalog page ────────────────────────────────────────
  console.log('\n── Catalog page ──');

  // Check if it already exists (any page tagged hash-catalog)
  const existing = await fetch(
    `${GHOST_URL}/ghost/api/admin/pages/?filter=tag:hash-catalog&fields=id,slug,title,status&limit=50`,
    { headers: headers() }
  );
  const existingData = await existing.json();
  const pages = existingData.pages || [];
  if (pages.length > 0) {
    console.log('Existing catalog page(s):');
    for (const p of pages) console.log(`  ${p.status}  ${p.slug}  "${p.title}"`);
    console.log('Skipping creation — delete existing page first if you want to recreate.');
  } else {
    // Contents HTML — wrapped in kg-card so Ghost preserves it
    const contentsHtml = `<!--kg-card-begin: html-->
<div class="ih-contents-genre-group">
  <div class="ih-contents-genre-head">Poetry</div>
  <div class="ih-contents-item">Veronica Tucker, <i>The Lobster Tank</i></div>
  <div class="ih-contents-item">Patricia Russo, <i>Every Word Bitter</i></div>
  <div class="ih-contents-item">L.M. Scarpitto, <i>The Crow</i></div>
  <div class="ih-contents-item">Rikki Santer, <i>Lineage</i></div>
  <div class="ih-contents-item">Robin Kathaas, <i>Dead Lines (24 Weeks)</i></div>
  <div class="ih-contents-item">Jackie McClure, <i>Along with Lemon and Ginger</i></div>
</div>
<div class="ih-contents-genre-group">
  <div class="ih-contents-genre-head">Fiction</div>
  <div class="ih-contents-item">Allyson Petrek, <i>Tolls</i></div>
  <div class="ih-contents-item">Amanda Vega, <i>Five Chairs</i></div>
  <div class="ih-contents-item">J. A. Keefe, <i>Death and the Maiden</i></div>
  <div class="ih-contents-item">Terry Sanville, <i>Dance Partner</i></div>
  <div class="ih-contents-item">Mark Sabourin, <i>A Flight from Manila</i></div>
  <div class="ih-contents-item">Alyse LeValley, <i>Amalia and the Crows</i></div>
</div>
<!--kg-card-end: html-->`;

    // ih-book JSON in codeinjection_head
    const codeHead = `<script type="application/json" id="ih-book">{"statusLabel":"The Print Edition \u00b7 Coming October","coverPrice":12,"buyUrl":"#","isbn":"","ebookLinks":{}}<\/script>`;

    const body = {
      pages: [{
        title: 'Inkhorn Review No.\u00a01 \u00b7 Autumn 2026',
        status: 'published',
        featured: true,
        custom_excerpt: 'What it costs to be seen, and what it costs not to be. Twelve pieces, in print for the first time.',
        codeinjection_head: codeHead,
        html: contentsHtml,
        tags: [{ name: '#catalog' }],
        visibility: 'public',
      }]
    };

    const resp = await fetch(`${GHOST_URL}/ghost/api/admin/pages/`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.pages && data.pages[0]) {
      const p = data.pages[0];
      console.log(`Created: ${p.id}  /${p.slug}/  "${p.title}"  status=${p.status}`);
    } else {
      console.error('ERROR creating page:', JSON.stringify(data).slice(0, 400));
      process.exit(1);
    }
  }

  // ── 2. Write autumn-2026 artwork credit to season tag ─────────────────────
  console.log('\n── Autumn 2026 artwork credit ──');

  const artHtml = `<script type="text/html" id="ih-season-art"><p class="ih-season-credit">Artwork: Goran Hodzic</p></script>`;

  const tagResp = await fetch(
    `${GHOST_URL}/ghost/api/admin/tags/slug/autumn-2026/`,
    { headers: headers() }
  );
  if (!tagResp.ok) {
    console.error(`Could not fetch autumn-2026 tag: ${tagResp.status}`);
    process.exit(1);
  }
  const tagData = await tagResp.json();
  const tag = tagData.tags && tagData.tags[0];
  if (!tag) { console.error('Tag not found'); process.exit(1); }

  if ((tag.codeinjection_head || '') === artHtml) {
    console.log('autumn-2026 artwork credit already set — skipping.');
  } else {
    const putResp = await fetch(`${GHOST_URL}/ghost/api/admin/tags/${tag.id}/`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        tags: [{ id: tag.id, codeinjection_head: artHtml, updated_at: tag.updated_at }]
      }),
    });
    if (!putResp.ok) {
      const err = await putResp.text();
      console.error(`ERROR updating autumn-2026 tag: ${putResp.status} — ${err.slice(0, 300)}`);
      process.exit(1);
    }
    console.log('autumn-2026 codeinjection_head updated with artwork credit.');
  }

  console.log('\nDone.');
}

run().catch(err => { console.error(err); process.exit(1); });
