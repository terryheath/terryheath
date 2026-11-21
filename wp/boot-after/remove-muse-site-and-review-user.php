<?php
/**
 * Boot task (2026-11-21, Terry's decision): the "muse" subsite at inkhorn.press/muse/ is deleted and replaced by one redirect rule
 * (inkhorn-redirects.json: /muse/* -> the same path on gomuse.io); the user "review" (no roles, no content, made by a bug) is deleted.
 * Safeguards: the site is removed only if it is at the hub's /muse/ and holds nothing but the default post/page; the user only if it has no posts,
 * no capabilities on any site, is not a super admin and is not user 1.
 */
if (!is_multisite()) { return; }
$hub = get_site(get_main_site_id()); $hubDomain = $hub ? $hub->domain : '';
foreach (get_sites(['number' => 100]) as $s) {
  if ($s->domain !== $hubDomain || trim($s->path, '/') !== 'muse') { continue; }
  switch_to_blog($s->blog_id);
  $posts = (int) wp_count_posts('post')->publish + (int) wp_count_posts('post')->draft; $pages = (int) wp_count_posts('page')->publish + (int) wp_count_posts('page')->draft;
  restore_current_blog();
  if ($posts > 1 || $pages > 3) { echo "[inkhorn] muse site has content ($posts/$pages): left alone\n"; continue; }
  wpmu_delete_blog($s->blog_id, true);
  echo "[inkhorn] muse site (blog {$s->blog_id}) removed\n";
}
require_once ABSPATH . 'wp-admin/includes/user.php';
require_once ABSPATH . 'wp-admin/includes/ms.php';
$u = get_user_by('login', 'review');
if ($u && (int) $u->ID !== 1 && !is_super_admin($u->ID) && count_user_posts($u->ID, 'any') === 0 && !get_blogs_of_user($u->ID)) {
  wpmu_delete_user($u->ID); echo "[inkhorn] user review (id {$u->ID}) deleted\n";
}
