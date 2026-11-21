<?php
/* Plugin Name: Inkhorn redirects (old inkhorn.press and inkhornreview.com paths -> the new network) */
add_action('init', function () {
  if (is_admin() || (defined('REST_REQUEST') && REST_REQUEST) || wp_doing_cron()) { return; }
  $uri = $_SERVER['REQUEST_URI'] ?? '/';
  $path = (string) wp_parse_url($uri, PHP_URL_PATH);
  $qs = (string) wp_parse_url($uri, PHP_URL_QUERY);
  // only the main (hub) domain's paths: other mapped domains have their own redirects
  static $rules = null;
  if ($rules === null) { $j = json_decode((string) @file_get_contents(__DIR__ . '/inkhorn-redirects.json'), true); $rules = $j['rules'] ?? []; }
  $final = strpos((string) getenv('WP_DOMAIN'), 'inkhorn.press') !== false && strpos((string) getenv('WP_DOMAIN'), 'railway') === false; // rules marked final apply only on the live hub domain
  foreach ($rules as $r) {
    if (!empty($r['final']) && !$final) { continue; }
    $rh = strtolower(preg_replace('/^www\./', '', (string) ($_SERVER['HTTP_HOST'] ?? ''))); $ok = false;
    foreach ((array) ($r['hosts'] ?? ['inkhorn.press']) as $h) { if ($rh === $h || ($h === 'inkhorn.press' && strpos($rh, 'railway.app') !== false)) { $ok = true; } }
    if (!$ok) { continue; } // a rule for one site's old addresses must not fire on another site's domain
    if (preg_match('#' . str_replace('#', '\#', $r['from']) . '#', $path, $m)) {
      $to = preg_replace_callback('/\$(\d)/', function ($x) use ($m) { return $m[(int) $x[1]] ?? ''; }, $r['to']);
      // a rule whose target is the request itself is a no-op
      if ($to === $path) { return; }
      if ($qs) { $to .= (strpos($to, '?') === false ? '?' : '&') . $qs; }
      wp_redirect($to, 301);
      exit;
    }
  }
}, 0);
