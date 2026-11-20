<?php
/**
 * Boot task: Terry's super admin (username terry) on every site of the network. No password is set and nothing is emailed.
 * When the environment variable IH_RESET_TERRY holds a token that differs from the last one handled, a one-time password-reset link is
 * printed to the deploy log (Railway > wordpress > Deploy Logs) so Terry can open it and choose a password.
 */
if (!is_multisite()) { return; }
$login = 'terry'; $email = 'hello@terryheath.com';
$u = get_user_by('login', $login);
$other = get_user_by('email', $email);
if (!$u && $other) { global $wpdb; $wpdb->update($wpdb->users, ['user_login' => $login, 'user_nicename' => $login], ['ID' => $other->ID]); clean_user_cache($other->ID); $u = get_user_by('id', $other->ID); } // the account that already has this email becomes terry
if (!$u) {
  $id = wpmu_create_user($login, wp_generate_password(64, true, true), $email); // random value nobody sees; the reset link replaces it
  $u = get_user_by('id', $id);
  echo "[inkhorn] created user terry\n";
}
if ($u->user_email !== $email && (!$other || $other->ID === $u->ID)) { wp_update_user(['ID' => $u->ID, 'user_email' => $email]); }
wp_update_user(['ID' => $u->ID, 'display_name' => 'Terry Heath', 'first_name' => 'Terry', 'last_name' => 'Heath', 'nickname' => 'Terry Heath']);
grant_super_admin($u->ID);
foreach (get_sites(['number' => 100, 'fields' => 'ids']) as $bid) { if (!is_user_member_of_blog($u->ID, $bid)) { add_user_to_blog($bid, $u->ID, 'administrator'); } else { $m = new WP_User($u->ID, '', $bid); if (!in_array('administrator', $m->roles, true)) { $m->set_role('administrator'); } } }
echo "[inkhorn] terry is super admin on " . count(get_sites(['number' => 100, 'fields' => 'ids'])) . " sites\n";
$want = getenv('IH_RESET_TERRY');
if ($want && get_site_option('ih_reset_terry_done') !== $want) {
  $key = get_password_reset_key(get_user_by('id', $u->ID));
  if (!is_wp_error($key)) {
    update_site_option('ih_reset_terry_done', $want);
    echo '[inkhorn] RESET LINK: ' . network_site_url('wp-login.php?action=rp&key=' . $key . '&login=' . rawurlencode($login), 'login') . "\n";
  }
}
