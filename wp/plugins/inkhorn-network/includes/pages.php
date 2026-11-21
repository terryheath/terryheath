<?php
namespace Inkhorn;

/**
 * Round 2 of the build list (2026-11-20): search, the shop list, contributor directory, Life on Words and terryheath.com homes,
 * hand-made related links, browser titles, preference links by email, and the /muse/ hand-off.
 * Nothing in this file is site copy: labels, data from existing posts, and marked placeholders only.
 */

/* ---------- which site is which ---------- */

function site_blog_ids($keys) { $o = []; foreach ($keys as $k) { $b = site_blog_id($k); if ($b) { $o[$k] = $b; } } return $o; }
function site_name_of($key) { $s = sites(); return $s[$key]['name'] ?? $key; }

/* ---------- browser titles: "Shop – Inkhorn Press" ---------- */

function view_title($t = '') {
  $site = site()['name']; $v = get_query_var('ih_view');
  $names = ['shop' => t('title.shop', 'Shop'), 'cart' => t('title.cart', 'Cart'), 'order-complete' => t('title.order_complete', 'Order complete'), 'subscriptions' => t('title.subscriptions', 'Subscriptions'), 'newsletter' => t('title.newsletter', 'Newsletter'), 'nl-confirmed' => t('title.newsletter', 'Newsletter'),
    'nl-expired' => t('title.newsletter', 'Newsletter'), 'founder-letter' => t('title.letters', 'Founder’s letters'), 'signin' => t('title.signin', 'Sign in'), 'account' => session_email() ? t('title.account', 'Account') : t('title.signin', 'Sign in'), 'help' => t('title.help', 'Help'), 'start-here' => t('title.start', 'Start here')];
  $sep = t('title.sep', ' – ');
  if (isset($names[$v])) { return $names[$v] . $sep . $site; }
  if ($v === 'book') { $b = book_by_slug(get_query_var('ih_book_slug')); return ($b ? get_the_title($b) : t('title.shop', 'Shop')) . $sep . $site; }
  if (is_404()) { return t('title.404', 'Page not found') . $sep . $site; }
  if (is_search()) { return t('title.search', 'Search') . $sep . $site; }
  if (is_front_page() || is_home()) { return $site; }
  if (is_post_type_archive('ih_contributor')) { return t('title.contributors', 'Contributors') . $sep . $site; }
  if (is_post_type_archive('ih_episode')) { return t('title.episodes', 'Episodes') . $sep . $site; }
  if (is_post_type_archive('ih_guest')) { return t('title.guests', 'Guests') . $sep . $site; }
  if (is_post_type_archive('ih_issue')) { return t('title.archive', 'Archive') . $sep . $site; }
  if (is_post_type_archive('ih_book')) { return t('title.books', 'Books') . $sep . $site; }
  if (is_tax('ih_genre')) { return single_term_title('', false) . $sep . $site; }
  if (is_singular()) { return get_the_title() . $sep . $site; }
  return $site;
}
add_filter('pre_get_document_title', __NAMESPACE__ . '\\view_title', PHP_INT_MAX);
/** The SEO plugin writes the browser title itself: for the views it cannot know (sign-in, shop, help, newsletter and so on) and the directory pages, ours is used and its own branding is not added. */
function view_title_is_ours() { return (bool) get_query_var('ih_view') || is_404() || is_search() || is_post_type_archive() || is_tax('ih_genre'); }
add_filter('the_seo_framework_title_from_generation', function ($t) { return view_title_is_ours() ? view_title($t) : $t; }, 20);
add_filter('the_seo_framework_use_title_branding', function ($use) { return view_title_is_ours() ? false : $use; }, 20);


/* ---------- products: one list for the hub strip and /shop/ ---------- */

