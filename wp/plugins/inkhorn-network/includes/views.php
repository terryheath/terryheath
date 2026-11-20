<?php
namespace Inkhorn;

function e($s) { return esc_html((string) $s); }
function a($s) { return esc_attr((string) $s); }
function m($id, $k) { return get_post_meta($id, $k, true); }

const LIST_LABELS = [
  'inkhorn-review' => 'Inkhorn Review', 'white-rabbit' => 'White Rabbit', 'muse' => 'Muse', 'events' => 'Events',
  'writing' => 'Writing', 'digest' => 'Digest', 'new-books' => 'New books', 'life-on-words' => 'Life on Words',
];

/** Link to a hub page; from a publication it carries ?from= so the hub can show "Back to <publication>". */
function hub_link($path) {
  $u = hub_url($path);
  $k = site_key();
  if (site()['kind'] === 'publication') { $u = add_query_arg('from', $k, $u); }
  return $u;
}

/** "Buy the print issue" goes straight to that issue's product page in the hub shop (stored as a hub path like shop/<book>/). */
function shop_link($v) { if (!$v) { return ''; } return preg_match('#^https?://#', $v) ? $v : hub_link($v); }

function btn($href, $label, $extra = '') {
  return '<a class="ih-btn" href="' . a($href) . '"' . $extra . '>' . e($label) . '</a>';
}

/* ---------- chrome ---------- */

/** A nav link; the page you are on is marked aria-current and underlined by the stylesheet. */
function nav_a($href, $label, $class = '') {
  $u = wp_parse_url($href); $req = (string) strtok($_SERVER['REQUEST_URI'] ?? '/', '?');
  $same_host = empty($u['host']) || strcasecmp($u['host'], (string) ($_SERVER['HTTP_HOST'] ?? '')) === 0 || strcasecmp($u['host'], (string) wp_parse_url(home_url(), PHP_URL_HOST)) === 0;
  $cur = $same_host && untrailingslashit($u['path'] ?? '/') === untrailingslashit($req) && empty($u['fragment']) && !isset($u['query']);
  return '<a' . ($class ? ' class="' . a($class) . '"' : '') . ' href="' . a($href) . '"' . ($cur ? ' aria-current="page"' : '') . '>' . e($label) . '</a>';
}
/** "Sign in", or "Account" when this browser has a session. Signing in from another domain of the network comes back here (see signin/adopt). */
function account_link() {
  if (session_email()) { return nav_a(hub_url('account/'), 'Account'); }
  $u = hub_url('signin/'); if (site_key() !== 'hub') { $u = add_query_arg('return', rawurlencode(home_url('/')), $u); }
  return nav_a($u, 'Sign in');
}
function welcome_band() {
  if (!site()['bar'] || is_page('start-here') || get_query_var('ih_view') === 'start-here') { return ''; }
  return '<div class="ih-welcome" hidden data-ih-welcome><p><a href="' . a(hub_url('start-here/')) . '">New to poetry? Start here</a></p><button type="button" class="ih-welcome-x" aria-label="Dismiss this message">&times;</button></div>';
}
function press_bar() {
  if (site()['bar']) {
    return welcome_band() . '<nav class="ih-bar" aria-label="Inkhorn Press"><div class="ih-bar-in"><div class="ih-bar-l">'
      . '<a class="ih-bar-name" href="' . a(hub_url()) . '">INKHORN PRESS</a>'
      . nav_a(pub_url('review'), 'Review') . nav_a(pub_url('whiterabbit'), 'White Rabbit') . nav_a(pub_url('muse'), 'Muse') . '</div>'
      . '<div class="ih-bar-r">' . nav_a(hub_link('shop/'), 'Shop') . nav_a(hub_link('contributors/'), 'Contributors')
      . nav_a(hub_link('newsletter/'), 'Newsletter') . nav_a(hub_link('donate/'), 'Donate') . account_link() . '</div></div></nav>';
  }
  // terryheath.com and lifeonwords.com share one top bar
  return '<nav class="ih-bar ih-bar-th" aria-label="Terry Heath"><div class="ih-bar-in"><div class="ih-bar-l">'
    . '<a class="ih-bar-name" href="' . a(pub_url('terryheath')) . '">Terry Heath</a>' . nav_a(pub_url('terryheath'), 'Writing') . nav_a(pub_url('lifeonwords'), 'Life on Words') . nav_a(pub_url('terryheath', '/books/'), 'Books') . '</div>'
    . '<div class="ih-bar-r">' . nav_a(home_url('/#newsletter'), 'Newsletter') . account_link() . '</div></div></nav>';
}

function back_link() {
  if (site_key() !== 'hub' || empty($_GET['from'])) { return ''; }
  $from = sanitize_key($_GET['from']);
  $all = sites();
  if (!isset($all[$from]) || $all[$from]['kind'] !== 'publication') { return ''; }
  return '<p class="ih-back"><a href="' . a(pub_url($from)) . '">&larr; Back to ' . e($all[$from]['name']) . '</a></p>';
}

