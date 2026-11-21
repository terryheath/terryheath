#!/usr/bin/env node
/** Terry's supplied wording (2026-11-20) for the stored pages, guest bios and Terry's contributor bio. Idempotent. */
const { execSync } = require('child_process');
const WP = (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
const q = (s) => s.replace(/'/g, '’'); // typographic apostrophes
async function put(o) {
  const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify(o) });
  console.log(r.status, o.site, o.slug);
}
const page = (site, slug, title, html) => put({ site, type: 'page', slug, title, content: html.trim(), status: 'publish' });
async function live(site, slug) { const j = await (await fetch(`${WP}${site === 'hub' ? '' : '/' + site}/wp-json/wp/v2/pages?slug=${slug}&_fields=content`)).json(); return j[0].content.rendered; }
(async () => {
  // Inkhorn Press About: opening, How to read paras 2 and 3
  let a = await live('hub', 'about');
  a = a.replace(/<p><em>Inkhorn Press<\/em> publishes[\s\S]*?<\/p>/, '<p>Inkhorn Press is a nonprofit press. We publish <em>Inkhorn Review</em>, a quarterly of poetry, short prose and art, and <em>White Rabbit</em>, which appears every Friday the 13th. We also run events.</p>')
    .replace(/<p>Print and ebook editions are sold[\s\S]*?<\/p>/, '<p>Buy print and ebook editions in the <a href="/shop/">shop</a>. A <a href="/shop/subscriptions/">Print subscription</a> mails you four issues a year in the U.S. and includes the ebooks. Outside the U.S., subscribe to the ebooks. We price print to cover printing and postage.</p>')
    .replace(/<p>Your <a[^>]*>donations<\/a> help[\s\S]*?<\/p>/, '<p>Your <a href="/donate/">donations</a> cover production and help us pay contributors more.</p>');
  await page('hub', 'about', 'About Inkhorn Press', a);
  // Donate
  const g = 'https://shop.inkhorn.press/donate/checkout?amount=';
  await page('hub', 'donate', 'Donate', `<p class="ih-note">Your gift pays contributors and keeps every journal free online. Inkhorn Press is a 501(c)(3) nonprofit.</p>
<p>Give once</p>
<p>${[10, 25, 50, 100].map((n) => `<a class="ih-btn" href="${g}${n}">$${n}</a>`).join(' ')}</p>
<p>Give monthly on <a href="https://www.patreon.com/cw/inkhornreview" rel="noopener">Patreon</a>.</p>
<p>Questions? Write to <a href="mailto:hello@inkhorn.press">hello@inkhorn.press</a>.</p>`);
  // Events
  let e = await live('hub', 'events');
  e = e.replace('Festivals now; workshops and seminars later.', 'Festivals and readings now. Workshops soon.')
    .replace(/Details coming soon\. Sign up for the Events newsletter below to hear first\./g, 'Details to come. Join the Events list below to hear first.');
  await page('hub', 'events', 'Events', e);
  // Inkhorn Review About
  await page('review', 'about', 'About Inkhorn Review', `<p>Inkhorn Review publishes poetry, fiction and art four times a year. Our poetry leans toward form: we believe meter, rhyme and pattern bring poems to readers who aren’t poets. Our fiction runs from flash to the occasional long story.</p>
<p>Read every piece free online. Each issue also comes out in print and as an ebook on March 1, June 1, September 1 and December 1. Every Sunday, we email one piece from the print issue.</p>
<p>Terry Heath founded the Review in 2026 and edits it. Each year we nominate our strongest work for the Pushcart Prize and other national prizes.</p>
<p>Follow the Rabbit LLC published the Autumn and Winter 2026 issues. Inkhorn Press, a 501(c)(3) nonprofit, publishes the Review from Spring 2027.</p>
<p><a href="/review/submissions/">Submit</a> · <a href="/shop/subscriptions/">Subscribe</a> · <a href="/newsletter/">Get the Sunday email</a></p>`);
  // White Rabbit About
  await page('whiterabbit', 'about', 'About White Rabbit', `<p>White Rabbit publishes weird poetry, short prose and art. It appears every Friday the 13th.</p>
<p>Inkhorn Review celebrates the traditional. White Rabbit celebrates the strange. Issue No. 1 comes out Friday, August 13, 2027, with the first Weird Friday.</p>
<p>Sign up below, and we’ll tell you when the call for work opens.</p>`);
  // Life on Words About
  await page('lifeonwords', 'about', 'About Life on Words', `<p>Terry Heath talks at length with novelists, poets, playwrights, songwriters and publishers. The guests are the experts. Terry is the guide.</p>
<p>Read the full transcript of every episode. Listen on <a href="https://podcasts.apple.com/us/podcast/life-on-words/id6796221237">Apple Podcasts</a>, <a href="https://open.spotify.com/show/033Yk3F8x8QWBLK496Wbqd">Spotify</a> or <a href="/terryheath/podcast/rss/">any podcast app</a>, or sign up below for new-episode emails.</p>
<p>Follow the Rabbit LLC produces Life on Words.</p>`);
  // guest bios
  const bios = {
    'alan-katz': "Alan Katz has written more than 50 books and wrote for The Rosie O'Donnell Show for five years.",
    'aleks-merilo': "Playwright Aleks Merilo wrote Exit 27 and The Widow of Tom's Hill, which ran off-Broadway at 59E59.",
    'allie-millington': 'Allie Millington wrote Olivetti, a middle-grade novel that debuted on the New York Times bestseller list.',
    'ben-rockwood': 'Ben Rockwood and his wife, Tamara, founded Bainbridge Island Press.',
    'christina-braver': 'Christina Braver writes romance novels.',
    'elena-taylor': 'Novelist Elena Taylor spent twenty years in theater as a playwright, director and designer.',
    'kirby-larson': 'Kirby Larson wrote Hattie Big Sky, a Newbery Honor book, and many historical novels for young readers.',
    'maureen-mcquerry': 'Maureen McQuerry writes poetry and novels.',
    's-t-joshi': 'S. T. Joshi has written about H. P. Lovecraft for fifty years.',
    'sheila-roberts': 'Sheila Roberts has written sixty books. Lifetime, Hallmark and Great American Family have made movies from them.',
    'susan-wiggs': 'Susan Wiggs has written more than 60 novels, won three RITA Awards, and hit the New York Times, USA Today and Publishers Weekly bestseller lists.',
  };
  for (const [slug, bio] of Object.entries(bios)) await put({ site: 'lifeonwords', type: 'ih_guest', slug, meta_only: true, meta: { ih_bio: q(bio) } });
  await put({ site: 'hub', type: 'ih_contributor', slug: 'terry-heath', meta_only: true, meta: { ih_bio: 'Terry Heath founded and edits Inkhorn Review and hosts Life on Words with Terry Heath. He teaches English at Olympic College in Washington. Several journals have published his poems.' } });
})();
