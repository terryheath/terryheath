<?php
namespace Inkhorn;

/**
 * Small private JSON stores for the server-side tools (replace the private draft Ghost pages): agreements-tracker, podcast-guests, podcast-headshots, admin-hub-auth.
 * GET  /inkhorn/v1/store/<key>            -> { value, version }
 * POST /inkhorn/v1/store/<key> { value, version? } -> { version }; 409 if `version` is given and no longer current. Same server token as the importer.
 */
add_action('rest_api_init', function () {
  $perm = function (\WP_REST_Request $r) { $t = getenv('INKHORN_IMPORT_TOKEN'); return $t && hash_equals($t, (string) $r->get_header('x-import-token')); };
  $ok = ['agreements-tracker', 'podcast-guests', 'podcast-headshots', 'admin-hub-auth'];
  register_rest_route('inkhorn/v1', '/store/(?P<key>[a-z-]+)', [
    ['methods' => 'GET', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) use ($ok) {
      if (!in_array($r['key'], $ok, true)) { return new \WP_Error('bad', 'unknown store', ['status' => 404]); }
      $row = get_site_option('inkhorn_store_' . $r['key'], null);
      return $row ? ['value' => json_decode($row['json'], true), 'version' => $row['version']] : ['value' => null, 'version' => ''];
    }],
    ['methods' => 'POST', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) use ($ok) {
      if (!in_array($r['key'], $ok, true)) { return new \WP_Error('bad', 'unknown store', ['status' => 404]); }
      $d = $r->get_json_params();
      $cur = get_site_option('inkhorn_store_' . $r['key'], null);
      if (!empty($d['version']) && $cur && $cur['version'] !== $d['version']) { return new \WP_Error('conflict', 'store changed since it was read', ['status' => 409]); }
      $json = wp_json_encode($d['value'] ?? null);
      $v = substr(hash('sha256', $json . microtime(true)), 0, 20);
      update_site_option('inkhorn_store_' . $r['key'], ['json' => $json, 'version' => $v]);
      return ['version' => $v];
    }],
  ]);
});