function site_header() {
  $s = site(); $k = site_key();
  $nav = [];
  switch ($s['kind']) {
    case 'publication':
      $nav = [['Current issue', home_url('/')], ['Archive', home_url('/issues/')], ['About', home_url('/about/')]];
      if (!empty($s['submit'])) { $nav[] = ['Submit', $s['submit']]; }
      break;
    case 'hub':
      $nav = [['About', home_url('/about/')], ['Publications', home_url('/#publications')], ['Shop', home_url('/shop/')], ['Contributors', home_url('/contributors/')], ['Donate', home_url('/donate/')]];
      break;
    case 'author':
      $nav = [['About', home_url('/about/')]];
      break;
    case 'podcast':
      $nav = [['Episodes', home_url('/episodes/')], ['Guests', home_url('/guests/')], ['About', home_url('/about/')]];
      break;
  }
  // the site name is the page's h1 on a home page that has no h1 of its own (hub, terryheath.com, lifeonwords.com)
  $own_h1 = $s['kind'] === 'publication';
  $req = trailingslashit((string) strtok($_SERVER['REQUEST_URI'] ?? '/', '?')); $is_home_url = ($req === trailingslashit((string) wp_parse_url(home_url('/'), PHP_URL_PATH)));
  $tag = ($is_home_url && !$own_h1 && !is_search() && !is_404()) ? 'h1' : 'p';
  $nav[] = ['Search', home_url('/?s=')];
  $h = '<header class="ih-head"><' . $tag . ' class="ih-title" style="margin:0"><a href="' . a(home_url('/')) . '" style="color:inherit">' . e($s['name']) . '</a></' . $tag . '><nav aria-label="' . a($s['name']) . '">';
  foreach ($nav as $n) { $h .= nav_a($n[1], $n[0]); }
  return $h . '</nav></header>';
}

function site_footer() {
  $s = site();
  if ($s['bar']) { $line = 'Inkhorn Press is a 501(c)(3) nonprofit press.'; }
  elseif ($s['kind'] === 'podcast') { $line = 'Life on Words, hosted by <a href="' . a(pub_url('terryheath')) . '">Terry Heath</a>, is produced by Follow the Rabbit LLC. <a href="' . a(pub_url('terryheath')) . '">terryheath.com</a>'; }
  else { $line = 'terryheath.com is published by Follow the Rabbit LLC. <a href="' . a(pub_url('lifeonwords')) . '">Life on Words</a>'; }
  return '<footer class="ih-foot"><div class="ih-foot-in"><span>' . $line . '</span><nav aria-label="Footer"><div>' . nav_a(home_url('/help/'), 'Help') . nav_a(hub_link('privacy/'), 'Privacy')
    . nav_a(hub_link('terms/'), 'Terms') . nav_a(hub_link('newsletter/'), 'Newsletter preferences') . '</div></nav></div></footer>';
}

/* ---------- signup ---------- */

function signup($title = '', $all_lists = true) {
  $s = site(); $mine = $s['lists'];
  $family = ($s['kind'] === 'author') ? ['writing', 'digest', 'new-books'] : (($s['kind'] === 'podcast') ? ['life-on-words'] : ['inkhorn-review', 'white-rabbit', 'muse', 'events']);
  $title = 'Get News & Updates by Email'; // one heading on every site
  $h = '<section class="ih-signup" id="newsletter" aria-label="Newsletter"><p class="ih-lead">' . e($title) . '</p>'
     . ((($_GET['signed-up'] ?? '') === '1') ? '<p class="ih-note" role="status">Almost done. We emailed you a link; open it to confirm your sign-up.</p>' : '')
     . ((($_GET['signed-up'] ?? '') === '0') ? '<p class="ih-note" role="alert">That did not work. Check the address and the lists you chose, then try again.</p>' : '')
     . '<p class="ih-sub">Choose the lists you want; change them any time. We email a link to confirm.</p>'
     . '<form class="ih-form" method="post" action="' . a(rest_url('inkhorn/v1/newsletter-signup')) . '" data-ih-signup>';
  if (count($family) > 1) {
    $h .= '<fieldset><legend>Lists</legend>';
    foreach ($family as $l) {
      $h .= '<label><input type="checkbox" name="lists[]" value="' . a($l) . '"' . (in_array($l, $mine, true) ? ' checked' : '') . '> ' . e(LIST_LABELS[$l] ?? $l) . '</label>';
    }
    $h .= '</fieldset>';
  } else {
    $h .= '<input type="hidden" name="lists[]" value="' . a($family[0]) . '">';
  }
  $h .= '<input type="hidden" name="from" value="' . a(site_key()) . '"><div class="ih-row"><label for="ih-em" class="ih-sr">Email address</label>'
     . '<input id="ih-em" type="email" name="email" required autocomplete="email" placeholder="you@example.com">'
     . '<button type="submit" class="ih-btn">Sign Up</button></div><p class="ih-msg" role="status" aria-live="polite"></p></form></section>';
  return $h;
}

/* ---------- helpers for issues and pieces ---------- */

function genre_order() { return ['fiction', 'poetry', 'nonfiction', 'art', 'micro']; }

