<?php
namespace Inkhorn;

/**
 * Migration endpoint (used by inkhorn/scripts/wp-import.cjs; token in env INKHORN_IMPORT_TOKEN).
 * POST /wp-json/inkhorn/v1/import  { site, type, slug, title, content, status, date, excerpt, meta{}, terms{tax:[names]}, thumbnail_url, keep_slug }
 * Upserts by (site, type, slug). Returns { id, url }.
 */
add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/import', [
    'methods' => 'POST',
    'permission_callback' => function (\WP_REST_Request $r) {
      $t = getenv('INKHORN_IMPORT_TOKEN');
      return $t && hash_equals($t, (string) $r->get_header('x-import-token'));
    },
    'callback' => __NAMESPACE__ . '\\import_item',
  ]);
});

function site_id_for($key) {
  $all = get_sites(['number' => 50]);
  foreach ($all as $s) {
    $path = trim($s->path, '/');
    if (($key === 'hub' && $path === '') || $path === $key) { return (int) $s->blog_id; }
  }
  return 0;
}

function import_item(\WP_REST_Request $r) {
  $d = $r->get_json_params();
  $bid = site_id_for((string) ($d['site'] ?? 'hub'));
  if (!$bid) { return new \WP_Error('no_site', 'unknown site', ['status' => 400]); }
  require_once ABSPATH . 'wp-admin/includes/media.php';
  require_once ABSPATH . 'wp-admin/includes/file.php';
  require_once ABSPATH . 'wp-admin/includes/image.php';
  switch_to_blog($bid);
  try {
    $type = $d['type'] ?? 'post'; $slug = sanitize_title($d['slug'] ?? '');
    $found = get_posts(['name' => $slug, 'post_type' => $type, 'post_status' => 'any', 'numberposts' => 1]);
    $arr = [
      'post_type' => $type, 'post_name' => $slug, 'post_title' => $d['title'] ?? '', 'post_content' => $d['content'] ?? '',
      'post_status' => $d['status'] ?? 'publish', 'post_excerpt' => $d['excerpt'] ?? '', 'menu_order' => (int) ($d['menu_order'] ?? 0),
    ];
    if (!empty($d['date'])) { $arr['post_date_gmt'] = gmdate('Y-m-d H:i:s', strtotime($d['date'])); $arr['post_date'] = get_date_from_gmt($arr['post_date_gmt']); }
    if ($found) { $arr['ID'] = $found[0]->ID; }
    kses_remove_filters();
    $id = wp_insert_post($arr, true);
    kses_init_filters();
    if (is_wp_error($id)) { return $id; }
    // images inside the content: copy Ghost-hosted ones into this site's media library and point the content at the copies
    if (!empty($arr['post_content']) && preg_match_all('#<img[^>]+src="([^"]+/content/images/[^"]+)"#i', $arr['post_content'], $mm)) {
      $new = $arr['post_content'];
      foreach (array_unique($mm[1]) as $src) {
        $url = $src;
        $att = media_sideload_image($url, $id, null, 'src');
        if (!is_wp_error($att)) { $new = str_replace($src, $att, $new); }
      }
      if ($new !== $arr['post_content']) { kses_remove_filters(); wp_update_post(['ID' => $id, 'post_content' => $new]); kses_init_filters(); }
    }
    foreach (($d['meta'] ?? []) as $k => $v) { update_post_meta($id, $k, $v); }
    foreach (($d['terms'] ?? []) as $tax => $names) { wp_set_object_terms($id, (array) $names, $tax); }
    if (!empty($d['thumbnail_url'])) {
      $have = get_post_meta($id, '_ih_thumb_src', true);
      if ($have !== $d['thumbnail_url']) {
        $att = media_sideload_image($d['thumbnail_url'], $id, null, 'id');
        if (!is_wp_error($att)) { set_post_thumbnail($id, $att); update_post_meta($id, '_ih_thumb_src', $d['thumbnail_url']); }
      }
    }
    return ['id' => $id, 'url' => get_permalink($id)];
  } finally { restore_current_blog(); }
}

/** Network option writer for the setup scripts (list uuids etc.), same token. */
add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/option', [
    'methods' => 'POST',
    'permission_callback' => function (\WP_REST_Request $r) { $t = getenv('INKHORN_IMPORT_TOKEN'); return $t && hash_equals($t, (string) $r->get_header('x-import-token')); },
    'callback' => function (\WP_REST_Request $r) {
      $d = $r->get_json_params();
      if (!in_array($d['name'] ?? '', ['inkhorn_listmonk_lists'], true)) { return new \WP_Error('bad', 'option not allowed', ['status' => 400]); }
      update_site_option($d['name'], $d['value']);
      return ['ok' => true];
    },
  ]);
});
