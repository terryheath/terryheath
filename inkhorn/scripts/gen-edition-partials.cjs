#!/usr/bin/env node
// Generates inkhorn/theme/partials/editions/{autumn,winter}-2026.hbs from inkhorn/data/editions-2026.json.
// One literal {{#get}} per line (published post -> linked line; otherwise unlinked fallback; {{else}} of {{#get}} does not fire, so it uses as |found| + {{#if}}).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const backup = JSON.parse(fs.readFileSync(path.join(root, 'backups', '2026-10-09', 'posts.json'), 'utf8'));
const slugFor = (r) => r.slug || (backup.find((p) => p.status === 'scheduled' && p.title === r.match_scheduled_by_title) || {}).slug;

// Returns { 'autumn-2026': '<hbs>', 'winter-2026': '<hbs>' } for the given pieces (the editions-2026.json "pieces" array).
function generate(pieces) {
  const out = {};
  for (const ed of ['autumn-2026', 'winter-2026']) {
    const lines = pieces.filter((r) => r.edition === ed).sort((a, b) => a.position - b.position).map((r) => {
      const slug = slugFor(r);
      if (!slug) throw new Error('no slug for ' + r.title);
      const attrs = `n="${r.position}" title="${r.title}" byline="${r.author}"`;
      return `{{#get "posts" filter="slug:${slug}" limit="1" as |found|}}{{#if found}}{{#foreach found}}{{> "edition-item" ${attrs} linked="true"}}{{/foreach}}{{else}}{{> "edition-item" ${attrs}}}{{/if}}{{/get}}`;
    });
    out[ed] = `{{!-- Generated from inkhorn/data/editions-2026.json by inkhorn/scripts/gen-edition-partials.cjs. Print order. --}}\n${lines.join('\n')}\n`;
  }
  return out;
}
module.exports = { generate };

if (require.main === module) {
  const pieces = JSON.parse(fs.readFileSync(path.join(root, 'data', 'editions-2026.json'), 'utf8')).pieces;
  for (const [ed, text] of Object.entries(generate(pieces))) {
    fs.writeFileSync(path.join(root, 'theme', 'partials', 'editions', `${ed}.hbs`), text);
    console.log(ed, text.trim().split('\n').length - 1);
  }
}
