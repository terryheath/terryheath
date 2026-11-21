<?php
namespace Inkhorn;

/**
 * Network Admin > Publishing admin (2026-11-21): the admin hub's screens (growth, profile changes, payouts, Life on Words guests and headshots) inside the
 * WordPress dashboard. WordPress sign-in (super admin) is the only login. The Node service on admin.terryheath.com stays the engine: it keeps the data
 * and the jobs (DocuSeal, Stripe, SES email, Cal.com), and this file asks it for each screen with a signed header (ENGINE_SECRET, valid 2 minutes) and
 * shows the HTML it returns. Links and forms in a screen come back pointing at the engine's paths; they are rewritten here to the matching dashboard page.
 *   page=ih-hub-<screen>&p=<engine path and query>   a screen (GET) or a form post (POST, WordPress nonce)
 *   admin-ajax.php?action=ih_hub&p=...&_ihn=<nonce>  files, images, CSV and the headshot upload (any method, raw body passed through)
 */

function pa_engine_base() { $u = getenv('HUB_ENGINE_URL'); return $u ? rtrim($u, '/') : 'https://admin.terryheath.com'; }

function pa_screens() {
  return [
    'growth' => ['Growth', '/growth', 'dashicons-chart-line'],
    'profiles' => ['Profile changes', '/profiles', ''],
    'payouts' => ['Payouts', '/payouts', ''],
    'podcast' => ['Life on Words guests', '/podcast', ''],
    'headshots' => ['Headshots', '/podcast#missing-headshots', ''],
  ];
}
function pa_slug_for($path) {
  $p = (string) wp_parse_url($path, PHP_URL_PATH);
  if (strpos($p, '/payouts') === 0) { return 'ih-hub-payouts'; }
  if (strpos($p, '/profiles') === 0) { return 'ih-hub-profiles'; }
  if (strpos($p, '/growth') === 0) { return 'ih-hub-growth'; }
  return 'ih-hub-podcast';
}
function pa_is_file($path) { return (bool) preg_match('#^/(podcast/(headshot-file|headshot-upload|pdf)|payouts\.csv)(\?|$)#', $path); }
function pa_link($path) {
  if ($path === '/' || strpos($path, '//') === 0) { return $path === '/' ? network_admin_url('admin.php?page=ih-services') : $path; }
  $frag = ''; if (($i = strpos($path, '#')) !== false) { $frag = substr($path, $i); $path = substr($path, 0, $i); }
  if (pa_is_file($path)) { return admin_url('admin-ajax.php?action=ih_hub&_ihn=' . wp_create_nonce('ih_hub') . '&p=' . rawurlencode($path)); }
  return network_admin_url('admin.php?page=' . pa_slug_for($path) . '&p=' . rawurlencode($path)) . $frag;
}

/** Ask the engine. Returns [status, content-type, body, location]. */
function pa_call($method, $path, $body = null, $ctype = null) {
  $secret = getenv('ENGINE_SECRET');
  if (!$secret) { return [500, 'text/plain', 'ENGINE_SECRET is not set on the WordPress service.', '', '']; }
  $ts = time(); $sig = hash_hmac('sha256', $ts . '|' . $method . '|' . $path, $secret);
  $h = ['X-Engine-Auth' => $ts . '.' . $sig, 'X-Engine-User' => wp_get_current_user()->user_login];
  if ($ctype) { $h['Content-Type'] = $ctype; }
  $r = wp_remote_request(pa_engine_base() . $path, ['method' => $method, 'timeout' => 90, 'redirection' => 0, 'headers' => $h, 'body' => $body]);
  if (is_wp_error($r)) { return [502, 'text/plain', 'The admin engine did not answer: ' . $r->get_error_message(), '', '']; }
  return [(int) wp_remote_retrieve_response_code($r), (string) wp_remote_retrieve_header($r, 'content-type'), (string) wp_remote_retrieve_body($r), (string) wp_remote_retrieve_header($r, 'location'), (string) wp_remote_retrieve_header($r, 'content-disposition')];
}

/** Engine HTML -> dashboard HTML: links, images and forms point at dashboard pages; every form carries the nonce. */
function pa_rewrite($html) {
  $html = preg_replace_callback('#\b(href|src|action)="(/[^"]*)"#', function ($m) { return $m[1] . '="' . esc_url(pa_link(html_entity_decode($m[2], ENT_QUOTES))) . '"'; }, $html);
  $html = preg_replace('#<form\b([^>]*)>#i', '<form$1><input type="hidden" name="_ihn" value="' . esc_attr(wp_create_nonce('ih_hub')) . '">', $html);
  // the page's own scripts build addresses through these two helpers
  $pages = ['/growth' => pa_link('/growth'), '/profiles' => pa_link('/profiles'), '/payouts' => pa_link('/payouts'), '/podcast' => pa_link('/podcast')];
  $js = '<script>window.IHHUB={u:function(p){return ' . wp_json_encode(admin_url('admin-ajax.php?action=ih_hub&_ihn=' . wp_create_nonce('ih_hub') . '&p=')) . '+encodeURIComponent(p)},'
      . 'page:function(p){var b=' . wp_json_encode(network_admin_url('admin.php?page=')) . ',s=p.indexOf("/payouts")==0?"ih-hub-payouts":p.indexOf("/profiles")==0?"ih-hub-profiles":p.indexOf("/growth")==0?"ih-hub-growth":"ih-hub-podcast";return b+s+"&p="+encodeURIComponent(p)}};</script>';
  return $js . $html;
}