/** The books on sale: published, and known to the shop service (so they have a price). If the shop service cannot be reached, every published book. */
function shop_books($limit = 50) {
  $prices = shop_prices();
  $out = [];
  foreach (get_posts(['post_type' => 'ih_book', 'numberposts' => 100, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']) as $b) {
    $sku = m($b->ID, 'ih_sku');
    if ($prices && !isset($prices[$sku])) { continue; }
    $out[] = $b;
    if (count($out) >= $limit) { break; }
  }
  return $out;
}
function shop_url($b) { return hub_url('shop/' . $b->post_name . '/'); }
/** A product's address is /shop/<slug>/ (never /books/). */
add_filter('post_type_link', function ($link, $post) {
  if ($post->post_type === 'ih_book' && site_key() === 'hub') { return home_url('/shop/' . $post->post_name . '/'); }
  return $link;
}, 10, 2);
add_action('template_redirect', function () { // old /books/<slug>/ and /home/ on the hub
  if (site_key() !== 'hub') { return; }
  $p = trim((string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/');
  if (preg_match('#^books/([^/]+)$#', $p, $m)) { wp_safe_redirect(home_url('/shop/' . $m[1] . '/'), 301); exit; }
  if ($p === 'books') { wp_safe_redirect(home_url('/shop/'), 301); exit; }
  if ($p === 'contributors/terry-heath') { wp_safe_redirect(home_url('/about/#the-editor'), 301); exit; } // Terry is the editor, not a contributor
  if ($p === 'home') { wp_safe_redirect(home_url('/'), 301); exit; }
  if (preg_match('#^by/([^/]+)$#', $p, $mm)) { // old Ghost tag pages: a contributor with work, a podcast guest, or the Review's front page
    $slug = sanitize_title($mm[1]); $to = '';
    if (in_array($slug, contributors_with_work(), true)) { $to = home_url('/contributors/' . $slug . '/'); }
    else { $lb = site_blog_id('lifeonwords'); if ($lb) { switch_to_blog($lb); $g = get_page_by_path($slug, OBJECT, 'ih_guest'); if ($g) { $to = get_permalink($g); } restore_current_blog(); } }
    wp_redirect($to ?: pub_url('review'), 301); exit;
  }
}, 1);

/* ---------- contributors: the directory lists only people with published work ---------- */

function contributors_with_work() {
  $c = get_site_transient('ih_contrib_work'); if (is_array($c)) { return $c; }
  $slugs = [];
  foreach (get_sites(['number' => 50]) as $st) {
    switch_to_blog($st->blog_id);
    if (post_type_exists('ih_piece')) {
      foreach (get_posts(['post_type' => 'ih_piece', 'numberposts' => -1, 'post_status' => 'publish', 'fields' => 'ids']) as $id) {
        foreach (array_filter(array_map('trim', explode(',', (string) get_post_meta($id, 'ih_contributors', true)))) as $s) { $slugs[$s] = true; }
      }
    }
    restore_current_blog();
  }
  $slugs = array_keys($slugs);
  set_site_transient('ih_contrib_work', $slugs, 10 * MINUTE_IN_SECONDS);
  return $slugs;
}
add_action('transition_post_status', function ($new, $old, $post) { if ($post->post_type === 'ih_piece' && ($new === 'publish' || $old === 'publish')) { delete_site_transient('ih_contrib_work'); } }, 10, 3);

/* ---------- search ---------- */

function search_scope_keys() { return ['hub', 'review', 'whiterabbit', 'terryheath', 'lifeonwords']; } // one search across the whole family
function result_type($p) {
  switch ($p->post_type) {
    case 'ih_piece': if (is_letter($p)) { return t('search.type_letter', 'Founder’s letter'); } $g = piece_genre($p); return $g ? $g->name : t('search.type_piece', 'Piece'); // the genre as issue pages name it
    case 'ih_issue': return t('search.type_issue', 'Issue');
    case 'ih_contributor': return t('search.type_contributor', 'Contributor');
    case 'ih_episode': return t('search.type_episode', 'Episode');
    case 'ih_guest': return t('search.type_guest', 'Guest');
    case 'ih_book': return t('search.type_product', 'Product');
    case 'post': return t('search.type_essay', 'Essay');
  }
  return '';
}
/** One line from what the item already says: its excerpt, bio or opening. */
function one_line($p) {
  $src = '';
  if ($p->post_type === 'ih_contributor' || $p->post_type === 'ih_guest') { $src = (string) m($p->ID, 'ih_bio'); }
  elseif ($p->post_type === 'ih_issue') { $src = (string) m($p->ID, 'ih_note'); }
  if ($src === '') { $src = $p->post_excerpt; }
  if ($src === '') {
    $c = (string) $p->post_content;
    if (preg_match_all('#<p[^>]*>(.*?)</p>#is', $c, $mm)) { foreach ($mm[1] as $para) { $t = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags(preg_replace('#<br\s*/?>#i', ' ', $para)))); if (mb_strlen($t) > 30 && !preg_match('/^[▶►]/u', $t)) { $src = $t; break; } } }
    if ($src === '') { $src = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags(preg_replace('#<br\s*/?>#i', ' ', $c)))); }
  }
  $src = html_entity_decode(wp_strip_all_tags(preg_replace('#<br\s*/?>|</p>#i', ' ', $src)), ENT_QUOTES, 'UTF-8');
  $src = trim(preg_replace('/[\s\x{00A0}\x{2000}-\x{200B}]+/u', ' ', $src)); // runs of spaces become one
  if (mb_strlen($src) <= 160) { return $src; }
  $head = mb_substr($src, 0, 220); $best = 0;
  if (preg_match_all('/[.!?]["”’)]*(?=\s|$)/u', $head, $mm, PREG_OFFSET_CAPTURE)) { foreach ($mm[0] as $hit) { $end = mb_strlen(substr($head, 0, $hit[1])) + mb_strlen($hit[0]); if ($end >= 40) { $best = $end; } } }
  if ($best) { return trim(mb_substr($head, 0, $best)); } // cut at a sentence end
  $cut = mb_substr($src, 0, 140); $sp = mb_strrpos($cut, ' ');
  return rtrim(mb_substr($cut, 0, $sp ?: 140), " ,.;:–-") . '…';
}

