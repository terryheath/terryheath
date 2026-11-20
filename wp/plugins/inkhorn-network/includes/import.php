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
  if (!defined('INKHORN_IMPORTING')) { define('INKHORN_IMPORTING', true); }
  require_once ABSPATH . 'wp-admin/includes/media.php';
  require_once ABSPATH . 'wp-admin/includes/file.php';
  require_once ABSPATH . 'wp-admin/includes/image.php';
  switch_to_blog($bid);
  try {
    if (!empty($d['delete_test_id'])) { // cleanup of audit fixtures only: a post whose title starts with "Test " and is not published
      $tp = get_post((int) $d['delete_test_id']);
      if ($tp && strpos($tp->post_title, 'Test ') === 0 && $tp->post_status !== 'publish') { wp_delete_post($tp->ID, true); return ['deleted' => $tp->ID]; }
      return new \WP_Error('refused', 'not a test fixture', ['status' => 400]);
    }
    if (($d['action'] ?? '') === 'dedupe_books') { // keeps one product per title (a published one if there is one), removes the rest
      $by = [];
      foreach (get_posts(['post_type' => 'ih_book', 'numberposts' => -1, 'post_status' => ['publish', 'future', 'draft', 'pending', 'private']]) as $b) { $by[$b->post_title][] = $b; }
      $gone = [];
      foreach ($by as $title => $list) {
        usort($list, function ($x, $y) { return [$y->post_status === 'publish', $x->ID] <=> [$x->post_status === 'publish', $y->ID]; });
        foreach (array_slice($list, 1) as $dup) { wp_delete_post($dup->ID, true); $gone[] = $dup->post_name; }
      }
      return ['removed' => $gone];
    }
    $type = $d['type'] ?? 'post'; $slug = sanitize_title($d['slug'] ?? '');
    if ($slug === '') { return new \WP_Error('no_slug', 'slug is required (an empty slug would match any post)', ['status' => 400]); }
    $found = get_posts(['name' => $slug, 'post_type' => $type, 'post_status' => 'any', 'numberposts' => 1]);
    $arr = [
      'post_type' => $type, 'post_name' => $slug, 'post_title' => $d['title'] ?? '', 'post_content' => $d['content'] ?? '',
      'post_status' => $d['status'] ?? 'publish', 'post_excerpt' => $d['excerpt'] ?? '', 'menu_order' => (int) ($d['menu_order'] ?? 0),
    ];
    if (!empty($d['date'])) { $arr['post_date_gmt'] = gmdate('Y-m-d H:i:s', strtotime($d['date'])); $arr['post_date'] = get_date_from_gmt($arr['post_date_gmt']); }
    if ($found && !empty($d['meta_only'])) { foreach (($d['meta'] ?? []) as $k => $v) { update_post_meta($found[0]->ID, $k, $v); } return ['id' => $found[0]->ID, 'url' => get_permalink($found[0]->ID)]; }
    if ($found && !empty($d['only_content'])) { kses_remove_filters(); wp_update_post(['ID' => $found[0]->ID, 'post_content' => $d['content'] ?? '']); kses_init_filters(); return ['id' => $found[0]->ID, 'url' => get_permalink($found[0]->ID)]; }
    if ($found && !empty($d['skip_if_exists'])) { return ['id' => $found[0]->ID, 'url' => get_permalink($found[0]->ID), 'existed' => true]; }
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
    if (!empty($d['thumbnail_b64'])) { // image sent with the item (podcast headshots from the hub)
      $tmp = wp_tempnam($d['thumbnail_name'] ?? 'upload.jpg');
      file_put_contents($tmp, base64_decode($d['thumbnail_b64']));
      $att = media_handle_sideload(['name' => $d['thumbnail_name'] ?? 'upload.jpg', 'tmp_name' => $tmp], $id);
      if (!is_wp_error($att)) { set_post_thumbnail($id, $att); $thumb_att = $att; } else { $thumb_error = $att->get_error_message(); @unlink($tmp); }
    }
    if (!empty($d['guest_name'])) { // link the episode to its guest (created on first sight); the guest takes the headshot when it has none
      $gs = get_posts(['post_type' => 'ih_guest', 'name' => sanitize_title($d['guest_name']), 'numberposts' => 1, 'post_status' => 'any']);
      $gid = $gs ? $gs[0]->ID : wp_insert_post(['post_type' => 'ih_guest', 'post_title' => $d['guest_name'], 'post_name' => sanitize_title($d['guest_name']), 'post_status' => 'publish']);
      update_post_meta($id, 'ih_guest_id', $gid);
      if (!empty($thumb_att) && !get_post_thumbnail_id($gid)) { set_post_thumbnail($gid, $thumb_att); }
    }
    if (!empty($d['thumbnail_url'])) {
      $have = get_post_meta($id, '_ih_thumb_src', true);
      if ($have !== $d['thumbnail_url']) {
        $att = media_sideload_image($d['thumbnail_url'], $id, null, 'id');
        if (!is_wp_error($att)) { set_post_thumbnail($id, $att); update_post_meta($id, '_ih_thumb_src', $d['thumbnail_url']); } else { $thumb_error = $att->get_error_message(); }
      }
    }
    return ['id' => $id, 'url' => get_permalink($id), 'thumbnail' => (bool) get_post_thumbnail_id($id), 'thumb_error' => $thumb_error ?? null];
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
