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

add_filter('pre_get_document_title', function ($t) {
  $site = site()['name']; $v = get_query_var('ih_view');
  $names = ['shop' => 'Shop', 'cart' => 'Cart', 'order-complete' => 'Order complete', 'subscriptions' => 'Subscriptions', 'newsletter' => 'Newsletter', 'nl-confirmed' => 'Newsletter',
    'nl-expired' => 'Newsletter', 'signin' => 'Sign in', 'account' => session_email() ? 'Account' : 'Sign in', 'help' => 'Help', 'start-here' => 'Start here'];
  if (isset($names[$v])) { return $names[$v] . ' – ' . $site; }
  if ($v === 'book') { $b = book_by_slug(get_query_var('ih_book_slug')); return ($b ? get_the_title($b) : 'Shop') . ' – ' . $site; }
  if (is_404()) { return 'Page not found – ' . $site; }
  if (is_search()) { return 'Search – ' . $site; }
  if (is_front_page() || is_home()) { return $site; }
  if (is_post_type_archive('ih_contributor')) { return 'Contributors – ' . $site; }
  if (is_post_type_archive('ih_episode')) { return 'Episodes – ' . $site; }
  if (is_post_type_archive('ih_guest')) { return 'Guests – ' . $site; }
  if (is_post_type_archive('ih_issue')) { return 'Archive – ' . $site; }
  if (is_post_type_archive('ih_book')) { return 'Books – ' . $site; }
  if (is_tax('ih_genre')) { return single_term_title('', false) . ' – ' . $site; }
  if (is_singular()) { return get_the_title() . ' – ' . $site; }
  return $site;
}, 99);

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
  if ($p === 'home') { wp_safe_redirect(home_url('/'), 301); exit; }
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

function search_scope_keys() { return in_array(site()['kind'], ['author', 'podcast'], true) ? ['terryheath', 'lifeonwords'] : ['hub', 'review', 'whiterabbit', 'muse']; }
function result_type($p) {
  switch ($p->post_type) {
    case 'ih_piece': $g = piece_genre($p); $map = ['poetry' => 'Poem', 'fiction' => 'Story', 'nonfiction' => 'Essay', 'art' => 'Art', 'micro' => 'Micro']; return $g ? ($map[$g->slug] ?? $g->name) : 'Piece';
    case 'ih_issue': return 'Issue';
    case 'ih_contributor': return 'Contributor';
    case 'ih_episode': return 'Episode';
    case 'ih_guest': return 'Guest';
    case 'ih_book': return 'Product';
    case 'post': return 'Essay';
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
    if (preg_match_all('#<p[^>]*>(.*?)</p>#is', $c, $mm)) { foreach ($mm[1] as $para) { $t = trim(wp_strip_all_tags($para)); if (mb_strlen($t) > 30 && !preg_match('/^[▶►]/u', $t)) { $src = $t; break; } } }
    if ($src === '') { $src = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags($c))); }
  }
  $src = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags($src)));
  if (mb_strlen($src) <= 140) { return $src; }
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
  $h = '<main class="ih-main"><h1 class="ih-h1">Search</h1><form role="search" class="ih-form" method="get" action="' . a(home_url('/')) . '"><div class="ih-row"><label class="ih-sr" for="ih-s">Search</label>'
     . '<input id="ih-s" type="search" name="s" value="' . a($q) . '"><button class="ih-btn" type="submit">Search</button></div></form>';
  if ($q === '') { return $h . '</main>'; }
  $res = search_results($q);
  $h .= '<ul class="ih-results">';
  foreach ($res as $r) {
    $h .= '<li><a href="' . a($r['url']) . '"><span class="ih-pt">' . e($r['title']) . '</span><span class="ih-pa">' . e($r['type'] . ' · ' . $r['pub']) . '</span>' . ($r['line'] !== '' ? '<span class="ih-pl">' . e($r['line']) . '</span>' : '') . '</a></li>';
  }
  if (!$res) { $h .= '<li class="ih-sub">Nothing found.</li>'; }
  return $h . '</ul></main>';
}