function search_results($q) {
  $out = []; $books = null;
  $keys = search_scope_keys(); $here = site_key();
  usort($keys, function ($a, $b) use ($here) { return ($b === $here) <=> ($a === $here); });
  foreach (site_blog_ids($keys) as $key => $bid) {
    switch_to_blog($bid);
    $work = contributors_with_work();
    $types = ['ih_piece', 'ih_issue', 'ih_contributor', 'ih_episode', 'ih_guest', 'ih_book', 'post'];
    foreach (get_posts(['s' => $q, 'post_type' => $types, 'numberposts' => 30, 'post_status' => 'publish', 'orderby' => 'relevance']) as $p) {
      if ($p->post_type === 'ih_contributor' && !in_array($p->post_name, $work, true)) { continue; }
      if ($p->post_type === 'ih_book') { if ($books === null) { $books = array_map(function ($b) { return $b->ID; }, shop_books()); } if (!in_array($p->ID, $books, true)) { continue; } }
      if ($p->post_type === 'post' && $p->post_name === 'hello-world') { continue; }
      $out[] = ['title' => get_the_title($p), 'url' => $p->post_type === 'ih_book' ? hub_url('shop/' . $p->post_name . '/') : get_permalink($p), 'type' => result_type($p), 'pub' => site_name_of($key), 'line' => one_line($p)];
    }
    restore_current_blog();
  }
  return $out;
}

