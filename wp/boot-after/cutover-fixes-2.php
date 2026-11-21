<?php
/**
 * Boot task (2026-11-20): one-off content fixes after the cutover. Each step is idempotent and does nothing once it has been done.
 *  1. trash the default "Hello world" post (press hub) and the stray "ping" page (Inkhorn Review); trash only, nothing is deleted for good
 *  2. "Details coming soon." becomes "Details to come." on the Weird Friday and BookFolk pages
 *  3. terryheath.com guest guide: restore the backslash the import dropped from the image-type test (a JavaScript error), and move the
 *     downloadable share graphic from the old Ghost address into this site's media library
 */
if (!is_multisite()) { return; }
function ih_fix_site($domain) { foreach (get_sites(['number' => 100]) as $s) { if ($s->domain === $domain && ($domain !== 'inkhorn.press' || $s->path === '/')) { return (int) $s->blog_id; } } return 0; }

if ($b = ih_fix_site('inkhorn.press')) {
  switch_to_blog($b);
  $hw = get_page_by_path('hello-world', OBJECT, 'post');
  if ($hw && $hw->post_status === 'publish') { wp_trash_post($hw->ID); echo "[inkhorn] fixes: trashed hello-world\n"; }
  foreach (['weird-friday', 'bookfolk'] as $slug) {
    $p = get_page_by_path($slug, OBJECT, 'page');
    if ($p && strpos($p->post_content, 'Details coming soon.') !== false) {
      kses_remove_filters(); wp_update_post(['ID' => $p->ID, 'post_content' => wp_slash(str_replace('Details coming soon.', 'Details to come.', $p->post_content))]); kses_init_filters();
      echo "[inkhorn] fixes: $slug text updated\n";
    }
  }
  restore_current_blog();
}
if ($b = ih_fix_site('inkhornreview.com')) {
  switch_to_blog($b);
  $pg = get_page_by_path('ping', OBJECT, 'page');
  if ($pg && $pg->post_status === 'publish') { wp_trash_post($pg->ID); echo "[inkhorn] fixes: trashed ping\n"; }
  restore_current_blog();
}
if ($b = ih_fix_site('terryheath.com')) {
  switch_to_blog($b);
  $gg = get_page_by_path('guest-guide', OBJECT, 'page');
  if ($gg) {
    $c = $gg->post_content; $o = $c;
    $c = preg_replace('#/\^image[\\\\/]*\(jpeg\|png\|webp\)\$/#', '/^image\\\\/(jpeg|png|webp)$/', $c, -1, $cnt);
    if (!$cnt && ($i = strpos($c, 'jpeg|png|webp')) !== false) { echo '[inkhorn] fixes: guest guide type test already reads: ' . json_encode(substr($c, max(0, $i - 20), 50)) . "\n"; }
    $old = 'https://terryheath.com/content/images/2026/11/life-on-words-share-1080.png';
    if (strpos($c, $old) !== false) {
      require_once ABSPATH . 'wp-admin/includes/media.php'; require_once ABSPATH . 'wp-admin/includes/file.php'; require_once ABSPATH . 'wp-admin/includes/image.php';
      $new = media_sideload_image('https://smoky-hyena.pikapod.net/content/images/2026/11/life-on-words-share-1080.png', $gg->ID, null, 'src');
      if (!is_wp_error($new)) { $c = str_replace($old, $new, $c); echo "[inkhorn] fixes: share graphic now $new\n"; } else { echo '[inkhorn] fixes: share graphic failed: ' . $new->get_error_message() . "\n"; }
    }
    if ($c !== $o) { kses_remove_filters(); wp_update_post(['ID' => $gg->ID, 'post_content' => wp_slash($c)]); kses_init_filters(); echo "[inkhorn] fixes: guest guide updated\n"; }
  }
  restore_current_blog();
}
