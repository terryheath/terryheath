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
  $mine = 0; foreach (['ih_issue', 'ih_piece', 'ih_episode', 'ih_guest', 'ih_book', 'ih_contributor'] as $t) { $mine += (int) (post_type_exists($t) ? wp_count_posts($t)->publish + wp_count_posts($t)->draft : 0); }
  $titles = []; foreach (get_posts(['post_type' => ['post', 'page'], 'post_status' => 'any', 'numberposts' => 50]) as $p) { $titles[] = $p->post_type . ':' . $p->post_title . ' (' . $p->post_status . ')'; }
  restore_current_blog();
  echo "[inkhorn] muse site holds: " . implode('; ', $titles) . "\n";
  if ($mine > 0) { echo "[inkhorn] muse site holds publication content ($mine): left alone\n"; continue; }
  wpmu_delete_blog($s->blog_id, true);
  echo "[inkhorn] muse site (blog {$s->blog_id}) removed\n";
}
require_once ABSPATH . 'wp-admin/includes/user.php';
require_once ABSPATH . 'wp-admin/includes/ms.php';
$u = get_user_by('login', 'review');
if ($u) { echo '[inkhorn] user review: id ' . $u->ID . ', super admin ' . (is_super_admin($u->ID) ? 'yes' : 'no') . ', posts ' . count_user_posts($u->ID, 'any') . ', sites ' . count(get_blogs_of_user($u->ID, true)) . "\n"; }
if ($u && (int) $u->ID !== 1 && !is_super_admin($u->ID) && (int) count_user_posts($u->ID, 'any') === 0 && !get_blogs_of_user($u->ID)) {
  wpmu_delete_user($u->ID); echo "[inkhorn] user review (id {$u->ID}) deleted\n";
}