/* ---------- issue archive: every released issue with its cover ---------- */

function view_archive() {
  $q = get_posts(['post_type' => 'ih_issue', 'numberposts' => -1, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']);
  $h = '<main class="ih-main"><h1 class="ih-h1">Archive</h1><div class="ih-grid ih-archive">';
  foreach ($q as $i) {
    $rel = m($i->ID, 'ih_release'); if ($rel && strtotime($rel) > time()) { continue; } // not out yet
    $label = m($i->ID, 'ih_label') ?: get_the_title($i);
    $h .= '<div class="ih-gi"><a href="' . a(get_permalink($i)) . '" aria-label="' . a($label) . '">' . (get_the_post_thumbnail_url($i, 'medium') ? cover($i, 'Cover of ' . $label) : '<div class="ih-cover ih-cover-e" aria-hidden="true"></div>') . '</a><h3><a href="' . a(get_permalink($i)) . '">' . e($label) . '</a></h3></div>';
  }
  return $h . '</div></main>';
}

/* ---------- Life on Words home, as in the mockup ---------- */

function episodes_latest($n) { return get_posts(['post_type' => 'ih_episode', 'numberposts' => $n, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']); }
function guest_of($p) { return get_post((int) m($p->ID, 'ih_guest_id')); }
function guest_headshot($g, $size = 'medium') { return $g ? (get_the_post_thumbnail_url($g, $size) ?: (m($g->ID, 'ih_headshot_id') ? wp_get_attachment_image_url((int) m($g->ID, 'ih_headshot_id'), $size) : '')) : ''; }
function episode_title_part($p) { $t = get_the_title($p); $pos = strpos($t, ': '); return $pos !== false ? substr($t, $pos + 2) : $t; }
function feed_url_low() { return pub_url('terryheath', 'podcast/rss/'); }

function view_podcast_home() {
  $eps = episodes_latest(7); $latest = $eps ? $eps[0] : null;
  $h = '<main class="ih-main ih-low">';
  if ($latest) {
    $g = guest_of($latest); $img = guest_headshot($g, 'medium');
    $h .= '<section class="ih-low-latest" aria-label="Latest episode">' . ($img ? '<img class="ih-headshot ih-headshot-l" src="' . a($img) . '" alt="Headshot of ' . a($g ? get_the_title($g) : '') . '" width="220" height="220">' : '<div class="ih-headshot ih-headshot-l ih-headshot-e" role="img" aria-label="' . a($g ? get_the_title($g) : '') . '"></div>')
      . '<div><p class="ih-kicker">Latest episode · ' . e(get_the_date('F j, Y', $latest)) . '</p><h1 class="ih-low-h1">' . e($g ? get_the_title($g) : get_the_title($latest)) . '</h1>'
      . '<p class="ih-low-t">' . e(episode_title_part($latest)) . '</p>';
    $line = one_line($latest); if ($line !== '') { $h .= '<p class="ih-note">' . e($line) . '</p>'; }
    $h .= '<div class="ih-btns">' . (m($latest->ID, 'ih_audio_url') ? '<button type="button" class="ih-btn ih-play" data-ih-audio="' . a(m($latest->ID, 'ih_audio_url')) . '"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M2 1 L11 6 L2 11 Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg> Play episode</button>' : '')
      . '<a class="ih-link" href="' . a(get_permalink($latest)) . '">Episode notes &rarr;</a></div>'
      . '<p class="ih-listen">Listen on <a href="' . a(feed_url_low()) . '">RSS</a></p></div></section>';
  }
  $h .= '<section aria-label="Recent episodes" class="ih-low-recent"><div class="ih-low-rh"><h2 class="ih-h2" style="text-align:left">Recent episodes</h2><a class="ih-link" href="' . a(home_url('/episodes/')) . '">All episodes &rarr;</a></div><ul class="ih-list">';
  foreach (array_slice($eps, 1, 6) as $p) {
    $g = guest_of($p);
    $h .= '<li><a class="ih-row-link" href="' . a(get_permalink($p)) . '"><span><span class="ih-pt" style="display:inline">' . e($g ? get_the_title($g) : get_the_title($p)) . '</span><span class="ih-it"> — ' . e(episode_title_part($p)) . '</span></span><span class="ih-pa">' . e(get_the_date('M j, Y', $p) . (m($p->ID, 'ih_duration') ? ' · ' . m($p->ID, 'ih_duration') : '')) . '</span></a></li>';
  }
  $h .= '</ul></section>';
  $about = get_page_by_path('about');
  $h .= '<section aria-label="About the show" class="ih-low-about"><h2 class="ih-h2">About</h2>' . ($about && trim($about->post_content) !== '' ? '<div class="ih-note" style="margin:14px auto 0">' . apply_filters('the_content', $about->post_content) . '</div>' : ph('About the show'))
     . '<p class="ih-sub"><a class="ih-link" href="' . a(pub_url('terryheath', 'podcast/guests/')) . '">Suggest a guest &rarr;</a></p></section>';
  return $h . signup() . '</main>';
}

/* ---------- terryheath.com home, as in the mockup ---------- */

function view_author_home() {
  $posts = get_posts(['post_type' => 'post', 'numberposts' => 13, 'post_status' => 'publish']);
  $posts = array_values(array_filter($posts, function ($p) { return $p->post_name !== 'hello-world'; }));
  $h = '<main class="ih-main ih-th">';
  if ($posts) {
    $l = $posts[0];
    $h .= '<section class="ih-th-latest" aria-label="Latest writing"><p class="ih-kicker">Latest essay</p><h1 class="ih-th-h1"><a href="' . a(get_permalink($l)) . '">' . e(get_the_title($l)) . '</a></h1>';
    $line = one_line($l); if ($line !== '') { $h .= '<p class="ih-note" style="margin:20px auto 0">' . e($line) . '</p>'; }
    $h .= '<p class="ih-sub"><a class="ih-link" href="' . a(get_permalink($l)) . '">Read the essay &rarr;</a></p></section>';
    $rest = array_slice($posts, 1, 5);
    if ($rest) {
      $h .= '<section class="ih-th-more" aria-label="More writing"><ul class="ih-list">';
      foreach ($rest as $p) { $h .= '<li><a class="ih-row-link" href="' . a(get_permalink($p)) . '"><span class="ih-pt" style="display:inline">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(get_the_date('M j, Y', $p)) . '</span></a></li>'; }
      $h .= '</ul></section>';
    }
  }
  // Life on Words: the three newest episodes
  $bid = site_blog_id('lifeonwords');
  if ($bid) {
    switch_to_blog($bid);
    $eps = episodes_latest(3); $cards = [];
    foreach ($eps as $p) { $g = guest_of($p); $cards[] = ['url' => get_permalink($p), 'guest' => $g ? get_the_title($g) : get_the_title($p), 'title' => episode_title_part($p), 'img' => guest_headshot($g, 'thumbnail')]; }
    $low = pub_url('lifeonwords');
    restore_current_blog();
    if ($cards) {
      $h .= '<section class="ih-th-low" aria-label="Life on Words"><div style="text-align:center"><h2 class="ih-h2">Life on Words</h2></div><div class="ih-grid ih-th-eps">';
      foreach ($cards as $c) {
        $h .= '<a class="ih-ep-card" href="' . a($c['url']) . '">' . ($c['img'] ? '<img class="ih-headshot" src="' . a($c['img']) . '" alt="Headshot of ' . a($c['guest']) . '" width="120" height="120">' : '<span class="ih-headshot ih-headshot-e" role="img" aria-label="' . a($c['guest']) . '"></span>')
          . '<span class="ih-pt">' . e($c['guest']) . '</span><span class="ih-it">' . e($c['title']) . '</span><span class="ih-listen-l">Listen &rarr;</span></a>';
      }
      $h .= '</div><p class="ih-sub" style="text-align:center"><a class="ih-link" href="' . a($low) . '">All episodes &rarr;</a></p></section>';
    }
  }
  $books = get_posts(['post_type' => 'ih_book', 'numberposts' => 6, 'post_status' => 'publish']);
  if ($books) {
    $h .= '<section aria-label="Books"><h2 class="ih-h2">Books</h2><div class="ih-grid">';
    foreach ($books as $b) { $h .= '<div class="ih-gi"><a href="' . a(get_permalink($b)) . '">' . cover($b, 'Cover of ' . get_the_title($b)) . '</a><h3><a href="' . a(get_permalink($b)) . '">' . e(get_the_title($b)) . '</a></h3></div>'; }
    $h .= '</div></section>';
  }
  return $h . signup() . '</main>';
}

/* ---------- guests ---------- */

function view_guest($g) {
  $img = guest_headshot($g, 'medium');
  $h = '<main class="ih-main ih-contrib"><div class="ih-contrib-h">' . ($img ? '<img class="ih-headshot" src="' . a($img) . '" alt="Portrait of ' . a(get_the_title($g)) . '" width="160" height="160">' : '') . '<div><h1>' . e(get_the_title($g)) . '</h1>'
     . (m($g->ID, 'ih_bio') ? '<p class="ih-bio">' . e(m($g->ID, 'ih_bio')) . '</p>' : '') . '</div></div><section><h2>Episodes</h2><ul class="ih-list">';
  foreach (get_posts(['post_type' => 'ih_episode', 'numberposts' => -1, 'post_status' => 'publish', 'meta_key' => 'ih_guest_id', 'meta_value' => $g->ID]) as $p) { $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(get_the_date('', $p)) . '</span></a></li>'; }
  return $h . '</ul></section></main>';
}

/* ---------- Muse: the WordPress placeholder hands over to the Muse web app ---------- */

add_action('template_redirect', function () {
  if (site_key() !== 'muse' || !getenv('MUSE_APP_URL')) { return; }
  $base = rtrim(getenv('MUSE_APP_URL'), '/');
  $path = trim((string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/');
  $rest = preg_replace('#^muse/?#', '', $path);
  if (strpos($path, 'wp-') === 0 || strpos($path, 'wp-json') !== false) { return; }
  wp_redirect($base . '/' . $rest, 301); exit;
}, 0);

/* ---------- /newsletter/: preferences link by email ---------- */

add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/newsletter-manage', ['methods' => 'POST', 'permission_callback' => '__return_true', 'callback' => function (\WP_REST_Request $r) {
    $email = sanitize_email((string) $r->get_param('email'));
    $ip = md5((string) ($_SERVER['REMOTE_ADDR'] ?? '')); $k = 'ih_mg_' . $ip; $n = (int) get_transient($k);
    if ($n >= 6) { return new \WP_REST_Response(['ok' => false, 'message' => 'Too many requests from this connection. Please try again in an hour.'], 429); }
    set_transient($k, $n + 1, HOUR_IN_SECONDS);
    if (!is_email($email)) { return new \WP_REST_Response(['ok' => false, 'message' => 'Please enter a valid email address.'], 400); }
    $d = lm('GET', '/subscribers?per_page=1&query=' . rawurlencode("subscribers.email = '" . str_replace("'", "''", $email) . "'"));
    $sub = $d['results'][0] ?? null;
    if ($sub) { $u = add_query_arg('id', $sub['uuid'], hub_url('newsletter/')); wp_mail($email, 'Your newsletter preferences', "Hello,\n\nUse this link to choose your lists:\n\n$u\n\nIf you did not ask for it, ignore this email.\n\nInkhorn Press"); }
    return ['ok' => true, 'message' => 'If that address is on a list, a link is on its way.']; // the same answer whether or not it is
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
