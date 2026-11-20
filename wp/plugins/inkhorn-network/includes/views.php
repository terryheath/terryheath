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
/** The Inkhorn Press bar is gone: only the welcome band (first visit, Inkhorn Press sites) sits above a site's own masthead. */
function press_bar() { return welcome_band(); }

function back_link() {
  if (site_key() !== 'hub' || empty($_GET['from'])) { return ''; }
  $from = sanitize_key($_GET['from']);
  $all = sites();
  if (!isset($all[$from]) || $all[$from]['kind'] !== 'publication') { return ''; }
  return '<p class="ih-back"><a href="' . a(pub_url($from)) . '">&larr; Back to ' . e($all[$from]['name']) . '</a></p>';
}

function img_url($f) { return INKHORN_URL . '/assets/img/' . $f; }

/** Each site has its own centred masthead and nav: reading links, a thin divider, then Shop / Newsletter / Sign in. */
function site_header() {
  $s = site(); $k = site_key(); $home = home_url('/');
  switch ($k) {
    case 'hub':
      $m = '<a class="ih-mast-home ih-mast-stack" href="' . a($home) . '" aria-label="Inkhorn Press, home"><img src="' . a(img_url('inkhorn-press-logo.png')) . '" alt="" width="132" height="132"><span class="ih-mast-name">Inkhorn Press</span></a>'
         . '<p class="ih-label ih-mast-line">A 501(c)(3) nonprofit press</p>';
      $left = [['Publications', home_url('/#publications')], ['Events', home_url('/events/')], ['About', home_url('/about/')], ['Submit', home_url('/submit/')]];
      $right = [['Shop', home_url('/shop/')], ['Donate', home_url('/donate/')], ['Newsletter', home_url('/newsletter/')]];
      break;
    case 'review':
      $m = '<a class="ih-mast-home" href="' . a($home) . '" aria-label="Inkhorn Review, home"><img class="ih-mast-img" src="' . a(img_url('inkhorn-review-header.png')) . '" alt="Inkhorn Review" width="251" height="112"></a>' . pub_line();
      $left = [['Current issue', $home], ['Archive', home_url('/issues/')], ['About', home_url('/about/')], ['Submit', !empty($s['submit']) ? $s['submit'] : hub_url('submit/')]];
      $right = [['Shop', hub_url('shop/')], ['Newsletter', hub_url('newsletter/')]];
      break;
    case 'whiterabbit':
      $m = '<a class="ih-mast-home ih-mast-rabbit" href="' . a($home) . '">White Rabbit</a><p class="ih-mast-sc">Published only on Friday the 13th</p>' . pub_line();
      $left = [['Current issue', $home], ['Archive', home_url('/issues/')], ['About', home_url('/about/')], ['Submit', hub_url('submit/')]];
      $right = [['Shop', hub_url('shop/')], ['Newsletter', hub_url('newsletter/')]];
      break;
    case 'terryheath':
      $m = '<a class="ih-mast-home ih-mast-stack" href="' . a($home) . '" aria-label="Terry Heath, home"><img src="' . a(img_url('th-wrc-avatar.png')) . '" alt="" width="72" height="70"><span class="ih-mast-name">Terry Heath</span></a><p class="ih-label ih-mast-line ih-mast-acc">Writer · Educator · Editor · Host</p>';
      $left = [['Writing', $home], ['Life on Words', pub_url('lifeonwords')], ['Books', home_url('/books/')], ['About', home_url('/about/')]];
      $right = [['Newsletter', home_url('/#newsletter')]];
      break;
    default: // lifeonwords
      $m = '<a class="ih-mast-home" href="' . a($home) . '" aria-label="Life on Words, home"><img class="ih-mast-img ih-mast-low" src="' . a(img_url('th-LOW-tag-page-1.png')) . '" alt="Life on Words" width="337" height="150"></a>'
         . '<p class="ih-label ih-mast-line"><span class="ih-ph-inline">[Tagline]</span> · Hosted by <a class="ih-acc-link" href="' . a(pub_url('terryheath')) . '">Terry Heath</a></p>';
      $left = [['Episodes', home_url('/episodes/')], ['Guests', home_url('/guests/')], ['About', home_url('/about/')]];
      $right = [['Newsletter', home_url('/#newsletter')]];
  }
  $h = '<header class="ih-head">' . $m . '<nav class="ih-nav" aria-label="Site"><div class="ih-nav-g">';
  foreach ($left as $n) { $h .= nav_a($n[1], $n[0]); }
  $h .= '</div><div class="ih-nav-div" aria-hidden="true"></div><div class="ih-nav-g">';
  foreach ($right as $n) { $h .= nav_a($n[1], $n[0]); }
  return $h . account_link() . '</div></nav></header>';
}
function pub_line() { return '<p class="ih-publine">An <a href="' . a(hub_url()) . '">Inkhorn Press</a> publication</p>'; }

