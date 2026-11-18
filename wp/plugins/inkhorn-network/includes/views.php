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

function btn($href, $label, $extra = '') {
  return '<a class="ih-btn" href="' . a($href) . '"' . $extra . '>' . e($label) . '</a>';
}

/* ---------- chrome ---------- */

function press_bar() {
  if (!site()['bar']) { return ''; }
  $h = '<nav class="ih-bar" aria-label="Inkhorn Press"><div class="ih-bar-in"><div class="ih-bar-l">'
    . '<a class="ih-bar-name" href="' . a(hub_url()) . '">INKHORN PRESS</a>'
    . '<a href="' . a(pub_url('review')) . '">Review</a><a href="' . a(pub_url('whiterabbit')) . '">White Rabbit</a><a href="' . a(pub_url('muse')) . '">Muse</a></div>'
    . '<div class="ih-bar-r"><a href="' . a(hub_link('shop/')) . '">Shop</a><a href="' . a(hub_link('contributors/')) . '">Contributors</a>'
    . '<a href="' . a(hub_link('preferences/')) . '">Subscribe</a><a href="' . a(hub_link('support/')) . '">Support</a></div></div></nav>';
  return $h;
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
      $nav = [['About', home_url('/about/')], ['Publications', home_url('/#publications')], ['Shop', home_url('/shop/')], ['Contributors', home_url('/contributors/')], ['Support', home_url('/support/')]];
      break;
    case 'author':
      $nav = [['Writing', home_url('/')], ['Books', home_url('/books/')], ['Podcast', 'https://lifeonwords.com/'], ['About', home_url('/about/')]];
      break;
    case 'podcast':
      $nav = [['Episodes', home_url('/episodes/')], ['Guests', home_url('/guests/')], ['About', home_url('/about/')], ['Subscribe', home_url('/#subscribe')]];
      break;
  }
  $h = '<header class="ih-head"><a class="ih-title" href="' . a(home_url('/')) . '">' . e($s['name']) . '</a><nav aria-label="' . a($s['name']) . '">';
  foreach ($nav as $n) { $h .= '<a href="' . a($n[1]) . '">' . e($n[0]) . '</a>'; }
  return $h . '</nav></header>';
}

function site_footer() {
  $s = site();
  $line = $s['kind'] === 'hub' ? 'Inkhorn Press is a nonprofit.'
    : ($s['bar'] ? e($s['name']) . ' is a publication of Inkhorn Press, a nonprofit.' : e($s['name']) . '.');
  return '<footer class="ih-foot"><div class="ih-foot-in"><span>' . $line . '</span><div><a href="' . a(hub_link('privacy/')) . '">Privacy</a>'
    . '<a href="' . a(hub_link('terms/')) . '">Terms</a><a href="' . a(hub_link('preferences/')) . '">Manage email</a></div></div></footer>';
}

/* ---------- signup ---------- */