function issue_pieces($issue_id) {
  return get_posts(['post_type' => 'ih_piece', 'numberposts' => -1, 'post_status' => 'publish', 'meta_key' => 'ih_position', 'orderby' => 'meta_value_num', 'order' => 'ASC',
    'meta_query' => [['key' => 'ih_issue_id', 'value' => $issue_id, 'type' => 'NUMERIC']]]);
}
function piece_genre($p) { $t = get_the_terms($p, 'ih_genre'); return $t && !is_wp_error($t) ? $t[0] : null; }
function current_issue() {
  $q = get_posts(['post_type' => 'ih_issue', 'numberposts' => 1, 'post_status' => 'publish', 'meta_key' => 'ih_current', 'meta_value' => '1']);
  if ($q) { return $q[0]; }
  $q = get_posts(['post_type' => 'ih_issue', 'numberposts' => 1, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']);
  return $q ? $q[0] : null;
}
function cover($post, $alt) {
  $img = get_the_post_thumbnail_url($post, 'large');
  if (!$img) { return ''; }
  return '<div class="ih-cover"><img src="' . a($img) . '" alt="' . a($alt) . '" width="480" height="690"></div>';
}
function contributor_links($p) {
  $slugs = array_filter(array_map('trim', explode(',', (string) m($p->ID, 'ih_contributors'))));
  $names = m($p->ID, 'ih_author_name') ?: '';
  if (!$slugs) { return e($names); }
  $out = [];
  $parts = array_map('trim', preg_split('/\s*(?:,| and | & )\s*/', $names));
  foreach ($slugs as $i => $slug) {
    $label = $parts[$i] ?? $slug;
    $out[] = '<a href="' . a(hub_link('contributors/' . $slug . '/')) . '">' . e($label) . '</a>';
  }
  return implode(', ', $out);
}

/* ---------- pages ---------- */

function view_issue($issue) {
  $s = site();
  $pieces = issue_pieces($issue->ID);
  $label = m($issue->ID, 'ih_label') ?: get_the_title($issue);
  $cur = current_issue(); $is_cur = $cur && $cur->ID === $issue->ID;
  $groups = [];
  foreach ($pieces as $p) { $g = piece_genre($p); $groups[$g ? $g->slug : 'other'][] = $p; }
  $names = [];
  foreach (genre_order() as $g) { if (!empty($groups[$g])) { $names[] = strtolower(get_term_by('slug', $g, 'ih_genre')->name ?? $g); } }
  $kinds = $names ? implode(', ', array_slice($names, 0, 2)) . (count($names) > 2 ? ' and more' : '') : '';
  $first = $pieces ? get_permalink($pieces[0]) : '';
  $shop = shop_link(m($issue->ID, 'ih_shop_url'));
  $h = '<main class="ih-main"><section class="ih-hero" aria-label="' . ($is_cur ? 'Current issue' : 'Issue') . '">' . cover($issue, 'Cover of ' . $label)
     . '<div class="ih-hero-t"><p class="ih-kicker">' . ($is_cur ? 'The current issue' : 'Issue') . '</p><h1>' . e($label) . '</h1>';
  $note = m($issue->ID, 'ih_note');
  if ($note) { $h .= '<p class="ih-note">' . e($note) . '</p>'; }
  $h .= '<p class="ih-meta">' . count($pieces) . ' pieces' . ($kinds ? ' · ' . e($kinds) : '') . '</p><div class="ih-btns">';
  if ($shop) { $h .= btn($shop, 'Buy the print issue') . '<a class="ih-btn ih-btn-quiet" href="' . a(hub_link('shop/subscriptions/')) . '">Subscriptions</a>'; }
  if ($first) { $h .= btn($first, 'Start reading'); }
  $in_order = (($_GET['view'] ?? '') === 'order');
  $base = get_permalink($issue);
  $h .= '</div></div></section><section class="ih-contents" aria-label="In this issue"><h2>In this issue</h2>'
     . '<nav class="ih-tabs" aria-label="How to browse this issue"><a href="' . a($base) . '"' . (!$in_order ? ' aria-current="page"' : '') . '>By genre</a><a href="' . a(add_query_arg('view', 'order', $base)) . '"' . ($in_order ? ' aria-current="page"' : '') . '>Read in order</a></nav>';
  if ($in_order) {
    $h .= '<ol class="ih-order">';
    foreach ($pieces as $p) { $pg = piece_genre($p); $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(m($p->ID, 'ih_author_name') . ($pg ? ' · ' . $pg->name : '')) . '</span></a></li>'; }
    return $h . '</ol></section>' . signup() . '</main>';
  }
  $h .= '<div class="ih-groups">';
  foreach (array_merge(genre_order(), ['other']) as $g) {
    if (empty($groups[$g])) { continue; }
    $term = get_term_by('slug', $g, 'ih_genre');
    $h .= '<div><h3>' . e(strtoupper($term ? $term->name : 'More')) . '</h3><ul>';
    foreach ($groups[$g] as $p) {
      $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(m($p->ID, 'ih_author_name')) . '</span></a></li>';
    }
    $h .= '</ul></div>';
  }
  return $h . '</div></section>' . signup() . '</main>';
}

function view_piece($p) {
  $issue = get_post((int) m($p->ID, 'ih_issue_id'));
  $label = $issue ? (m($issue->ID, 'ih_label') ?: get_the_title($issue)) : '';
  $g = piece_genre($p);
  $poem = $g && in_array($g->slug, ['poetry', 'micro'], true) && $g->slug === 'poetry';
  $h = '<main class="ih-main"><article class="ih-piece"><p class="ih-eyebrow">'
     . ($issue ? '<a href="' . a(get_permalink($issue)) . '">' . e($label) . '</a>' : '') . ($g ? ' · ' . e($g->name) : '') . '</p>'
     . '<h1>' . e(get_the_title($p)) . '</h1><p class="ih-by">' . contributor_links($p) . '</p>'
     . '<div class="ih-body' . ($poem ? ' ih-poem' : '') . '">' . wp_kses_post($p->post_content) . '</div><div class="ih-rule" aria-hidden="true"></div>';
  if (m($p->ID, 'ih_bio')) { $h .= '<p class="ih-bio">' . e(m($p->ID, 'ih_bio')) . '</p>'; }
  if (m($p->ID, 'ih_nomination')) { $h .= '<p class="ih-nom">' . e(m($p->ID, 'ih_nomination')) . '</p>'; }
  $slugs = array_filter(array_map('trim', explode(',', (string) m($p->ID, 'ih_contributors'))));
  if ($slugs) { $h .= '<p class="ih-all"><a href="' . a(hub_link('contributors/' . $slugs[0] . '/')) . '">All work by ' . e(m($p->ID, 'ih_author_name')) . ' at Inkhorn Press &rarr;</a></p>'; }
  $h .= '</article>';
  if ($issue) {
    $list = issue_pieces($issue->ID); $i = null;
    foreach ($list as $n => $q) { if ($q->ID === $p->ID) { $i = $n; } }
    $prev = ($i !== null && $i > 0) ? $list[$i - 1] : null;
    $next = ($i !== null && $i < count($list) - 1) ? $list[$i + 1] : null;
    $shop = shop_link(m($issue->ID, 'ih_shop_url'));
    $h .= '<nav class="ih-pn" aria-label="Previous and next in this issue"><div>';
    if ($prev) { $h .= '<a href="' . a(get_permalink($prev)) . '"><span>PREVIOUS</span><b>' . e(get_the_title($prev)) . '</b><i>' . e(m($prev->ID, 'ih_author_name')) . '</i></a>'; }
    $h .= '</div><div class="ih-pn-r">';
    if ($next) { $h .= '<a href="' . a(get_permalink($next)) . '"><span>NEXT</span><b>' . e(get_the_title($next)) . '</b><i>' . e(m($next->ID, 'ih_author_name')) . '</i></a>'; }
    $h .= '</div></nav>';
    if ($shop) { $h .= '<div class="ih-buyrow">' . btn($shop, 'Buy the print issue') . '<a class="ih-btn ih-btn-quiet" href="' . a(hub_link('shop/subscriptions/')) . '">Subscriptions</a></div>'; }
  }
  return $h . signup() . '</main>';
}

/** Everything a contributor has published, from every publication in the network. */
function contributor_work($slug) {
  $out = [];
  foreach (get_sites(['number' => 50]) as $site) {
    switch_to_blog($site->blog_id);
    if (post_type_exists('ih_piece')) {
      $q = get_posts(['post_type' => 'ih_piece', 'numberposts' => -1, 'post_status' => 'publish',
        'meta_query' => [['key' => 'ih_contributors', 'value' => $slug, 'compare' => 'LIKE']]]);
      foreach ($q as $p) {
        if (!in_array($slug, array_map('trim', explode(',', (string) m($p->ID, 'ih_contributors'))), true)) { continue; }
        $issue = get_post((int) m($p->ID, 'ih_issue_id'));
        $out[get_bloginfo('name')][] = ['title' => get_the_title($p), 'url' => get_permalink($p), 'issue' => $issue ? (m($issue->ID, 'ih_label') ?: get_the_title($issue)) : '', 'genre' => ($g = piece_genre($p)) ? $g->name : ''];
      }
    }
    restore_current_blog();
  }
  return $out;
}

function view_contributor($c) {
  $h = '<main class="ih-main ih-contrib">' . back_link() . '<div class="ih-contrib-h">';
  $img = m($c->ID, 'ih_headshot_id') ? wp_get_attachment_image_url((int) m($c->ID, 'ih_headshot_id'), 'medium') : '';
  if ($img) { $h .= '<img class="ih-headshot" src="' . a($img) . '" alt="Portrait of ' . a(get_the_title($c)) . '" width="160" height="160">'; }
  $h .= '<div><h1>' . e(get_the_title($c)) . '</h1>';
  if (m($c->ID, 'ih_bio')) { $h .= '<p class="ih-bio">' . e(m($c->ID, 'ih_bio')) . '</p>'; }
  if (m($c->ID, 'ih_url')) { $h .= '<p><a href="' . a(m($c->ID, 'ih_url')) . '" rel="me noopener">' . e(preg_replace('#^https?://(www\.)?#', '', rtrim(m($c->ID, 'ih_url'), '/'))) . '</a></p>'; }
  $h .= '</div></div>';
  if (m($c->ID, 'ih_shelf')) { $h .= wp_kses_post(m($c->ID, 'ih_shelf')); }
  $work = contributor_work($c->post_name);
  foreach ($work as $pub => $items) {
    $h .= '<section><h2>' . e($pub) . '</h2><ul class="ih-list">';
    foreach ($items as $it) { $h .= '<li><a href="' . a($it['url']) . '"><span class="ih-pt">' . e($it['title']) . '</span><span class="ih-pa">' . e(trim($it['issue'] . ($it['genre'] ? ' · ' . $it['genre'] : ''), ' ·')) . '</span></a></li>'; }
    $h .= '</ul></section>';
  }
  if (!$work) { $h .= '<p class="ih-sub">No published work yet.</p>'; }
  return $h . '</main>';
}

function view_contributors() {
  $q = get_posts(['post_type' => 'ih_contributor', 'numberposts' => -1, 'post_status' => 'publish', 'orderby' => 'title', 'order' => 'ASC']);
  $h = '<main class="ih-main">' . back_link() . '<h1 class="ih-h1">Contributors</h1><ul class="ih-list ih-cols">';
  foreach ($q as $c) { $h .= '<li><a href="' . a(get_permalink($c)) . '"><span class="ih-pt">' . e(get_the_title($c)) . '</span></a></li>'; }
  return $h . '</ul></main>';
}

function view_genre($term) {
  $q = get_posts(['post_type' => 'ih_piece', 'numberposts' => -1, 'post_status' => 'publish', 'tax_query' => [['taxonomy' => 'ih_genre', 'terms' => $term->term_id]], 'orderby' => 'date', 'order' => 'DESC']);
  $h = '<main class="ih-main"><h1 class="ih-h1">' . e($term->name) . '</h1><ul class="ih-list ih-cols">';
  foreach ($q as $p) { $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(m($p->ID, 'ih_author_name')) . '</span></a></li>'; }
  return $h . '</ul></main>';
}

function view_books() {
  $h = '<main class="ih-main"><h1 class="ih-h1">Books</h1><div class="ih-grid">';
  foreach (get_posts(['post_type' => 'ih_book', 'numberposts' => -1, 'post_status' => 'publish']) as $b) { $h .= '<div class="ih-gi"><a href="' . a(get_permalink($b)) . '" aria-label="' . a(get_the_title($b)) . '">' . cover($b, get_the_title($b) . ' cover') . '</a><h3><a href="' . a(get_permalink($b)) . '">' . e(get_the_title($b)) . '</a></h3></div>'; }
  return $h . '</div>' . signup() . '</main>';
}
function view_book_page($b) {
  return '<main class="ih-main"><div class="ih-hero">' . cover($b, get_the_title($b) . ' cover') . '<div class="ih-hero-t"><h1>' . e(get_the_title($b)) . '</h1>' . ($b->post_excerpt ? '<p class="ih-note">' . e($b->post_excerpt) . '</p>' : '') . (m($b->ID, 'ih_buy_url') ? '<div class="ih-btns">' . btn(m($b->ID, 'ih_buy_url'), 'Buy this book') . '</div>' : '') . '</div></div></main>';
}
function view_episodes() {
  $h = '<main class="ih-main"><h1 class="ih-h1">Episodes</h1><ul class="ih-list">';
  foreach (get_posts(['post_type' => 'ih_episode', 'numberposts' => -1, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']) as $p) {
    $g = get_post((int) m($p->ID, 'ih_guest_id'));
    $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(trim(($g ? get_the_title($g) . ' · ' : '') . get_the_date('', $p), ' ·')) . '</span></a></li>';
  }
  return $h . '</ul>' . signup() . '</main>';
}
function view_guests() {
  $h = '<main class="ih-main"><h1 class="ih-h1">Guests</h1><ul class="ih-list ih-cols">';
  foreach (get_posts(['post_type' => 'ih_guest', 'numberposts' => -1, 'post_status' => 'publish', 'orderby' => 'title', 'order' => 'ASC']) as $g) { $h .= '<li><a href="' . a(get_permalink($g)) . '"><span class="ih-pt">' . e(get_the_title($g)) . '</span></a></li>'; }
  return $h . '</ul></main>';
}
function view_guest($g) {
  $img = get_the_post_thumbnail_url($g, 'medium') ?: (m($g->ID, 'ih_headshot_id') ? wp_get_attachment_image_url((int) m($g->ID, 'ih_headshot_id'), 'medium') : '');
  $h = '<main class="ih-main ih-contrib"><div class="ih-contrib-h">' . ($img ? '<img class="ih-headshot" src="' . a($img) . '" alt="Portrait of ' . a(get_the_title($g)) . '" width="160" height="160">' : '') . '<div><h1>' . e(get_the_title($g)) . '</h1>' . (m($g->ID, 'ih_bio') ? '<p class="ih-bio">' . e(m($g->ID, 'ih_bio')) . '</p>' : '') . '</div></div><section><h2>Episodes</h2><ul class="ih-list">';
  foreach (get_posts(['post_type' => 'ih_episode', 'numberposts' => -1, 'post_status' => 'publish', 'meta_key' => 'ih_guest_id', 'meta_value' => $g->ID]) as $p) { $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(get_the_date('', $p)) . '</span></a></li>'; }
  return $h . '</ul></section></main>';
}

function view_archive() {
  $q = get_posts(['post_type' => 'ih_issue', 'numberposts' => -1, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']);
  $h = '<main class="ih-main"><h1 class="ih-h1">Archive</h1><div class="ih-grid">';
  foreach ($q as $i) {
    $h .= '<div class="ih-gi"><a href="' . a(get_permalink($i)) . '">' . (get_the_post_thumbnail_url($i, 'medium') ? cover($i, 'Cover of ' . get_the_title($i)) : '') . '</a><h3><a href="' . a(get_permalink($i)) . '">' . e(m($i->ID, 'ih_label') ?: get_the_title($i)) . '</a></h3></div>';
  }
  return $h . '</div></main>';
}

/** Prices from the shop service (cached ten minutes): sku => print price in cents. */
function shop_prices() {
  $c = get_transient('ih_shop_prices'); if (is_array($c)) { return $c; }
  $out = []; $base = getenv('SHOP_SERVICE_URL');
  if ($base) {
    $r = wp_remote_get(rtrim($base, '/') . '/products', ['timeout' => 8]);
    if (!is_wp_error($r) && wp_remote_retrieve_response_code($r) === 200) {
      foreach ((array) json_decode(wp_remote_retrieve_body($r), true) as $sku => $p) { foreach (($p['formats'] ?? []) as $f) { if (($f['format'] ?? '') === 'print') { $out[$sku] = (int) $f['price_cents']; } } }
    }
  }
  set_transient('ih_shop_prices', $out, 10 * MINUTE_IN_SECONDS);
  return $out;
}
/** "From the shop" on the hub home: the books on sale, as in the mockup (cover, title, kind and price). */
function shop_strip() {
  $prices = shop_prices();
  $h = '<section aria-label="From the shop" class="ih-shop"><div class="ih-shop-h"><h2 class="ih-h2" style="text-align:left">From the shop</h2><a href="' . a(home_url('/shop/')) . '">Visit the shop &rarr;</a></div><div class="ih-grid ih-shop-grid">';
  foreach (get_posts(['post_type' => 'ih_book', 'numberposts' => 4, 'post_status' => ['publish', 'future'], 'orderby' => 'date', 'order' => 'DESC']) as $b) {
    $img = get_the_post_thumbnail_url($b, 'medium'); $sku = m($b->ID, 'ih_sku');
    $meta = 'Print issue' . (isset($prices[$sku]) ? ' · $' . number_format($prices[$sku] / 100, 2) : '');
    $h .= '<a class="ih-gi" href="' . a(home_url('/shop/' . $b->post_name . '/')) . '">' . ($img ? '<div class="ih-cover"><img src="' . a($img) . '" alt="' . a('Cover of ' . get_the_title($b)) . '" width="480" height="690" loading="lazy"></div>' : '<div class="ih-cover ih-cover-e" role="img" aria-label="' . a(get_the_title($b)) . '"></div>')
       . '<span class="ih-pt">' . e(get_the_title($b)) . '</span><span class="ih-pa">' . e($meta) . '</span></a>';
  }
  return $h . '</div></section>';
}

function view_hub() {
  $h = '<main class="ih-main"><section id="publications" aria-label="Publications"><h2 class="ih-h2">Our publications</h2><div class="ih-grid">';
  $lines = ['review' => 'A quarterly of poetry, short prose and art.', 'whiterabbit' => 'Published only on Friday the 13th.', 'muse' => 'A magazine for writers.'];
  foreach (['review' => 'Inkhorn Review', 'whiterabbit' => 'White Rabbit', 'muse' => 'Muse'] as $k => $name) {
    $sid = get_sites(['path' => '/' . $k . '/', 'number' => 1]);
    $cur = null; $img = ''; $lab = '';
    if ($sid) {
      switch_to_blog($sid[0]->blog_id);
      $cur = current_issue();
      if ($cur) { $img = get_the_post_thumbnail_url($cur, 'large'); $lab = m($cur->ID, 'ih_label') ?: get_the_title($cur); }
      if (!$img && ($cv = get_page_by_path('cover', OBJECT, 'page'))) { $img = get_the_post_thumbnail_url($cv, 'large'); } // art we already have, until the first issue has a cover
      restore_current_blog();
    }
    $url = pub_url($k);
    $h .= '<div class="ih-gi"><a href="' . a($url) . '" aria-label="' . a($name . ($lab ? ': ' . $lab : '')) . '">' . ($img ? '<div class="ih-cover"><img src="' . a($img) . '" alt="' . a($lab ? 'Cover of ' . $name . ', ' . $lab : $name . ' artwork') . '" width="480" height="690"></div>' : '<div class="ih-cover ih-cover-e" role="img" aria-label="' . a($name) . '"></div>')
       . '</a><h3><a href="' . a($url) . '">' . e($name) . '</a></h3><p>' . e($lines[$k]) . '</p>' . ($lab ? '<p><a href="' . a($url) . '">' . e($lab) . ' &rarr;</a></p>' : '') . '</div>';
  }
  $h .= '</div></section>' . shop_strip()
     . '<section aria-label="Donate" class="ih-support"><h2 class="ih-h2">Donate</h2><p>Inkhorn Press is a nonprofit. Gifts pay contributors and print the issues.</p><p>' . btn(home_url('/donate/'), 'Donate') . '</p></section>'
     . signup('Get Inkhorn Press by email.') . '</main>';
  return $h;
}

function view_author_home() {
  $q = get_posts(['post_type' => 'ih_book', 'numberposts' => 6, 'post_status' => 'publish']);
  $h = '<main class="ih-main"><section><h2 class="ih-h2">Books</h2><div class="ih-grid">';
  foreach ($q as $b) { $h .= '<div class="ih-gi"><a href="' . a(get_permalink($b)) . '">' . cover($b, 'Cover of ' . get_the_title($b)) . '</a><h3><a href="' . a(get_permalink($b)) . '">' . e(get_the_title($b)) . '</a></h3></div>'; }
  $h .= '</div></section><section><h2 class="ih-h2">Writing</h2><ul class="ih-list">';
  foreach (get_posts(['post_type' => 'post', 'numberposts' => 12, 'post_status' => 'publish']) as $p) {
    $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(get_the_date('', $p)) . '</span></a></li>';
  }
  return $h . '</ul></section>' . signup() . '</main>';
}

function view_podcast_home() {
  $h = '<main class="ih-main"><h2 class="ih-h2">Episodes</h2><ul class="ih-list">';
  foreach (get_posts(['post_type' => 'ih_episode', 'numberposts' => 12, 'post_status' => 'publish']) as $p) {
    $g = get_post((int) m($p->ID, 'ih_guest_id'));
    $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e($g ? get_the_title($g) : '') . '</span></a></li>';
  }
  return $h . '</ul>' . signup() . '</main>';
}

function view_episode($p) {
  $g = get_post((int) m($p->ID, 'ih_guest_id'));
  $h = '<main class="ih-main"><article class="ih-piece"><p class="ih-eyebrow">Episode' . (m($p->ID, 'ih_number') ? ' ' . e(m($p->ID, 'ih_number')) : '') . '</p><h1>' . e(get_the_title($p)) . '</h1>';
  if ($g) {
    $img = m($g->ID, 'ih_headshot_id') ? wp_get_attachment_image_url((int) m($g->ID, 'ih_headshot_id'), 'medium') : '';
    $h .= '<div class="ih-contrib-h">' . ($img ? '<img class="ih-headshot" src="' . a($img) . '" alt="Portrait of ' . a(get_the_title($g)) . '" width="160" height="160">' : '') . '<div><p class="ih-by"><a href="' . a(get_permalink($g)) . '">' . e(get_the_title($g)) . '</a></p></div></div>';
  }
  $h .= host_line();
  if (m($p->ID, 'ih_audio_url')) { $h .= '<audio controls preload="none" src="' . a(m($p->ID, 'ih_audio_url')) . '"></audio>'; }
  return $h . '<div class="ih-body">' . apply_filters('the_content', $p->post_content) . '</div></article>' . related_block('Related essays', related_from($p, 'terryheath', ['post'], 3)) . related_block('More episodes', related_from($p, 'lifeonwords', ['ih_episode'], 3)) . signup() . '</main>';
}

function view_generic($p) {
  $extra = '';
  if (site_key() === 'hub' && $p && $p->post_name === 'donate') { // supporters list kept fresh by patreon-sync-wp.js
    $row = get_site_option('inkhorn_store_patreon-supporters', null); $d = $row ? json_decode($row['json'], true) : null;
    if ($d && !empty($d['names'])) { $extra = '<h2>Thank you to our Patreon supporters</h2><p>' . e(implode(', ', $d['names'])) . (!empty($d['anonymous']) ? ' and ' . (int) $d['anonymous'] . ' anonymous supporter' . ($d['anonymous'] > 1 ? 's' : '') : '') . '.</p>'; }
  }
  $rel = ($p && $p->post_type === 'post' && site_key() === 'terryheath') ? related_block('Related episodes of Life on Words', related_from($p, 'lifeonwords', ['ih_episode'], 3)) : '';
  return '<main class="ih-main">' . back_link() . '<article class="ih-piece"><h1>' . e(get_the_title($p)) . '</h1><div class="ih-body">' . apply_filters('the_content', $p->post_content) . $extra . '</div></article>' . $rel . ($p && $p->post_type === 'post' ? signup() : '') . '</main>';
}

/** A publication with no issue yet (White Rabbit before No. 1, Muse): says what it is and when, and offers its newsletter. */
function view_publication_soon() {
  $s = site(); $k = site_key();
  $line = ['whiterabbit' => 'Published only on Friday the 13th. Issue No. 1 comes out on Friday, August 13, 2027.', 'muse' => 'Post a poem or short prose, and readers decide what gets published each season. Muse is an app at gomuse.io.'][$k] ?? '';
  $h = '<main class="ih-main"><section class="ih-hero-t" style="text-align:center;max-width:34rem;margin:0 auto"><p class="ih-kicker">' . e($s['name']) . '</p><h1 class="ih-h1" style="margin-top:8px">' . ($k === 'whiterabbit' ? 'Issue No. 1' : e($s['name'])) . '</h1><p class="ih-note" style="margin:0 auto">' . e($line) . '</p>'
     . '<p class="ih-sub">Details coming soon.</p><div class="ih-btns" style="justify-content:center">';
  if ($k === 'muse') { $h .= btn('https://gomuse.io', 'Open Muse'); }
  if ($k === 'whiterabbit') { $h .= btn(hub_link('events/'), 'About Weird Friday'); }
  return $h . '</div></section>' . signup() . '</main>';
}

function view_404() {
  $s = site();
  return '<main class="ih-main"><h1 class="ih-h1">That page isn’t here.</h1><p class="ih-note">It may have moved. Try the ' . ($s['kind'] === 'publication' ? 'current issue' : 'home page') . ', or search.</p>'
    . '<div class="ih-btns">' . btn(home_url('/'), $s['kind'] === 'publication' ? 'Current issue' : 'Home') . btn(home_url('/?s='), 'Search') . '</div></main>';
}

function view_search() {
  $q = get_search_query();
  $all = !empty($_GET['all']);
  $h = '<main class="ih-main"><h1 class="ih-h1">Search</h1><form role="search" class="ih-form" method="get" action="' . a(home_url('/')) . '"><div class="ih-row"><label class="ih-sr" for="ih-s">Search</label>'
     . '<input id="ih-s" type="search" name="s" value="' . a($q) . '"><button class="ih-btn" type="submit">Search</button></div>';
  if (site()['bar']) { $h .= '<label class="ih-chk"><input type="checkbox" name="all" value="1"' . ($all ? ' checked' : '') . '> Search all of Inkhorn Press</label>'; }
  $h .= '</form><ul class="ih-list">';
  $sites = ($all && site()['bar']) ? get_sites(['number' => 50]) : [get_site(get_current_blog_id())];
  $n = 0;
  foreach ($sites as $st) {
    switch_to_blog($st->blog_id);
    foreach (get_posts(['s' => $q, 'post_type' => ['ih_piece', 'ih_issue', 'ih_contributor', 'ih_book', 'ih_episode', 'post', 'page'], 'numberposts' => 20, 'post_status' => 'publish']) as $p) {
      $n++;
      $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(get_bloginfo('name')) . '</span></a></li>';
    }
    restore_current_blog();
  }
  if ($q && !$n) { $h .= '<li class="ih-sub">Nothing found. Try fewer words' . (site()['bar'] && !$all ? ', or search all of Inkhorn Press' : '') . '.</li>'; }
  return $h . '</ul></main>';
}

/** Dispatcher: what the current request shows. */
function render_page() {
  $k = site()['kind'];
  $v = get_query_var('ih_view');
  if ($v === 'help') { return view_help(); }
  if ($v === 'start-here') { return view_start_here(); }
  if ($v === 'nl-confirmed') { return view_nl_confirmed(); }
  if ($v === 'nl-expired') { return view_nl_expired(); }
  if ($v === 'signin') { return view_signin(); }
  if ($v === 'account') { return view_account(); }
  if ($v === 'newsletter') { return view_newsletter(); }
  if (in_array($v, ['shop', 'cart', 'order-complete', 'subscriptions'], true)) { return view_shop_page($v); }
  if ($v === 'book') { return view_book(); }
  if (is_404()) { return view_404(); }
  if (is_search()) { return view_search(); }
  if (is_front_page() || is_home()) {
    if ($k === 'publication') { $i = current_issue(); return $i ? view_issue($i) : view_publication_soon(); }
    if ($k === 'hub') { return view_hub(); }
    if ($k === 'author') { return view_author_home(); }
    if ($k === 'podcast') { return view_podcast_home(); }
  }
  if (is_singular('ih_issue')) { return view_issue(get_queried_object()); }
  if (is_singular('ih_piece')) { return view_piece(get_queried_object()); }
  if (is_singular('ih_contributor')) { return view_contributor(get_queried_object()); }
  if (is_tax('ih_genre')) { return view_genre(get_queried_object()); }
  if (is_post_type_archive('ih_contributor')) { return view_contributors(); }
  if (is_post_type_archive('ih_book')) { return view_books(); }
  if (is_post_type_archive('ih_episode')) { return view_episodes(); }
  if (is_post_type_archive('ih_guest')) { return view_guests(); }
  if (is_singular('ih_guest')) { return view_guest(get_queried_object()); }
  if (is_singular('ih_book')) { return view_book_page(get_queried_object()); }
  if (is_post_type_archive('ih_issue')) { return view_archive(); }
  if (is_singular('ih_episode')) { return view_episode(get_queried_object()); }
  if (is_singular()) { return view_generic(get_queried_object()); }
  return view_404();
}
