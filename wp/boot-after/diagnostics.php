<?php
/** Boot task: a few facts for the deploy log (Site text keys found, key admin pages render, SEO plugin state). */
wp_set_current_user(get_user_by('login', 'terry') ? get_user_by('login', 'terry')->ID : 1);
$reg = \Inkhorn\text_registry();
echo '[inkhorn] diag: site text keys: ' . count($reg) . "\n";
foreach (['text_page' => [null], 'services_page' => [], 'howto_page' => [], 'shop_admin_page' => []] as $fn => $args) {
  ob_start(); try { call_user_func_array('\\Inkhorn\\' . $fn, $args); } catch (\Throwable $e) { echo 'ERROR ' . $e->getMessage(); }
  $o = ob_get_clean(); echo '[inkhorn] diag: ' . $fn . ' renders ' . strlen($o) . " bytes" . (strpos($o, 'ERROR') === 0 ? ' ' . $o : '') . "\n";
}
echo '[inkhorn] diag: SEO Framework active: ' . (defined('THE_SEO_FRAMEWORK_VERSION') ? THE_SEO_FRAMEWORK_VERSION : 'no') . "\n";
echo '[inkhorn] diag: terry super admin: ' . (is_super_admin(get_user_by('login', 'terry')->ID) ? 'yes' : 'no') . "\n";
foreach (get_sites(['number' => 10]) as $s) {
  switch_to_blog($s->blog_id);
  $path = ''; $ok = '';
  try { $path = \The_SEO_Framework\Meta\URI\Utils::get_site_path(); } catch (\Throwable $e) { $path = 'ERR ' . $e->getMessage(); }
  echo '[inkhorn] diag: site ' . $s->path . ' home=' . home_url() . ' tsf site_path=' . $path . ' rewrite_rules_have_sitemap=' . (strpos(wp_json_encode(get_option('rewrite_rules')), 'sitemap') !== false ? 'yes' : 'no') . ' permalinks=' . get_option('permalink_structure') . "\n";
  restore_current_blog();
}
