#!/usr/bin/env node
// One-off 2026-10-09: Bill Garvey rename + contributor bios. Old descriptions are logged before each change.
const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const getKey = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const api = new GhostAdminAPI({ url: getKey('ghost-url-inkhorn'), key: getKey('ghost-admin-inkhorn'), version: 'v5.0' });
const LOG = path.join(__dirname, '..', 'build-log.md');
const log = (l) => { console.log(l); fs.appendFileSync(LOG, `- ${l}\n`); };
const bios = {
  'Bill Garvey': 'Bill Garvey has two collections of poetry with DarkWinter Press; The basement on Biella, 2023 and Leaning in the same direction, 2026. His poems have appeared in The Queen’s Quarterly, Rattle, Cimarron Review, One Art, SLANT, The New Quarterly and others.',
  'Bull Garlington': 'Bull Garlington\'s stories and poems have appeared in Apricity, Dark Horse, Thin Skin, Mister Bull, the Dead Mule School of Southern Literature and more.',
  'Cecil Morris': 'Cecil Morris’s debut poetry collection, At Work in the Garden of Possibilities, came out from Main Street Rag in 2025. His second collection, Daughter Lost and Found and Lost, comes out from Kelsay Books in 2027. He has poems in 2River View, Common Ground Review, Rust + Moth, and elsewhere.',
  'Justin Ocelot': 'Justin Ocelot writes speculative short fiction. His work can be found in Merganser Magazine, Nightshades Magazine, and Zooscape.',
  'Sarah Parfitt': 'Sarah Parfitt has been published in print and online. Sarah has a PhD in Creative Writing, and currently teaches writing at the University of Warwick, UK. Her novel THE AMNICOLISTS - shortlisted for the 2025 Bridport Prize - publishes in spring 2027. “Basins” is an Inkhorn Review 2026 nominee for Best Microfiction and Best Small Fictions.',
  'Emily Thompson-Mueller': 'Emily Thompson-Mueller is a recovering horse girl from Louisiana. Her collection Ugly Good won the 2021 Studio in the Woods Residency Award, and she pursues an MFA at Bennington Writing Seminars.',
  'Goran Hodžić': 'Goran Hodžić paints from his studio in the scenic Puget Sound area. He works primarily in watercolor, and was a first-place winner in the 2026 Helen Norris Show.',
};
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function all(r, o) { const out = []; for (let p = 1; ; p++) { const b = await api[r].browse({ ...o, limit: 100, page: p }); out.push(...b); if (b.length < 100) break; } return out; }

(async () => {
  let tags = await all('tags', {});
  // 1. rename
  const wg = tags.find((t) => t.name === 'William Garvey');
  if (wg) {
    await api.tags.edit({ id: wg.id, updated_at: wg.updated_at, name: 'Bill Garvey' });
    log(`Garvey: renamed tag "William Garvey" -> "Bill Garvey" (${wg.id}, slug ${wg.slug} kept)`);
  }
  const [mirror] = await api.posts.browse({ filter: 'slug:mirror' });
  if (mirror.custom_excerpt !== 'by Bill Garvey') {
    await api.posts.edit({ id: mirror.id, updated_at: mirror.updated_at, custom_excerpt: 'by Bill Garvey' });
    log(`Garvey: Mirror post (${mirror.id}) custom_excerpt "${mirror.custom_excerpt}" -> "by Bill Garvey"`);
  }
  // scan everything
  const hits = [];
  for (const [r, o] of [['posts', { formats: 'html,lexical', filter: 'status:[draft,published,scheduled,sent]' }], ['pages', { formats: 'html,lexical', filter: 'status:[draft,published,scheduled]' }], ['tags', {}]]) {
    for (const x of await all(r, o)) if (JSON.stringify(x).includes('William Garvey')) hits.push(`${r}:${x.slug}`);
  }
  log(`Garvey: Ghost scan for "William Garvey" after the change found: ${hits.length ? hits.join(', ') : 'nothing'}`);

  // 2. bios
  tags = await all('tags', {});
  for (const [name, text] of Object.entries(bios)) {
    let t = tags.find((x) => x.name === name);
    if (!t) t = tags.find((x) => fold(x.name) === fold(name));
    if (!t) { log(`Bio: no tag found for "${name}"; nothing created`); continue; }
    if (t.description === text) { console.log('already set', name); continue; }
    log(`Bio: ${name} (${t.slug}) old description: ${JSON.stringify(t.description)}`);
    await api.tags.edit({ id: t.id, updated_at: t.updated_at, description: text });
    log(`Bio: ${name} (${t.slug}, tag name "${t.name}") description set`);
  }
})().catch((e) => { console.error(e.message || e, JSON.stringify(e.context || '')); process.exit(1); });
