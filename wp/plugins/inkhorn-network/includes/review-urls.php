<?php
namespace Inkhorn;

/**
 * Inkhorn Review's addresses are the ones it has always had on Ghost, so no redirect is needed once the Review lives at inkhornreview.com:
 *   /review/<slug>/            a piece, or an issue (/review/autumn-2026/)
 *   /review/issues/            the archive
 *   /review/founder-letter/    the founder's letters
 *   /poetry/ /fiction/ /nonfiction/ /art/ /micro/    a genre
 * (On the temporary address the Review sits under /review/, so these read /review/review/<slug>/ until its own domain is mapped.)
 */
/** Is the site being looked at (even from another site, after switch_to_blog) the Review? */
function is_review_blog() { $d = get_bloginfo('url'); return strpos($d, 'inkhornreview.com') !== false || trim((string) wp_parse_url($d, PHP_URL_PATH), '/') === 'review'; }
add_filter('post_type_link', function ($link, $post) {
  return is_review_blog() && in_array($post->post_type, ['ih_issue', 'ih_piece'], true) ? home_url('/review/' . $post->post_name . '/') : $link;
}, 5, 2);
add_filter('term_link', function ($link, $term, $tax) { return is_review_blog() && $tax === 'ih_genre' ? home_url('/' . $term->slug . '/') : $link; }, 10, 3);
add_filter('post_type_archive_link', function ($link, $pt) { return is_review_blog() && $pt === 'ih_issue' ? home_url('/review/issues/') : $link; }, 10, 2);

if (site_key() === 'review') {
  add_filter('query_vars', function ($v) { $v[] = 'ih_review'; return $v; });
  add_action('init', function () {
    // 'top' rules are tried in the order they are added: the specific ones go first
    add_rewrite_rule('^review/issues/?$', 'index.php?post_type=ih_issue', 'top');
    add_rewrite_rule('^review/founder-letter/?$', 'index.php?ih_view=founder-letter', 'top');
    add_rewrite_rule('^review/([^/]+)/?$', 'index.php?ih_review=$matches[1]', 'top');
    add_rewrite_rule('^(poetry|fiction|nonfiction|art|micro)/?$', 'index.php?ih_genre=$matches[1]', 'top');
    add_rewrite_rule('^founder-letter/?$', 'index.php?ih_view=founder-letter', 'top');
  }, 20);
  /** One address pattern for two kinds of page: an issue if one has that slug, else a piece. */
  add_filter('request', function ($qv) {
    if (empty($qv['ih_review'])) { return $qv; }
    $slug = sanitize_title($qv['ih_review']);
    $issue = get_posts(['name' => $slug, 'post_type' => 'ih_issue', 'post_status' => 'publish', 'numberposts' => 1]);
    $type = $issue ? 'ih_issue' : 'ih_piece';
    return [$type => $slug, 'post_type' => $type, 'name' => $slug];
  });
  // addresses this setup used for a day (/work/<slug>/, /issues/) keep working
  add_action('template_redirect', function () {
    $p = trim((string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/'); $base = trim((string) wp_parse_url(home_url(), PHP_URL_PATH), '/');
    if ($base !== '' && strpos($p, $base . '/') === 0) { $p = substr($p, strlen($base) + 1); }
    if (preg_match('#^(work|issues)/([^/]+)$#', $p, $m)) { wp_safe_redirect(home_url('/review/' . $m[2] . '/'), 301); exit; }
    if ($p === 'issues') { wp_safe_redirect(home_url('/review/issues/'), 301); exit; }
    if ($p === 'review') { wp_safe_redirect(home_url('/'), 301); exit; } // /review/ alone: the old Ghost collection page
    if ($p === 'rss') { wp_safe_redirect(home_url('/feed/'), 301); exit; } // the old Ghost feed address
  }, 0);
}

/** The founder's letters (a page of the Review: /review/founder-letter/). */
function view_founder_letters() {
  $q = get_posts(['post_type' => 'ih_piece', 'numberposts' => -1, 'post_status' => 'publish', 'meta_key' => 'ih_letter', 'meta_value' => '1', 'orderby' => 'date', 'order' => 'DESC']);
  $h = '<main class="ih-main"><h1 class="ih-h1">' . tx('letters.heading', 'Founder’s letters') . '</h1><ul class="ih-list">';
  foreach ($q as $p) { $h .= '<li><a href="' . a(get_permalink($p)) . '"><span class="ih-pt">' . e(get_the_title($p)) . '</span><span class="ih-pa">' . e(get_the_date('', $p)) . '</span></a></li>'; }
  return $h . '</ul></main>';
}
