<?php
/**
 * Boot task (2026-11-20): the Life on Words guest guide lives on lifeonwords.com (/guest-guide/); terryheath.com has nothing under /podcast any more.
 * Copies the page from the terryheath.com site to the lifeonwords.com site (its share graphic goes into that site's media library), then trashes the old page.
 * Idempotent: does nothing once the page is on lifeonwords.com.
 */
if (!is_multisite()) { return; }
$find = function ($domain) { foreach (get_sites(['number' => 100]) as $s) { if ($s->domain === $domain) { return (int) $s->blog_id; } } return 0; };
$th = $find('terryheath.com'); $lw = $find('lifeonwords.com');
if (!$th || !$lw) { return; }
switch_to_blog($th); $src = get_page_by_path('guest-guide', OBJECT, 'page'); $title = $src ? $src->post_title : ''; $content = $src ? $src->post_content : ''; $srcId = $src ? $src->ID : 0; restore_current_blog();
switch_to_blog($lw);
$dst = get_page_by_path('guest-guide', OBJECT, 'page');
if (!$dst && $srcId) {
  require_once ABSPATH . 'wp-admin/includes/media.php'; require_once ABSPATH . 'wp-admin/includes/file.php'; require_once ABSPATH . 'wp-admin/includes/image.php';
  $id = wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_name' => 'guest-guide', 'post_title' => $title, 'post_content' => wp_slash($content)], true);
  if (!is_wp_error($id)) {
    if (preg_match_all('#https://terryheath\.com/wp-content/uploads/sites/5/[^"\'\s<>]+#', $content, $mm)) {
      foreach (array_unique($mm[0]) as $u) { $new = media_sideload_image($u, $id, null, 'src'); if (!is_wp_error($new)) { $content = str_replace($u, $new, $content); } else { echo '[inkhorn] guide: image failed ' . $u . ': ' . $new->get_error_message() . "\n"; } }
      wp_update_post(['ID' => $id, 'post_content' => wp_slash($content)]);
    }
    $content = str_replace('https://terryheath.com/podcast/', 'https://lifeonwords.com/', $content);
    wp_update_post(['ID' => $id, 'post_content' => wp_slash($content)]);
    echo "[inkhorn] guide: page created on lifeonwords.com (id $id)\n";
    $dst = get_post($id);
  } else { echo '[inkhorn] guide: create failed: ' . $id->get_error_message() . "\n"; }
}
restore_current_blog();
if ($dst && $srcId) { switch_to_blog($th); if (get_post_status($srcId) === 'publish') { wp_trash_post($srcId); echo "[inkhorn] guide: old page trashed on terryheath.com\n"; } restore_current_blog(); }