function signup($title = '', $all_lists = true) {
  $s = site(); $mine = $s['lists'];
  $family = ($s['kind'] === 'author') ? ['writing', 'digest', 'new-books'] : (($s['kind'] === 'podcast') ? ['life-on-words'] : ['inkhorn-review', 'white-rabbit', 'muse', 'events']);
  $title = $title ?: 'Get ' . $s['short'] . ' by email.';
  $h = '<section class="ih-signup" id="subscribe" aria-label="Newsletter"><p class="ih-lead">' . e($title) . '</p>'
     . '<p class="ih-sub">Choose the lists you want; change them any time.</p>'
     . '<form class="ih-form" method="post" action="' . a(rest_url('inkhorn/v1/subscribe')) . '" data-ih-signup>';
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
     . '<button type="submit" class="ih-btn">Subscribe</button></div><p class="ih-msg" role="status" aria-live="polite"></p></form></section>';
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
  $shop = m($issue->ID, 'ih_shop_url');
  $h = '<main class="ih-main"><section class="ih-hero" aria-label="' . ($is_cur ? 'Current issue' : 'Issue') . '">' . cover($issue, 'Cover of ' . $label)
     . '<div class="ih-hero-t"><p class="ih-kicker">' . ($is_cur ? 'The current issue' : 'Issue') . '</p><h1>' . e($label) . '</h1>';
  $note = m($issue->ID, 'ih_note');
  if ($note) { $h .= '<p class="ih-note">' . e($note) . '</p>'; }
  $h .= '<p class="ih-meta">' . count($pieces) . ' pieces' . ($kinds ? ' · ' . e($kinds) : '') . '</p><div class="ih-btns">';
  if ($shop) { $h .= btn($shop, 'Buy the print issue'); }
  if ($first) { $h .= btn($first, 'Start reading'); }
  $h .= '</div></div></section><section class="ih-contents" aria-label="In this issue"><h2>In this issue</h2><div class="ih-groups">';
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
    $shop = m($issue->ID, 'ih_shop_url');
    $h .= '<nav class="ih-pn" aria-label="More from this issue"><div>';
    if ($prev) { $h .= '<a href="' . a(get_permalink($prev)) . '"><span>PREVIOUS</span><b>' . e(get_the_title($prev)) . '</b><i>' . e(m($prev->ID, 'ih_author_name')) . '</i></a>'; }
    $h .= '</div><div class="ih-pn-c">' . ($shop ? btn($shop, 'Buy the print issue') : '') . '</div><div class="ih-pn-r">';
    if ($next) { $h .= '<a href="' . a(get_permalink($next)) . '"><span>NEXT</span><b>' . e(get_the_title($next)) . '</b><i>' . e(m($next->ID, 'ih_author_name')) . '</i></a>'; }
    $h .= '</div></nav>';
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

function view_archive() {
  $q = get_posts(['post_type' => 'ih_issue', 'numberposts' => -1, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']);
  $h = '<main class="ih-main"><h1 class="ih-h1">Archive</h1><div class="ih-grid">';
  foreach ($q as $i) {
    $h .= '<div class="ih-gi"><a href="' . a(get_permalink($i)) . '">' . (get_the_post_thumbnail_url($i, 'medium') ? cover($i, 'Cover of ' . get_the_title($i)) : '') . '</a><h3><a href="' . a(get_permalink($i)) . '">' . e(m($i->ID, 'ih_label') ?: get_the_title($i)) . '</a></h3></div>';
  }
  return $h . '</div></main>';
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
      restore_current_blog();
    }
    $url = pub_url($k);
    $h .= '<div class="ih-gi"><a href="' . a($url) . '" aria-label="' . a($name . ($lab ? ': ' . $lab : '')) . '">' . ($img ? '<div class="ih-cover"><img src="' . a($img) . '" alt="" width="480" height="690"></div>' : '<div class="ih-cover ih-cover-e"></div>')
       . '</a><h3><a href="' . a($url) . '">' . e($name) . '</a></h3><p>' . e($lines[$k]) . '</p>' . ($lab ? '<p><a href="' . a($url) . '">' . e($lab) . ' &rarr;</a></p>' : '') . '</div>';
  }
  $h .= '</div></section><section aria-label="From the shop" class="ih-shop"><div class="ih-shop-h"><h2 class="ih-h2">From the shop</h2><a href="' . a(home_url('/shop/')) . '">Visit the shop &rarr;</a></div></section>'
     . '<section aria-label="Support the press" class="ih-support"><h2 class="ih-h2">Support the press</h2><p>Inkhorn Press is a nonprofit. Gifts pay contributors and print the issues.</p><p>' . btn(home_url('/support/'), 'Donate') . '</p></section>'
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
  if (m($p->ID, 'ih_audio_url')) { $h .= '<audio controls preload="none" src="' . a(m($p->ID, 'ih_audio_url')) . '"></audio>'; }
  return $h . '<div class="ih-body">' . apply_filters('the_content', $p->post_content) . '</div></article>' . signup() . '</main>';
}

function view_generic($p) {
  return '<main class="ih-main">' . back_link() . '<article class="ih-piece"><h1>' . e(get_the_title($p)) . '</h1><div class="ih-body">' . apply_filters('the_content', $p->post_content) . '</div></article></main>';
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
  if (is_404()) { return view_404(); }
  if (is_search()) { return view_search(); }
  if (is_front_page() || is_home()) {
    if ($k === 'publication') { $i = current_issue(); return $i ? view_issue($i) : view_404(); }
    if ($k === 'hub') { return view_hub(); }
    if ($k === 'author') { return view_author_home(); }
    if ($k === 'podcast') { return view_podcast_home(); }
  }
  if (is_singular('ih_issue')) { return view_issue(get_queried_object()); }
  if (is_singular('ih_piece')) { return view_piece(get_queried_object()); }
  if (is_singular('ih_contributor')) { return view_contributor(get_queried_object()); }
  if (is_post_type_archive('ih_contributor')) { return view_contributors(); }
  if (is_post_type_archive('ih_issue')) { return view_archive(); }
  if (is_singular('ih_episode')) { return view_episode(get_queried_object()); }
  if (is_singular()) { return view_generic(get_queried_object()); }
  return view_404();
}
