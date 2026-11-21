<?php
/**
 * Plugin Name: Inkhorn clear old redirects
 * Before 2026-11-21 the old Cloudflare Workers sent inkhornreview.com, lifeonwords.com and others to other addresses with permanent (301) redirects, and
 * browsers keep those forever, so a visitor's browser could still jump away from a page that now lives here. Once per browser, the first page asks the
 * browser to empty its cache for this site (Clear-Site-Data: "cache"); a cookie stops it asking again.
 */
add_action('send_headers', function () {
  if (is_admin() || (defined('REST_REQUEST') && REST_REQUEST) || (defined('DOING_CRON') && DOING_CRON) || (defined('WP_CLI') && WP_CLI)) { return; }
  if (!empty($_COOKIE['ih_cc2']) || ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { return; }
  $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
  if (!preg_match('/(^|\.)(inkhornreview\.com|lifeonwords\.com|terryheath\.com|whiterabbitreview\.com|inkhorn\.press)$/', $host)) { return; }
  header('Clear-Site-Data: "cache"');
  setcookie('ih_cc2', '1', ['expires' => time() + 365 * DAY_IN_SECONDS, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
}, 0);