function view_search() {
  $q = trim((string) get_search_query());
  $h = '<main class="ih-main"><h1 class="ih-h1">' . ($q !== '' ? tx('search.heading_q', 'Results for “{q}”', ['q' => $q]) : tx('search.heading', 'Search')) . '</h1><form role="search" class="ih-form" method="get" action="' . a(home_url('/')) . '"><div class="ih-row"><label class="ih-sr" for="ih-s">' . tx('search.label', 'Search') . '</label>'
     . '<input id="ih-s" type="search" name="s" value="' . a($q) . '"><button class="ih-btn" type="submit">' . tx('search.button', 'Search') . '</button></div></form>';
  if ($q === '') { return $h . '</main>'; }
  $res = search_results($q);
  $h .= '<ul class="ih-results">';
  foreach ($res as $r) {
    $h .= '<li><a href="' . a($r['url']) . '"><span class="ih-pt">' . e($r['title']) . '</span><span class="ih-pa">' . e($r['type'] . ' · ' . $r['pub']) . '</span>' . ($r['line'] !== '' ? '<span class="ih-pl">' . e($r['line']) . '</span>' : '') . '</a></li>';
  }
  if (!$res) { $h .= '<li class="ih-sub">' . tx('search.none', 'No results for “{q}”. Try another word.', ['q' => $q]) . '</li>'; }
  return $h . '</ul></main>';
}

/* ---------- issue archive: every released issue with its cover ---------- */

function view_archive() {
  $q = get_posts(['post_type' => 'ih_issue', 'numberposts' => -1, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']);
  $h = '<main class="ih-main"><h1 class="ih-h1">' . tx('archive.heading', 'Archive') . '</h1><div class="ih-grid ih-archive">';
  foreach ($q as $i) {
    $rel = m($i->ID, 'ih_release'); if ($rel && strtotime($rel) > time()) { continue; } // not out yet
    $label = m($i->ID, 'ih_label') ?: get_the_title($i);
    $h .= '<div class="ih-gi"><a href="' . a(get_permalink($i)) . '" aria-label="' . a($label) . '">' . (get_the_post_thumbnail_url($i, 'medium') ? cover($i, t('issue.cover_alt', 'Cover of {pub}, {label}', ['pub' => site()['name'], 'label' => $label])) : '<div class="ih-cover ih-cover-e" aria-hidden="true"></div>') . '</a><h3><a href="' . a(get_permalink($i)) . '">' . e($label) . '</a></h3></div>';
  }
  return $h . '</div></main>';
}

/** An essay's lead: its excerpt field, else its first complete sentence (never a cut-off fragment; a quotation is carried through to its closing mark). */
function lead_line($p) {
  if (trim($p->post_excerpt) !== '') { return trim(preg_replace('/\s+/', ' ', wp_strip_all_tags($p->post_excerpt))); }
  $t = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags(preg_replace('#<br\s*/?>|</p>#i', ' ', (string) $p->post_content))));
  $t = html_entity_decode($t, ENT_QUOTES, 'UTF-8');
  $parts = preg_split('/(?<=[.!?]["”’)])(?=[A-Z“‘(])|(?<=[.!?])\s+(?=[A-Z“"‘(])|(?<=[.!?]["”’)])\s+(?=[A-Z“"‘(])/u', $t);
  $out = ''; $n = 0;
  foreach ($parts as $sent) {
    $out = trim($out . ' ' . $sent); $n++;
    $open = substr_count($out, '“') + substr_count($out, '‘') - substr_count($out, '”') - substr_count($out, '’') * 0; // curly doubles
    $dq = substr_count($out, '"');
    $balanced = (substr_count($out, '“') <= substr_count($out, '”')) && ($dq % 2 === 0);
    if (mb_strlen($out) >= 20 && $balanced && preg_match('/[.!?]["”’)]*$/u', $out)) { return $out; }
    if ($n >= 6) { break; }
  }
  return '';
}
/** A hyphen inside a word does not break across lines in essay titles ("Publisher‑Writer"). */
add_filter('the_title', function ($t, $id = 0) {
  if ($id && get_post_type($id) === 'post') { return preg_replace('/(?<=\p{L})-(?=\p{L})/u', "\xE2\x80\x91", $t); }
  return $t;
}, 10, 2);

/* ---------- Life on Words home, as in the mockup ---------- */

