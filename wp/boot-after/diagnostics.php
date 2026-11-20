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
