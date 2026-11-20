#!/usr/bin/env node
/** Terry's second copy update (2026-11-20): stored page text, pieces (missing poems, issue labels, founder letters), Terry's contributor page, "Books mentioned" on every episode. Idempotent. */
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const WP = (process.env.WP_URL || 'https://wordpress-production-754b3e08.up.railway.app').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
async function put(o) {
  const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify(o) });
  const t = await r.text(); console.log(r.status, o.site, o.slug || o.action, t.slice(0, 120)); return t;
}
const live = async (site, slug) => (await (await fetch(`${WP}${site === 'hub' ? '' : '/' + site}/wp-json/wp/v2/pages?slug=${slug}&_fields=content`)).json())[0].content.rendered;
const page = (site, slug, title, html) => put({ site, type: 'page', slug, title, content: html.trim(), status: 'publish' });
(async () => {
  // Hub About
  let a = await live('hub', 'about');
  a = a.replace(/(<h2 id="who-publishes-what">Who publishes what<\/h2>\s*)<p>[\s\S]*?<\/p>/, '$1<p>Terry Heath founded <em>Inkhorn Review</em> in 2026 and edits it. Follow the Rabbit LLC publishes the Autumn and Winter 2026 issues. Inkhorn Press publishes the Review from Spring 2027.</p>')
       .replace(/<p>Every piece is free to read online[\s\S]*?<\/p>/, '<p>Read every piece free online. Join the Inkhorn Review list, and we’ll email you one piece every Sunday.</p>')
       .replace(/(<h2 id="the-editor">The editor<\/h2>\s*)<p>[\s\S]*?<\/p>/, '$1<p>Terry Heath founded and edits Inkhorn Review and hosts <em>Life on Words with Terry Heath</em>. He teaches English at Olympic College in Bremerton, Washington, and founded the BookFolk festival. Several journals have published his poems.</p>')
       .replace(/(<h2 id="submit">Submit<\/h2>\s*)<p>[\s\S]*?<\/p>/, '$1<p>We read all year. Submissions cost $5, refunded when you sign a contributor agreement. Free reading periods run every February, May, August and November. See the <a href="https://inkhorn.press/submissions/" rel="noreferrer">submission guidelines</a>.</p>');
  await page('hub', 'about', 'About Inkhorn Press', a);
  // Submit
  await page('hub', 'submit', 'Submit your work', `<p class="ih-note">Each publication runs its own call. Choose one to open it.</p>
<h2>Inkhorn Review</h2>
<p>Poetry (especially in form), fiction, nonfiction and art.</p>
<ul>
<li>Free reading periods every February, May, August and November: send up to three poems, one flash piece or one prose piece.</li>
<li>Paid call, open all year: $5, refunded when you sign a contributor agreement.</li>
<li>Art: traditional media only. No photography or digital art.</li>
</ul>
<p><a class="ih-btn" href="https://duotrope.com/duosuma/submit/inkhorn-review-iGX4p">Submit to Inkhorn Review</a> Opens the call on Duosuma.</p>
<h2>White Rabbit</h2>
<p>Weird poetry, short prose and art, for Issue No. 1 on Friday, August 13, 2027.</p>
<ul>
<li>Details to come. Join the White Rabbit list, and we’ll tell you when the call opens.</li>
</ul>
<!-- wp:inkhorn/signup {"checked":["white-rabbit"]} /-->`);
  // Events: the sign-up form, Events checked
  let ev = await live('hub', 'events');
  if (!/wp:inkhorn\/signup/.test(ev)) ev = ev.trim() + '\n<!-- wp:inkhorn/signup {"checked":["events"]} /-->';
  await page('hub', 'events', 'Events', ev);
  // Pieces: missing poems, issue labels, founder letters
  const ed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'editions-2026.json'), 'utf8')).pieces;
  const clean = (h) => h.replace(/<p><\/p>\s*/g, '<p>&nbsp;</p>\n'); // keep the blank line between stanzas
  for (const slug of ['i-am-either-hallucinating-this-morning-or-living-it', 'the-dog-had-been-dead-for-years']) {
    const p = ed.find((x) => x.slug === slug);
    await put({ site: 'review', type: 'ih_piece', slug, only_content: true, content: clean(p.html) });
  }
  for (const p of ed.filter((x) => x.edition === 'winter-2026' && x.slug)) await put({ site: 'review', type: 'ih_piece', slug: p.slug, meta_only: true, meta: { ih_issue_label: 'Winter 2026' } });
  for (const slug of ['drive-by-submissions', 'institutionalized']) await put({ site: 'review', type: 'ih_piece', slug, meta_only: true, meta: { ih_letter: 1, ih_contributors: '', ih_author_name: 'Terry Heath' } });
  // Terry is the editor, not a contributor: his contributor page goes to the trash (recoverable); /contributors/terry-heath/ redirects to The editor on About
  await put({ site: 'hub', action: 'trash_post', type: 'ih_contributor', slug: 'terry-heath' });
  // Books mentioned
  const T = (title, author) => ({ title, author });
  const map = {
    'i am providence: the life and times of h.p. lovecraft': T('I Am Providence: The Life and Times of H.P. Lovecraft', 'S. T. Joshi'),
    'the call of cthulhu and other weird stories': T('The Call of Cthulhu and Other Weird Stories', 'H. P. Lovecraft'),
    'dreams of fear poetry of terror and the supernatural': T('Dreams of Fear: Poetry of Terror and the Supernatural'),
    'the assaults of chaos a novel about h. p. lovecraft': T('The Assaults of Chaos: A Novel about H. P. Lovecraft'),
    'honeymoon in jail an h. p. lovecraft, detective novel': T('Honeymoon in Jail: An H. P. Lovecraft, Detective Novel'),
    'the recognition of h. p. lovecraft his rise from obscurity to world renown': T('The Recognition of H. P. Lovecraft: His Rise from Obscurity to World Renown'),
    'the downfall of god: a history of atheism in the west': T('The Downfall of God: A History of Atheism in the West, 2 vols.', 'S. T. Joshi'),
    'under the banner of heaven: a story of violent faith': T('Under the Banner of Heaven: A Story of Violent Faith', 'Jon Krakauer'),
    'time out of time book one: beyond the door': T('Time Out of Time Book One: Beyond the Door'),
    'time out of time book two: the telling stone': T('Time Out of Time Book Two: The Telling Stone'),
    'making a literary life advice for writers and other dreamers': T('Making a Literary Life: Advice for Writers and Other Dreamers'),
    'awesome achievers in science super and strange facts about 12 almost famous history makers': T('Awesome Achievers in Science: Super and Strange Facts about 12 Almost Famous History Makers'),
    'awesome achievers in technology super and strange facts about 12 almost famous history makers': T('Awesome Achievers in Technology: Super and Strange Facts about 12 Almost Famous History Makers'),
    'wayward girls: a novel': T('Wayward Girls: A Novel', 'Susan Wiggs'),
    'the lost and found bookshop a novel': T('The Lost and Found Bookshop: A Novel'),
    'sugar and salt a novel': T('Sugar and Salt: A Novel'),
    'the carrot seed 60th anniversary edition': T('The Carrot Seed: 60th Anniversary Edition'),
  };
  await put({ site: 'lifeonwords', action: 'rewrite_books', map });
})();
