<?php
/** Boot task (read-only, runs only while IH_LIST_USERS=1): prints every user of the network with roles per site, creation date and last sign-in. */
if (getenv('IH_LIST_USERS') !== '1' || !is_multisite()) { return; }
$supers = get_super_admins();
foreach (get_users(['blog_id' => 0, 'number' => 500, 'orderby' => 'ID']) as $u) {
  $roles = [];
  foreach (get_sites(['number' => 100]) as $s) { $m = get_user_meta($u->ID, $GLOBALS['wpdb']->get_blog_prefix($s->blog_id) . 'capabilities', true); if (is_array($m) && $m) { $roles[] = $s->domain . $s->path . '=' . implode('/', array_keys($m)); } }
  $tok = get_user_meta($u->ID, 'session_tokens', true); $last = 0; if (is_array($tok)) { foreach ($tok as $t) { $last = max($last, (int) ($t['login'] ?? 0)); } }
  echo '[inkhorn] USER ' . json_encode(['id' => $u->ID, 'login' => $u->user_login, 'email' => $u->user_email, 'name' => $u->display_name, 'registered' => $u->user_registered, 'super' => in_array($u->user_login, $supers, true), 'roles' => $roles, 'last_login' => $last ? gmdate('Y-m-d H:i', $last) : null, 'posts_authored' => (int) count_user_posts($u->ID, 'any')]) . "\n";
}