function episodes_latest($n) { return get_posts(['post_type' => 'ih_episode', 'numberposts' => $n, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']); }
function guest_of($p) { return post_or_null(m($p->ID, 'ih_guest_id')); }
function guest_headshot($g, $size = 'medium') { return $g ? (get_the_post_thumbnail_url($g, $size) ?: (m($g->ID, 'ih_headshot_id') ? wp_get_attachment_image_url((int) m($g->ID, 'ih_headshot_id'), $size) : '')) : ''; }
function episode_title_part($p) { $t = get_the_title($p); $g = guest_of($p); $pre = $g ? get_the_title($g) . ': ' : ''; return ($pre !== '' && stripos($t, $pre) === 0) ? substr($t, strlen($pre)) : $t; } // the title after "Guest: "; a title that does not start with the guest's name is shown whole
function episode_audio($p) { $u = m($p->ID, 'ih_audio_url'); if ($u) { return $u; } return preg_match('#<audio[^>]+src="([^"]+)"#i', (string) $p->post_content, $mm) ? html_entity_decode($mm[1]) : ''; }
function episode_len($p) { if (m($p->ID, 'ih_duration')) { return m($p->ID, 'ih_duration'); } return preg_match('#Listen to this episode\s*(?:&middot;|·|&#183;)\s*([0-9]+ min)#iu', wp_strip_all_tags((string) $p->post_content), $mm) ? $mm[1] : ''; }
const LOW_APPLE = 'https://podcasts.apple.com/us/podcast/life-on-words/id6796221237';
const LOW_SPOTIFY = 'https://open.spotify.com/show/033Yk3F8x8QWBLK496Wbqd';
function feed_url_low() { return pub_url('terryheath', 'podcast/rss/'); }

function section_low_latest() {
  $eps = episodes_latest(1); $latest = $eps ? $eps[0] : null; $h = '';
  if ($latest) {
    $g = guest_of($latest); $img = guest_headshot($g, 'large');
    $meta = t('low.latest', 'Latest episode') . (m($latest->ID, 'ih_number') ? ' · ' . t('low.episode', 'Episode') . ' ' . m($latest->ID, 'ih_number') : '') . (episode_len($latest) ? ' · ' . episode_len($latest) : '');
    $h .= '<section class="ih-low-latest' . ($img ? '' : ' ih-low-latest-noimg') . '" aria-label="' . ta('low.latest_aria', 'Latest episode') . '">' . ($img ? '<img class="ih-headshot ih-headshot-l" src="' . a($img) . '" alt="' . ta('low.headshot', 'Headshot of {name}', ['name' => $g ? get_the_title($g) : '']) . '" width="360" height="360">' : '') // no headshot yet: no empty circle
      . '<div><p class="ih-label">' . e($meta) . '</p><h1 class="ih-h1-xl ih-low-h1">' . e($g ? get_the_title($g) : get_the_title($latest)) . '</h1><p class="ih-folio-line">' . e(episode_title_part($latest)) . '</p>'
      . '<div class="ih-btns">' . (episode_audio($latest) ? '<button type="button" class="ih-btn ih-play" data-ih-audio="' . a(episode_audio($latest)) . '"><span aria-hidden="true">&#9654;&#xFE0E;</span>&nbsp; ' . tx('low.play', 'Play episode') . '</button>' : '') . '<a class="ih-btn" href="' . a(get_permalink($latest)) . '#transcript">' . tx('low.transcript', 'Transcript') . '</a></div>'
      . '<p class="ih-listen">' . tx('low.listen_on', 'Listen on') . '</p>' . listen_pills() . '</div></section>';
  }
  return $h;
}
function section_low_recent() {
  $eps = episodes_latest(7);
  $h = '<section aria-label="' . ta('low.recent', 'Recent episodes') . '" class="ih-low-recent"><div class="ih-low-rh"><h2 class="ih-h2">' . tx('low.recent', 'Recent episodes') . '</h2><a class="ih-link" href="' . a(home_url('/episodes/')) . '">' . tx('low.all', 'All episodes') . ' &rarr;</a></div><ul class="ih-ep-list">';
  foreach (array_slice($eps, 1, 6) as $p) {
    $g = guest_of($p); $im = guest_headshot($g, 'thumbnail');
    $h .= '<li><a class="ih-ep-row" href="' . a(get_permalink($p)) . '">' . ($im ? '<img class="ih-headshot" src="' . a($im) . '" alt="" width="64" height="64">' : '')
      . '<span><span class="ih-ep-g">' . e($g ? get_the_title($g) : get_the_title($p)) . '</span><span class="ih-ep-t">' . e(episode_title_part($p)) . '</span></span><span class="ih-pa">' . e(m($p->ID, 'ih_number') ? t('low.episode', 'Episode') . ' ' . m($p->ID, 'ih_number') : get_the_date('M j, Y', $p)) . '</span></a></li>';
  }
  return $h . '</ul></section>';
}
function view_podcast_home() {
  $h = '<main class="ih-main ih-low">' . section_low_latest() . section_low_recent();
  $h .= '<section aria-label="' . ta('low.about_aria', 'About the show') . '" class="ih-low-about"><h2 class="ih-h2">' . tx('low.about', 'About the show') . '</h2><div>' . '<p class="ih-note" style="margin:0">' . tx('low.about_text', 'Terry Heath talks at length with novelists, poets, playwrights, songwriters and publishers. The guests are the experts. Terry is the guide.') . '</p>'
     . '<p class="ih-sub"><a class="ih-link" href="' . a(pub_url('terryheath', 'podcast/guests/')) . '">' . tx('low.suggest', 'Suggest a guest') . ' &rarr;</a></p></div></section>';
  return $h . signup() . '</main>';
}

/* ---------- terryheath.com home, as in the mockup ---------- */

function section_author_banner() { return '<div class="ih-th-banner"><img src="' . a(img_url('th-Your-paragraph-text--12--4.png')) . '" alt="' . ta('author.banner_alt', 'Woodcut-style illustration: a white rabbit with a monocle and a teapot sits at the edge of rolling fields and pines under a striped sky') . '" width="2000" height="1125" style="aspect-ratio:1200/520;object-fit:cover;object-position:center 60%"></div>'; }
function section_author_top() {
  $posts = get_posts(['post_type' => 'post', 'numberposts' => 13, 'post_status' => 'publish']);
  $posts = array_values(array_filter($posts, function ($p) { return $p->post_name !== 'hello-world'; }));
  $h = '';
  if ($posts) {
    $l = $posts[0]; $rest = array_slice($posts, 1, 5);
    $h .= '<section class="ih-th-top" aria-label="' . ta('author.latest_aria', 'Latest essay') . '"><div class="ih-th-latest"><p class="ih-label">' . tx('author.latest', 'Latest essay') . ' · ' . e(get_the_date('F j, Y', $l)) . '</p><h1 class="ih-th-h1"><a href="' . a(get_permalink($l)) . '" style="color:var(--ih-ink)">' . e(get_the_title($l)) . '</a></h1>';
    $line = lead_line($l); if ($line !== '') { $h .= '<p class="ih-folio-line">' . e($line) . '</p>'; }
    $h .= '<p class="ih-all"><a href="' . a(get_permalink($l)) . '">' . tx('author.read', 'Read the essay') . ' &rarr;</a></p></div>';
    if ($rest) {
      $h .= '<div class="ih-th-more" aria-label="' . ta('author.more', 'More writing') . '"><p class="ih-label" style="color:var(--ih-mute)">' . tx('author.more', 'More writing') . '</p><ul class="ih-list" style="margin-top:12px">';
      foreach ($rest as $p) { $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa" style="display:block">' . e(get_the_date('F j, Y', $p)) . '</span></a></li>'; }
      $h .= '</ul></div>';
    }
    $h .= '</section>';
  }
  return $h;
}
function section_author_low() {
  $h = '';
  $bid = site_blog_id('lifeonwords');
  if ($bid) {
    switch_to_blog($bid);
    $eps = episodes_latest(3); $cards = [];
    foreach ($eps as $p) { $g = guest_of($p); $cards[] = ['url' => get_permalink($p), 'guest' => $g ? get_the_title($g) : get_the_title($p), 'title' => episode_title_part($p)]; }
    $low = pub_url('lifeonwords');
    restore_current_blog();
    if ($cards) {
      $h .= '<section class="ih-th-low" aria-label="' . ta('author.low_aria', 'Life on Words') . '"><div class="ih-low-rh"><h2 class="ih-h2">' . tx('author.low', 'From Life on Words') . '</h2><a class="ih-link" href="' . a($low) . '">' . tx('author.low_all', 'All episodes at lifeonwords.com') . ' &rarr;</a></div><div class="ih-grid ih-th-eps">';
      foreach ($cards as $c) {
        $h .= '<a class="ih-ep-card" href="' . a($c['url']) . '"><span class="ih-pt" style="display:block;font-size:26px">' . e($c['guest']) . '</span><span class="ih-it" style="display:block;margin-top:6px">' . e($c['title']) . '</span><span class="ih-listen-l">' . tx('author.listen', 'Listen') . ' &rarr;</span></a>';
      }
      $h .= '</div></section>';
    }
  }
  return $h;
}
function section_author_books() {
  $h = '';
  $books = get_posts(['post_type' => 'ih_book', 'numberposts' => 6, 'post_status' => 'publish']);
  if ($books) {
    $h .= '<section aria-label="' . ta('author.books', 'Books') . '" class="ih-th-books"><h2 class="ih-h2">' . tx('author.books', 'Books') . '</h2><div class="ih-grid">';
    foreach ($books as $b) { $h .= '<div class="ih-gi"><a href="' . a(get_permalink($b)) . '">' . cover($b, t('strip.cover', 'Cover of {title}', ['title' => get_the_title($b)])) . '</a><h3><a href="' . a(get_permalink($b)) . '">' . e(get_the_title($b)) . '</a></h3></div>'; }
    $h .= '</div></section>';
  }
  return $h;
}

function view_author_home() { return section_author_banner() . '<main class="ih-main ih-th">' . section_author_top() . section_author_low() . section_author_books() . signup() . '</main>'; }

/* ---------- guests ---------- */

function view_guest($g) {
  $img = guest_headshot($g, 'medium');
  $h = '<main class="ih-main ih-contrib"><div class="ih-contrib-h">' . ($img ? '<img class="ih-headshot" src="' . a($img) . '" alt="' . ta('contrib.portrait', 'Portrait of {name}', ['name' => get_the_title($g)]) . '" width="160" height="160">' : '') . '<div><h1>' . e(get_the_title($g)) . '</h1>'
     . (m($g->ID, 'ih_bio') ? '<p class="ih-bio">' . e(m($g->ID, 'ih_bio')) . '</p>' : '') . '</div></div><section><h2>' . tx('guest.episodes', 'Episodes') . '</h2><ul class="ih-list">';
  foreach (get_posts(['post_type' => 'ih_episode', 'numberposts' => -1, 'post_status' => 'publish', 'meta_key' => 'ih_guest_id', 'meta_value' => $g->ID]) as $p) { $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(get_the_date('', $p)) . '</span></a></li>'; }
  return $h . '</ul></section></main>';
}

/* ---------- Muse: the WordPress placeholder hands over to the Muse web app ---------- */

add_action('template_redirect', function () {
  if (site_key() !== 'muse') { return; }
  $base = 'https://gomuse.io';
  $path = trim((string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/');
  $rest = preg_replace('#^muse/?#', '', $path);
  if (strpos($path, 'wp-') === 0 || strpos($path, 'wp-json') !== false) { return; }
  wp_redirect($base . '/' . ($rest === 'about' ? '' : $rest) . (isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] !== '' ? '?' . $_SERVER['QUERY_STRING'] : ''), 301); exit; // every /muse/ path goes to the same gomuse.io page (the old placeholder About has no counterpart: the front page)
}, 0);

/* ---------- /newsletter/: preferences link by email ---------- */

add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/newsletter-manage', ['methods' => 'POST', 'permission_callback' => '__return_true', 'callback' => function (\WP_REST_Request $r) {
    $email = sanitize_email((string) $r->get_param('email'));
    $ip = md5((string) ($_SERVER['REMOTE_ADDR'] ?? '')); $k = 'ih_mg_' . $ip; $n = (int) get_transient($k);
    if ($n >= 6) { return new \WP_REST_Response(['ok' => false, 'message' => t('msg.toomany', 'Too many requests from this connection. Please try again in an hour.')], 429); }
    set_transient($k, $n + 1, HOUR_IN_SECONDS);
    if (!is_email($email)) { return new \WP_REST_Response(['ok' => false, 'message' => t('msg.bademail', 'Please enter a valid email address.')], 400); }
    $d = lm('GET', '/subscribers?per_page=1&query=' . rawurlencode("subscribers.email = '" . str_replace("'", "''", $email) . "'"));
    $sub = $d['results'][0] ?? null;
    if ($sub) { $u = add_query_arg('id', $sub['uuid'], hub_url('newsletter/')); wp_mail($email, t('email.prefs_subject', 'Your newsletter preferences'), t('email.prefs_body', "Hello,\n\nUse this link to choose your lists:\n\n{url}\n\nIf you did not ask for it, ignore this email.\n\nInkhorn Press", ['url' => $u])); }
    return ['ok' => true, 'message' => t('msg.manage_sent', 'If that address is on a list, a link is on its way.')]; // the same answer whether or not it is
  }]);
});

