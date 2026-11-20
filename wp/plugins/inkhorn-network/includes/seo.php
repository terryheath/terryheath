<?php
namespace Inkhorn;

/**
 * Search and sharing: structured data (JSON-LD) for pieces, essays, episodes, products and issues, and "do not index" for sign-in, account, cart and newsletter-state pages.
 * Titles, descriptions, canonical addresses, share images and the XML sitemap come from The SEO Framework (network-active); this file adds what that plugin does not do for our content types.
 */

function seo_site_publisher() {
  $s = site();
  if ($s['kind'] === 'author') { return ['@type' => 'Person', 'name' => 'Terry Heath', 'url' => home_url('/')]; }
  return ['@type' => 'Organization', 'name' => $s['name'], 'url' => home_url('/')];
}
function seo_image($post) {
  $id = get_post_thumbnail_id($post);
  if (!$id && $post->post_type === 'ih_piece') { $iss = get_post((int) get_post_meta($post->ID, 'ih_issue_id', true)); $id = $iss ? get_post_thumbnail_id($iss) : 0; }
  return $id ? (string) wp_get_attachment_image_url($id, 'large') : '';
}
function seo_description($post) { $d = trim(wp_strip_all_tags((string) $post->post_excerpt)); return $d !== '' ? $d : one_line($post); }

