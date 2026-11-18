<?php
namespace Inkhorn;

/**
 * Server-to-server endpoints for the tools that used to call the Ghost Admin API (same token as the importer):
 *   GET  /inkhorn/v1/digest-pool                      published print-issue pieces of the Review, with html and whether the weekly digest already sent them
 *   POST /inkhorn/v1/digest-sent   {id}               marks a piece as sent in the weekly digest
 *   POST /inkhorn/v1/post-status   {site,type,slug,status,date?}  draft / publish / future (the agreements cron pulls unsigned pieces to draft and schedules signed ones)
 *   POST /inkhorn/v1/bio           {contributor, name?, bio, piece?}   contributor bio and name in print
 *   GET  /inkhorn/v1/scheduled-late                   posts scheduled in the past that are not published (scheduler check)
 *   GET  /inkhorn/v1/catalog                          (public) books with their issue release date, for the shop service
 */
add_action('rest_api_init', function () {
  $perm = function (\WP_REST_Request $r) { $t = getenv('INKHORN_IMPORT_TOKEN'); return $t && hash_equals($t, (string) $r->get_header('x-import-token')); };

  register_rest_route('inkhorn/v1', '/digest-pool', ['methods' => 'GET', 'permission_callback' => $perm, 'callback' => function () {
    $bid = site_id_for('review'); switch_to_blog($bid);
    $out = [];
    foreach (get_posts(['post_type' => 'ih_piece', 'numberposts' => -1, 'post_status' => 'publish']) as $p) {
      $iid = (int) get_post_meta($p->ID, 'ih_issue_id', true);
      if (!$iid || get_post_meta($p->ID, 'ih_online_only', true)) { continue; }
      $g = piece_genre($p); $i = get_post($iid);
      $out[] = ['id' => $p->ID, 'title' => get_the_title($p), 'url' => get_permalink($p), 'author' => get_post_meta($p->ID, 'ih_author_name', true), 'genre' => $g ? $g->slug : '',
        'issue' => $i ? (get_post_meta($i->ID, 'ih_label', true) ?: get_the_title($i)) : '', 'issue_slug' => $i ? $i->post_name : '', 'html' => $p->post_content,
        'sent' => (bool) get_post_meta($p->ID, 'ih_sent_weekly', true), 'bio' => get_post_meta($p->ID, 'ih_bio', true), 'published' => $p->post_date_gmt];
    }
    restore_current_blog();
    return $out;
  }]);
  register_rest_route('inkhorn/v1', '/digest-sent', ['methods' => 'POST', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) {
    switch_to_blog(site_id_for('review')); update_post_meta((int) $r->get_json_params()['id'], 'ih_sent_weekly', 1); restore_current_blog(); return ['ok' => true];
  }]);
  register_rest_route('inkhorn/v1', '/post-status', ['methods' => 'POST', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) {
    $d = $r->get_json_params(); $bid = site_id_for($d['site'] ?? 'review'); if (!$bid) { return new \WP_Error('bad', 'site', ['status' => 400]); }
    switch_to_blog($bid);
    $q = get_posts(['name' => sanitize_title($d['slug']), 'post_type' => $d['type'] ?? 'ih_piece', 'post_status' => 'any', 'numberposts' => 1]);
    if (!$q) { restore_current_blog(); return new \WP_Error('nf', 'not found', ['status' => 404]); }
    $arr = ['ID' => $q[0]->ID, 'post_status' => in_array($d['status'], ['draft', 'publish', 'future'], true) ? $d['status'] : 'draft'];
    if (!empty($d['date'])) { $arr['post_date_gmt'] = gmdate('Y-m-d H:i:s', strtotime($d['date'])); $arr['post_date'] = get_date_from_gmt($arr['post_date_gmt']); }
    wp_update_post($arr); $prev = $q[0]->post_status; restore_current_blog();
    return ['ok' => true, 'was' => $prev];
  }]);
  register_rest_route('inkhorn/v1', '/bio', ['methods' => 'POST', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) {
    $d = $r->get_json_params(); switch_to_blog(get_main_site_id());
    $c = get_posts(['post_type' => 'ih_contributor', 'name' => sanitize_title($d['contributor']), 'numberposts' => 1, 'post_status' => 'any']);
    $res = ['contributor' => false, 'pieces' => 0];
    if ($c) { update_post_meta($c[0]->ID, 'ih_bio', $d['bio']); if (!empty($d['name'])) { wp_update_post(['ID' => $c[0]->ID, 'post_title' => $d['name']]); } $res['contributor'] = true; }
    restore_current_blog();
    switch_to_blog(site_id_for('review'));
    foreach (get_posts(['post_type' => 'ih_piece', 'numberposts' => -1, 'post_status' => 'any', 'meta_key' => 'ih_contributors', 'meta_value' => $d['contributor']]) as $p) {
      update_post_meta($p->ID, 'ih_bio', $d['bio']); if (!empty($d['name'])) { update_post_meta($p->ID, 'ih_author_name', $d['name']); } $res['pieces']++;
    }
    restore_current_blog();
    return $res;
  }]);
  register_rest_route('inkhorn/v1', '/scheduled-late', ['methods' => 'GET', 'permission_callback' => $perm, 'callback' => function () {
    $out = [];
    foreach (get_sites(['number' => 50]) as $s) {
      switch_to_blog($s->blog_id);
      foreach (get_posts(['post_type' => 'any', 'post_status' => 'future', 'numberposts' => 50, 'date_query' => [['before' => gmdate('Y-m-d H:i:s', time() - 900), 'column' => 'post_date_gmt']]]) as $p) {
        $out[] = ['site' => trim($s->path, '/') ?: 'hub', 'title' => get_the_title($p), 'at' => $p->post_date_gmt, 'id' => $p->ID];
      }
      restore_current_blog();
    }
    return $out;
  }]);
  register_rest_route('inkhorn/v1', '/catalog', ['methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function () {
    $out = [];
    foreach (get_posts(['post_type' => 'ih_book', 'numberposts' => 100, 'post_status' => ['publish', 'future']]) as $b) {
      $out[] = ['slug' => $b->post_name, 'title' => get_the_title($b), 'sku' => get_post_meta($b->ID, 'ih_sku', true), 'status' => $b->post_status === 'future' ? 'scheduled' : 'published', 'published_at' => gmdate('c', strtotime($b->post_date_gmt . ' UTC'))];
    }
    return $out;
  }]);
});