/* ---------- related items: only the ones chosen by hand in the editor ---------- */

add_action('add_meta_boxes', function () {
  foreach (['post', 'ih_episode'] as $t) { add_meta_box('ih_related', 'Related items', __NAMESPACE__ . '\\related_box', $t, 'side'); }
});
function related_candidates() {
  $key = site_key() === 'lifeonwords' ? 'terryheath' : 'lifeonwords'; $types = $key === 'terryheath' ? ['post'] : ['ih_episode']; $out = [];
  $bid = site_blog_id($key); if (!$bid) { return $out; }
  switch_to_blog($bid);
  foreach (get_posts(['post_type' => $types, 'numberposts' => 100, 'post_status' => 'publish']) as $p) { $out[$bid . ':' . $p->ID] = get_the_title($p); }
  restore_current_blog();
  return $out;
}
function related_box($post) {
  wp_nonce_field('ih_related', 'ih_related_n');
  $have = (array) get_post_meta($post->ID, 'ih_related', true);
  echo '<p>Tick the items to show under this one. Nothing is matched automatically.</p>';
  foreach (related_candidates() as $k => $title) { echo '<label style="display:block;margin:4px 0"><input type="checkbox" name="ih_related[]" value="' . esc_attr($k) . '"' . (in_array($k, $have, true) ? ' checked' : '') . '> ' . esc_html($title) . '</label>'; }
}
add_action('save_post', function ($id) {
  if (empty($_POST['ih_related_n']) || !wp_verify_nonce($_POST['ih_related_n'], 'ih_related') || !current_user_can('edit_post', $id)) { return; }
  $v = array_values(array_filter(array_map('sanitize_text_field', (array) ($_POST['ih_related'] ?? [])), function ($x) { return preg_match('/^\d+:\d+$/', $x); }));
  if ($v) { update_post_meta($id, 'ih_related', $v); } else { delete_post_meta($id, 'ih_related'); }
});
/** The hand-chosen items of $post, as related_block() wants them. */
function chosen_related($post) {
  $items = [];
  foreach ((array) get_post_meta($post->ID, 'ih_related', true) as $k) {
    list($bid, $pid) = array_map('intval', explode(':', (string) $k));
    if (!$bid || !$pid) { continue; }
    switch_to_blog($bid);
    $p = get_post($pid);
    if ($p && $p->post_status === 'publish') { $g = $p->post_type === 'ih_episode' ? guest_of($p) : null; $items[] = ['url' => get_permalink($p), 'title' => get_the_title($p), 'meta' => $g ? get_the_title($g) : get_the_date('', $p)]; }
    restore_current_blog();
  }
  return $items;
}