function site_footer() {
  $s = site(); $k = site_key();
  switch ($s['kind']) {
    case 'publication': $line = e($s['name']) . ' is a publication of <a href="' . a(hub_url()) . '">Inkhorn Press</a>, a 501(c)(3) nonprofit press.'; break;
    case 'hub': $line = 'Inkhorn Press is a 501(c)(3) nonprofit press.'; break;
    case 'podcast': $line = 'Life on Words is produced by Follow the Rabbit LLC. · <a href="' . a(pub_url('terryheath')) . '">terryheath.com</a>'; break;
    default: $line = 'terryheath.com is published by Follow the Rabbit LLC. · <a href="' . a(pub_url('lifeonwords')) . '">Life on Words</a>';
  }
  return '<footer class="ih-foot"><div class="ih-foot-in"><span>' . $line . '</span><nav aria-label="Footer"><div>' . nav_a(home_url('/help/'), 'Help') . nav_a(hub_link('privacy/'), 'Privacy')
    . nav_a(hub_link('terms/'), 'Terms') . nav_a(hub_link('newsletter/'), 'Newsletter preferences') . nav_a(home_url('/?s='), 'Search') . '</div></nav></div></footer>';
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
  $id = get_post_thumbnail_id($post); $src = $id ? wp_get_attachment_image_src($id, 'large') : null;
  if (!$src) { return ''; }
  return '<div class="ih-cover"><img src="' . a($src[0]) . '" alt="' . a($alt) . '" width="' . (int) $src[1] . '" height="' . (int) $src[2] . '"></div>'; // real proportions, never cropped
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

/** The issue's line is the excerpt of the product it is sold as (the shop's description field). */
function issue_line_from_shop($issue) {
  $path = trim((string) m($issue->ID, 'ih_shop_url'), '/'); if ($path === '') { return ''; }
  $slug = basename($path); $line = '';
  switch_to_blog(get_main_site_id());
  $b = get_posts(['post_type' => 'ih_book', 'name' => $slug, 'numberposts' => 1, 'post_status' => ['publish', 'future']]);
  if ($b) { $line = trim((string) $b[0]->post_excerpt); if (preg_match('/^(.+?[.!?]["”’)]*)(?=\s|$)/us', $line, $mm)) { $line = $mm[1]; } } // the first sentence only: the meta line already gives the piece count
  restore_current_blog();
  return $line;
}
function view_issue($issue) {
  $pieces = issue_pieces($issue->ID);
  $label = m($issue->ID, 'ih_label') ?: get_the_title($issue);
  $cur = current_issue(); $is_cur = $cur && $cur->ID === $issue->ID;
  $groups = [];
  foreach ($pieces as $p) { $g = piece_genre($p); $groups[$g ? $g->slug : 'other'][] = $p; }
  $names = [];
  foreach (genre_order() as $g) { if (!empty($groups[$g])) { $t = get_term_by('slug', $g, 'ih_genre'); $names[] = $t ? $t->name : ucfirst($g); } }
  $first = $pieces ? get_permalink($pieces[0]) : '';
  $shop = shop_link(m($issue->ID, 'ih_shop_url'));
  $base = get_permalink($issue);
  $by_genre = (($_GET['view'] ?? '') === 'genre');
  $h = '<main class="ih-main"><section class="ih-folio" aria-label="' . ($is_cur ? 'Current issue' : 'Issue') . '"><div class="ih-folio-cover">' . cover($issue, 'Cover of ' . $label) . '</div><div class="ih-folio-t">'
     . '<p class="ih-label">' . ($is_cur ? 'The current issue' : 'Issue') . '</p><h1 class="ih-h1-xl">' . e($label) . '</h1>';
  $note = m($issue->ID, 'ih_note') ?: issue_line_from_shop($issue);
  if ($note) { $h .= '<p class="ih-folio-line">' . e($note) . '</p>'; }
  $h .= '<p class="ih-folio-meta">' . count($pieces) . ' pieces' . ($names ? ' · ' . e(implode(' · ', $names)) : '') . '</p><div class="ih-btns">';
  if ($shop) { $h .= btn($shop, 'Buy the print issue') . '<a class="ih-btn" href="' . a(hub_link('shop/subscriptions/')) . '">Subscriptions</a>'; }
  if ($first) { $h .= '<a class="ih-btn-link" href="' . a($first) . '">Start reading &rarr;</a>'; }
  $h .= '</div><div class="ih-sechead"><h2>In this issue</h2><div role="group" aria-label="View" class="ih-views"><a href="' . a($base) . '"' . (!$by_genre ? ' aria-current="true"' : '') . '>In order</a><a href="' . a(add_query_arg('view', 'genre', $base)) . '"' . ($by_genre ? ' aria-current="true"' : '') . '>By genre</a></div></div>';
  $row = function ($p) { $pg = piece_genre($p); return '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-toc-t">' . e(get_the_title($p)) . '</span><span class="ih-toc-m">' . e(m($p->ID, 'ih_author_name') . ($pg ? ' · ' . $pg->name : '')) . '</span></a></li>'; };
  if (!$by_genre) {
    $h .= '<ol class="ih-toc">'; foreach ($pieces as $p) { $h .= $row($p); } $h .= '</ol>';
  } else {
    foreach (array_merge(genre_order(), ['other']) as $g) {
      if (empty($groups[$g])) { continue; }
      $term = get_term_by('slug', $g, 'ih_genre');
      $h .= '<h3 class="ih-label ih-toc-g">' . e($term ? $term->name : 'More') . '</h3><ul class="ih-toc">'; foreach ($groups[$g] as $p) { $h .= $row($p); } $h .= '</ul>';
    }
  }
  return $h . '</div></section>' . signup() . '</main>';
}

function view_piece($p) {
  $issue = get_post((int) m($p->ID, 'ih_issue_id'));
  $label = $issue ? (m($issue->ID, 'ih_label') ?: get_the_title($issue)) : '';
  $g = piece_genre($p);
  $poem = $g && $g->slug === 'poetry';
  $h = '<main class="ih-main"><article class="ih-piece"><header class="ih-piece-h"><p class="ih-label">'
     . ($issue ? '<a href="' . a(get_permalink($issue)) . '">' . e($label) . '</a>' : '') . ($g ? ' · ' . e($g->name) : '') . '</p>'
     . '<h1 class="ih-h1-l">' . e(get_the_title($p)) . '</h1><p class="ih-by">' . contributor_links($p) . '</p></header>'
     . '<div class="ih-body' . ($poem ? ' ih-poem' : '') . '">' . wp_kses_post($p->post_content) . '</div><p class="ih-dots" aria-hidden="true">· · ·</p><section class="ih-aboutp">';
  if (m($p->ID, 'ih_bio')) { $h .= '<p class="ih-bio">' . e(m($p->ID, 'ih_bio')) . '</p>'; }
  if (m($p->ID, 'ih_nomination')) { $h .= '<p class="ih-nom">' . e(m($p->ID, 'ih_nomination')) . '</p>'; }
  $slugs = array_filter(array_map('trim', explode(',', (string) m($p->ID, 'ih_contributors'))));
  if ($slugs) { $h .= '<p class="ih-all"><a href="' . a(hub_link('contributors/' . $slugs[0] . '/')) . '">All work by ' . e(m($p->ID, 'ih_author_name')) . ' &rarr;</a></p>'; }
  $h .= '</section></article>';
  if ($issue) {
    $list = issue_pieces($issue->ID); $i = null;
    foreach ($list as $n => $q) { if ($q->ID === $p->ID) { $i = $n; } }
    $prev = ($i !== null && $i > 0) ? $list[$i - 1] : null;
    $next = ($i !== null && $i < count($list) - 1) ? $list[$i + 1] : null;
    $shop = shop_link(m($issue->ID, 'ih_shop_url'));
    $h .= '<nav class="ih-pn" aria-label="Previous and next in this issue"><div>';
    if ($prev) { $h .= '<a href="' . a(get_permalink($prev)) . '"><span class="ih-label">&larr; Previous</span><b>' . e(get_the_title($prev)) . '</b><i>' . e(m($prev->ID, 'ih_author_name')) . '</i></a>'; }
    $h .= '</div><div class="ih-pn-r">';
    if ($next) { $h .= '<a href="' . a(get_permalink($next)) . '"><span class="ih-label">Next &rarr;</span><b>' . e(get_the_title($next)) . '</b><i>' . e(m($next->ID, 'ih_author_name')) . '</i></a>'; }
    $h .= '</div></nav>';
    if ($shop) { $h .= '<div class="ih-buyrow">' . btn($shop, 'Buy the print issue') . '<a class="ih-btn" href="' . a(hub_link('shop/subscriptions/')) . '">Subscriptions</a></div>'; }
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
  if (!in_array($c->post_name, contributors_with_work(), true)) { global $wp_query; $wp_query->set_404(); status_header(404); return view_404(); }
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
  $work = contributors_with_work();
  $h = '<main class="ih-main">' . back_link() . '<h1 class="ih-h1">Contributors</h1><ul class="ih-list ih-cols">';
  foreach ($q as $c) { if (!in_array($c->post_name, $work, true)) { continue; } $h .= '<li><a href="' . a(get_permalink($c)) . '"><span class="ih-pt">' . e(get_the_title($c)) . '</span></a></li>'; }
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
  $h = '<section aria-label="From the shop" class="ih-shop"><p class="ih-label">From the shop</p><div class="ih-shop-grid">';
  foreach (shop_books(4) as $b) {
    $tid = get_post_thumbnail_id($b); $src = $tid ? wp_get_attachment_image_src($tid, 'medium') : null; $sku = m($b->ID, 'ih_sku');
    $meta = 'Print issue' . (isset($prices[$sku]) ? ' · $' . number_format($prices[$sku] / 100, 2) : '');
    $h .= '<a class="ih-shop-i" href="' . a(home_url('/shop/' . $b->post_name . '/')) . '">' . ($src ? '<div class="ih-cover"><img src="' . a($src[0]) . '" alt="' . a('Cover of ' . get_the_title($b)) . '" width="' . (int) $src[1] . '" height="' . (int) $src[2] . '" loading="lazy"></div>' : '<div class="ih-cover ih-cover-e" role="img" aria-label="' . a(get_the_title($b)) . '"></div>')
       . '<span><span class="ih-pt">' . e(get_the_title($b)) . '</span><span class="ih-pa">' . e($meta) . '</span><span class="ih-pl-link">Visit the shop &rarr;</span></span></a>';
  }
  return $h . '</div></section>';
}

function view_hub() {
  $h = '<main class="ih-main"><section id="publications" aria-label="Publications"><h1 class="ih-h1-xl ih-center">Our publications</h1><div class="ih-pubs">';
  $lines = ['review' => 'A quarterly of poetry, short prose and art.', 'whiterabbit' => 'Published only on Friday the 13th.', 'muse' => 'Poems chosen by readers, for readers.'];
  $acc = ['review' => '#2E4A3F', 'whiterabbit' => '#4B2346', 'muse' => '#3E5672'];
  foreach (['review' => 'Inkhorn Review', 'whiterabbit' => 'White Rabbit', 'muse' => 'Muse'] as $k => $name) {
    $sid = get_sites(['path' => '/' . $k . '/', 'number' => 1]);
    $cur = null; $img = ''; $lab = ''; $dim = [480, 690];
    if ($sid) {
      switch_to_blog($sid[0]->blog_id);
      $cur = current_issue();
      $src = null;
      if ($cur) { $tid = get_post_thumbnail_id($cur); $src = $tid ? wp_get_attachment_image_src($tid, 'large') : null; $lab = m($cur->ID, 'ih_label') ?: get_the_title($cur); }
      if (!$src && ($cv = get_page_by_path('cover', OBJECT, 'page'))) { $tid = get_post_thumbnail_id($cv); $src = $tid ? wp_get_attachment_image_src($tid, 'large') : null; }
      if ($src) { $img = $src[0]; $dim = [$src[1], $src[2]]; }
      restore_current_blog();
    }
    $url = pub_url($k);
    $h .= '<div class="ih-pub" style="--pa:' . $acc[$k] . '"><a class="ih-pub-cover" href="' . a($url) . '" aria-label="' . a($name . ($lab ? ': ' . $lab : '')) . '">' . ($img ? '<div class="ih-cover"><img src="' . a($img) . '" alt="' . a($lab ? 'Cover of ' . $name . ', ' . $lab : $name . ' artwork') . '" width="' . (int) $dim[0] . '" height="' . (int) $dim[1] . '"></div>' : '<div class="ih-cover ih-cover-e" role="img" aria-label="' . a($name) . '"></div>')
       . '</a><div class="ih-pub-t"><h3' . ($k === 'whiterabbit' ? ' class="ih-fell"' : '') . '><a href="' . a($url) . '">' . e($name) . '</a></h3><p>' . e($lines[$k]) . '</p>' . ($lab ? '<p class="ih-pub-l"><a href="' . a($url) . '">' . e($lab) . ' &rarr;</a></p>' : '') . '</div></div>';
  }
  $h .= '</div></section>' . shop_strip()
     . '<section aria-label="Donate" class="ih-support"><p class="ih-label">Donate</p><p class="ih-support-t">Inkhorn Press is a nonprofit. Gifts pay contributors and print the issues.</p><p>' . btn(home_url('/donate/'), 'Donate') . '</p></section>'
     . signup() . '</main>';
  return $h;
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
  return $h . '<div class="ih-body">' . apply_filters('the_content', $p->post_content) . '</div></article>' . related_block('Related essays', chosen_related($p)) . signup() . '</main>';
}

function view_generic($p) {
  $extra = '';
  if (site_key() === 'hub' && $p && $p->post_name === 'donate') { // supporters list kept fresh by patreon-sync-wp.js
    $row = get_site_option('inkhorn_store_patreon-supporters', null); $d = $row ? json_decode($row['json'], true) : null;
    if ($d && !empty($d['names'])) { $extra = '<h2>Thank you to our Patreon supporters</h2><p>' . e(implode(', ', $d['names'])) . (!empty($d['anonymous']) ? ' and ' . (int) $d['anonymous'] . ' anonymous supporter' . ($d['anonymous'] > 1 ? 's' : '') : '') . '.</p>'; }
  }
  $rel = ($p && $p->post_type === 'post' && site_key() === 'terryheath') ? related_block('Related episodes', chosen_related($p)) : '';
  return '<main class="ih-main">' . back_link() . '<article class="ih-piece"><h1>' . e(get_the_title($p)) . '</h1><div class="ih-body">' . apply_filters('the_content', $p->post_content) . $extra . '</div></article>' . $rel . ($p && $p->post_type === 'post' ? signup() : '') . '</main>';
}

/** A publication with no issue yet (White Rabbit before No. 1, Muse): says what it is and when, and offers its newsletter. */
function view_publication_soon() {
  $s = site(); $k = site_key();
  $line = ['whiterabbit' => 'Published only on Friday the 13th. Issue No. 1 comes out on Friday, August 13, 2027.'][$k] ?? '';
  $cv = get_page_by_path('cover', OBJECT, 'page'); $tid = $cv ? get_post_thumbnail_id($cv) : 0; $src = $tid ? wp_get_attachment_image_src($tid, 'large') : null;
  $h = '<main class="ih-main"><section class="ih-folio" aria-label="Issue"><div class="ih-folio-cover">' . ($src ? '<div class="ih-cover"><img src="' . a($src[0]) . '" alt="' . a($s['name'] . ' artwork') . '" width="' . (int) $src[1] . '" height="' . (int) $src[2] . '"></div>' : '<div class="ih-cover ih-cover-e" role="img" aria-label="' . a($s['name']) . '"></div>') . '</div><div class="ih-folio-t">'
     . '<p class="ih-label">' . ($k === 'whiterabbit' ? 'Issue No. 1' : e($s['name'])) . '</p><h1 class="ih-h1-xl">' . ($k === 'whiterabbit' ? 'Friday, August 13, 2027' : e($s['name'])) . '</h1>'
     . ($k === 'whiterabbit' ? ph('One line about the issue') : '') . '<p class="ih-folio-meta">Details coming soon.</p><div class="ih-btns">';
  if ($k === 'whiterabbit') { $h .= btn(hub_link('events/'), 'About Weird Friday'); }
  return $h . '</div></div></section>' . signup() . '</main>';
}

function view_404() {
  $s = site();
  return '<main class="ih-main"><h1 class="ih-h1">That page isn’t here.</h1><p class="ih-note">It may have moved. Try the ' . ($s['kind'] === 'publication' ? 'current issue' : 'home page') . ', or search.</p>'
    . '<div class="ih-btns">' . btn(home_url('/'), $s['kind'] === 'publication' ? 'Current issue' : 'Home') . btn(home_url('/?s='), 'Search') . '</div></main>';
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