add_action('wp_head', function () {
  if (!is_singular() && !(is_front_page() && false)) { return; }
  $p = get_queried_object(); if (!$p || empty($p->post_type)) { return; }
  $url = get_permalink($p); $img = seo_image($p); $out = null;
  switch ($p->post_type) {
    case 'ih_piece':
      $issue = get_post((int) m($p->ID, 'ih_issue_id'));
      $out = ['@type' => 'Article', 'headline' => get_the_title($p), 'author' => m($p->ID, 'ih_author_name') ? ['@type' => 'Person', 'name' => m($p->ID, 'ih_author_name')] : null,
        'datePublished' => get_the_date('c', $p), 'dateModified' => get_the_modified_date('c', $p), 'publisher' => seo_site_publisher(), 'mainEntityOfPage' => $url,
        'isPartOf' => $issue ? ['@type' => 'PublicationIssue', 'name' => m($issue->ID, 'ih_label') ?: get_the_title($issue), 'url' => get_permalink($issue)] : null, 'image' => $img ?: null, 'description' => seo_description($p) ?: null];
      break;
    case 'post':
      $out = ['@type' => 'BlogPosting', 'headline' => get_the_title($p), 'author' => ['@type' => 'Person', 'name' => 'Terry Heath'], 'datePublished' => get_the_date('c', $p), 'dateModified' => get_the_modified_date('c', $p),
        'publisher' => seo_site_publisher(), 'mainEntityOfPage' => $url, 'image' => $img ?: null, 'description' => seo_description($p) ?: null];
      break;
    case 'ih_episode':
      $g = get_post((int) m($p->ID, 'ih_guest_id')); $audio = episode_audio($p);
      $out = ['@type' => 'PodcastEpisode', 'name' => get_the_title($p), 'url' => $url, 'datePublished' => get_the_date('c', $p), 'description' => seo_description($p) ?: null,
        'episodeNumber' => m($p->ID, 'ih_number') ? (int) m($p->ID, 'ih_number') : null,
        'partOfSeries' => ['@type' => 'PodcastSeries', 'name' => 'Life on Words with Terry Heath', 'url' => home_url('/')],
        'actor' => $g ? ['@type' => 'Person', 'name' => get_the_title($g)] : null, 'associatedMedia' => $audio ? ['@type' => 'AudioObject', 'contentUrl' => $audio] : null, 'image' => $img ?: null];
      break;
    case 'ih_book':
      $prices = shop_prices(); $sku = m($p->ID, 'ih_sku');
      $out = ['@type' => 'Product', 'name' => get_the_title($p), 'description' => seo_description($p) ?: null, 'image' => $img ?: null, 'sku' => $sku ?: null, 'url' => site_key() === 'hub' ? home_url('/shop/' . $p->post_name . '/') : $url,
        'brand' => ['@type' => 'Brand', 'name' => 'Inkhorn Review'],
        'offers' => isset($prices[$sku]) ? ['@type' => 'Offer', 'price' => number_format($prices[$sku] / 100, 2, '.', ''), 'priceCurrency' => 'USD', 'availability' => m($p->ID, 'ih_preorder') ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock', 'url' => home_url('/shop/' . $p->post_name . '/')] : null];
      break;
    case 'ih_issue':
      $out = ['@type' => 'PublicationIssue', 'name' => m($p->ID, 'ih_label') ?: get_the_title($p), 'url' => $url, 'image' => $img ?: null, 'description' => (string) (m($p->ID, 'ih_note') ?: issue_line_from_shop($p)) ?: null,
        'isPartOf' => ['@type' => 'Periodical', 'name' => site()['name'], 'url' => home_url('/')]];
      break;
  }
  if (!$out) { return; }
  $out = ['@context' => 'https://schema.org'] + array_filter($out, function ($v) { return $v !== null && $v !== ''; });
  echo '<script type="application/ld+json">' . wp_json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . '</script>' . "\n";
}, 30);

/** Sign-in, account, cart, order and newsletter-state pages are not for search engines. */
function seo_private_view() {
  $v = (string) get_query_var('ih_view');
  return in_array($v, ['signin', 'verify', 'out', 'adopt', 'account', 'cart', 'order-complete', 'newsletter', 'nl-confirm', 'nl-confirmed', 'nl-expired'], true);
}
add_filter('wp_robots', function ($r) { if (seo_private_view()) { $r['noindex'] = true; $r['nofollow'] = true; unset($r['index'], $r['follow']); } return $r; });
add_filter('the_seo_framework_robots_meta_array', function ($meta) { if (seo_private_view()) { $meta['noindex'] = 'noindex'; $meta['nofollow'] = 'nofollow'; } return $meta; });
/** The contributor directory lists only people with published work; the sitemap does the same (a contributor page with no work is a 404). */
add_filter('the_seo_framework_sitemap_exclude_ids', function ($ids) {
  if (!post_type_exists('ih_contributor')) { return $ids; }
  $work = contributors_with_work();
  foreach (get_posts(['post_type' => 'ih_contributor', 'numberposts' => -1, 'post_status' => 'publish', 'fields' => 'all']) as $c) { if (!in_array($c->post_name, $work, true)) { $ids[] = $c->ID; } }
  return $ids;
});

/**
 * Sitemaps. The press home's sitemap (inkhorn.press/sitemap.xml) is The SEO Framework's. The plugin does not answer for the sites that live in a folder
 * (inkhorn.press/review/sitemap.xml), so each of those serves its own: every published issue, piece, episode, guest, book, essay and page, and nothing
 * else (sign-in, account, cart and newsletter-state pages are not posts, so they never appear).
 */
add_action('init', function () {
  if (site_key() === 'hub') { return; }
  $base = rtrim((string) wp_parse_url(home_url(), PHP_URL_PATH), '/');
  $req = (string) strtok($_SERVER['REQUEST_URI'] ?? '', '?');
  if ($req !== $base . '/sitemap.xml') { return; }
  $types = ['page', 'post', 'ih_issue', 'ih_piece', 'ih_episode', 'ih_guest', 'ih_book'];
  $urls = [['loc' => home_url('/'), 'mod' => '']];
  foreach (get_posts(['post_type' => $types, 'post_status' => 'publish', 'numberposts' => -1, 'orderby' => 'date', 'order' => 'DESC', 'suppress_filters' => true]) as $p) {
    if ($p->post_type === 'post' && $p->post_name === 'hello-world') { continue; }
    if ($p->post_type === 'page' && in_array($p->post_name, ['cover', 'sample-page', 'start-here-placeholder'], true)) { continue; }
    if ($p->post_type === 'page' && get_option('page_on_front') == $p->ID) { continue; }
    if ($p->post_type === 'ih_book' && site_key() !== 'hub') { $loc = get_permalink($p); } else { $loc = $p->post_type === 'ih_book' ? home_url('/shop/' . $p->post_name . '/') : get_permalink($p); }
    $urls[] = ['loc' => $loc, 'mod' => get_post_modified_time('c', true, $p)];
  }
  foreach ([(site_key() === 'review' ? 'review/issues/' : 'issues/') => 'ih_issue', 'episodes/' => 'ih_episode', 'guests/' => 'ih_guest'] as $path => $pt) { if (post_type_exists($pt) && wp_count_posts($pt)->publish) { $urls[] = ['loc' => home_url('/' . $path), 'mod' => '']; } }
  status_header(200); header('Content-Type: application/xml; charset=UTF-8'); header('X-Robots-Tag: noindex');
  echo '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
  foreach ($urls as $u) { echo '<url><loc>' . esc_url($u['loc']) . '</loc>' . ($u['mod'] ? '<lastmod>' . esc_html($u['mod']) . '</lastmod>' : '') . '</url>'; }
  echo '</urlset>'; exit;
}, 0);
/** robots.txt (served once, at the root) names every site's sitemap. */
add_filter('robots_txt', function ($out) {
  if (!is_main_site()) { return $out; }
  foreach (get_sites(['number' => 50]) as $st) {
    $path = trim($st->path, '/'); if ($path === '' || $path === 'muse') { continue; }
    $line = 'Sitemap: ' . get_site_url($st->blog_id, '/sitemap.xml');
    if (strpos($out, $line) === false) { $out .= "\n" . $line; }
  }
  return $out;
}, 20);

/** Browser titles read "Page – Site" everywhere (the en dash the site has always used). */
add_filter('the_seo_framework_title_separator', function () { return '–'; });

/* ---------- favicons: each site has its own (assets/favicons/<site>/) ---------- */
function favicon_dir_key() { $k = site_key(); return in_array($k, ['hub', 'review', 'whiterabbit', 'terryheath', 'lifeonwords'], true) ? $k : 'hub'; }
add_filter('site_icon_meta_tags', '__return_empty_array');
add_action('wp_head', function () {
  $u = INKHORN_URL . '/assets/favicons/' . favicon_dir_key() . '/';
  echo '<link rel="icon" href="' . esc_url($u . 'favicon.ico') . '" sizes="32x32"><link rel="icon" type="image/png" sizes="32x32" href="' . esc_url($u . 'favicon-32x32.png') . '"><link rel="icon" type="image/png" sizes="16x16" href="' . esc_url($u . 'favicon-16x16.png') . '"><link rel="apple-touch-icon" sizes="180x180" href="' . esc_url($u . 'apple-touch-icon.png') . '">' . "\n";
}, 2);
add_action('init', function () { // browsers that ask for /favicon.ico at the root get that site's icon
  if (strtok($_SERVER['REQUEST_URI'] ?? '', '?') !== '/favicon.ico') { return; }
  $f = INKHORN_DIR . '/assets/favicons/' . favicon_dir_key() . '/favicon.ico';
  if (!is_file($f)) { return; }
  status_header(200); header('Content-Type: image/x-icon'); header('Cache-Control: public, max-age=86400'); readfile($f); exit;
}, 0);