function pa_allowed() { return is_multisite() ? is_super_admin() : current_user_can('manage_options'); }
function pa_path_ok($p) { return is_string($p) && preg_match('#^/(growth|profiles|payouts|podcast|payouts\.csv)([/?\#]|$)#', $p) && strpos($p, '//') === false; }
function pa_clean_path($p) { return preg_replace('#\#.*$#', '', (string) $p); }

function pa_map_location($loc) {
  if ($loc === '') { return ''; }
  if (preg_match('#^/#', $loc) && pa_path_ok($loc)) { return pa_link($loc); }
  return $loc; // an absolute address (the signed PDF) is followed as given
}

add_action('network_admin_menu', function () {
  add_menu_page('Publishing admin', 'Publishing admin', 'manage_network', 'ih-hub-growth', __NAMESPACE__ . '\\pa_screen', 'dashicons-chart-line', 4);
  foreach (pa_screens() as $k => $v) {
    add_submenu_page('ih-hub-growth', $v[0], $v[0], 'manage_network', 'ih-hub-' . $k, __NAMESPACE__ . '\\pa_screen');
  }
});

/** Form posts: forward to the engine, then follow its redirect to the matching dashboard page. */
add_action('admin_init', function () {
  $page = $_GET['page'] ?? ''; if (strpos((string) $page, 'ih-hub-') !== 0 || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { return; }
  if (!pa_allowed()) { wp_die('Not allowed.', 403); }
  if (!wp_verify_nonce($_POST['_ihn'] ?? '', 'ih_hub')) { wp_die('This page expired. Go back, reload it and try again.', 403); }
  $p = wp_unslash($_GET['p'] ?? ''); if (!pa_path_ok($p)) { wp_die('Unknown screen.', 404); }
  $post = wp_unslash($_POST); unset($post['_ihn']);
  [$code, $ct, $body, $loc] = pa_call('POST', pa_clean_path($p), http_build_query($post), 'application/x-www-form-urlencoded');
  if ($code >= 300 && $code < 400 && $loc) { wp_redirect(pa_map_location($loc)); exit; }
  pa_send_page($code, $ct, $body, $p);
});

function pa_send_page($code, $ct, $body, $p) {
  // an engine page returned from a POST (the payouts preview): render it in the dashboard
  global $pa_post_result; $pa_post_result = [$code, $ct, $body, $p];
}

function pa_screen() {
  if (!pa_allowed()) { wp_die('Not allowed.', 403); }
  global $pa_post_result;
  $page = $_GET['page'] ?? ''; $slug = preg_replace('#^ih-hub-#', '', $page); $screens = pa_screens();
  $p = isset($_GET['p']) ? wp_unslash($_GET['p']) : ($screens[$slug][1] ?? '/podcast');
  if (!pa_path_ok($p)) { echo '<div class="wrap"><h1>Not found</h1></div>'; return; }
  echo '<div class="wrap">';
  if ($pa_post_result) { [$code, $ct, $body] = $pa_post_result; }
  else { [$code, $ct, $body, $loc] = pa_call('GET', pa_clean_path($p)); if ($code >= 300 && $code < 400 && $loc) { echo '<script>location.replace(' . wp_json_encode(pa_map_location($loc)) . ')</script></div>'; return; } }
  if ($code >= 500 && stripos($ct, 'html') === false) { echo '<div class="notice notice-error"><p>' . esc_html($body) . '</p></div></div>'; return; }
  echo pa_rewrite($body); // the engine escapes everything it prints; this is its own HTML
  if ($slug === 'headshots' && !isset($_GET['p'])) { echo '<script>document.getElementById("missing-headshots")&&document.getElementById("missing-headshots").scrollIntoView()</script>'; }
  echo '</div>';
}

/** Files, images, CSV and uploads: the engine's answer is passed through as it is. */
add_action('wp_ajax_ih_hub', function () {
  if (!pa_allowed()) { status_header(403); exit; }
  if (!wp_verify_nonce($_REQUEST['_ihn'] ?? '', 'ih_hub')) { status_header(403); exit; }
  $p = wp_unslash($_GET['p'] ?? ''); if (!pa_path_ok($p) || !pa_is_file($p)) { status_header(404); exit; }
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $body = $method === 'POST' ? file_get_contents('php://input') : null;
  [$code, $ct, $out, $loc, $cd] = pa_call($method, $p, $body, $_SERVER['CONTENT_TYPE'] ?? null);
  if ($code >= 300 && $code < 400 && $loc) { wp_redirect($loc); exit; }
  status_header($code); header('Content-Type: ' . ($ct ?: 'application/octet-stream')); if (!empty($cd)) { header('Content-Disposition: ' . $cd); } header('Cache-Control: private, no-store'); header('X-Content-Type-Options: nosniff');
  echo $out; exit;
});
