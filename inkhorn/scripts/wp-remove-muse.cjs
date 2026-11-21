#!/usr/bin/env node
/** Muse moved to Follow the Rabbit LLC (2026-11-20): take Muse out of the Inkhorn Press Submit page and the White Rabbit About page. Idempotent. */
const { execSync } = require('child_process');
const WP = (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
async function put(o) {
  const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify(o) });
  console.log(r.status, o.site, o.slug);
}
(async () => {
  const sub = (await (await fetch(WP + '/wp-json/wp/v2/pages?slug=submit&context=view&_fields=title,content')).json())[0];
  let c = sub.content.rendered;
  const a = c.indexOf('<h2>Muse</h2>');
  if (a >= 0) { const b = c.indexOf('</p>', c.indexOf('Post on Muse')) + 4; c = c.slice(0, a) + c.slice(b); }
  await put({ site: 'hub', type: 'page', slug: 'submit', title: 'Submit your work', content: c.trim(), status: 'publish' });
  const wr = (await (await fetch(WP + '/whiterabbit/wp-json/wp/v2/pages?slug=about&_fields=content')).json())[0].content.rendered
    .replace('also publishes Inkhorn Review and Muse.', 'also publishes Inkhorn Review.');
  await put({ site: 'whiterabbit', type: 'page', slug: 'about', title: 'About White Rabbit', content: wr.trim(), status: 'publish' });
})();
