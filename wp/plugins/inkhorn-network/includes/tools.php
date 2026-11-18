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
    wp_update_post($arr); $prev = $q[0]->post_status;
    // a piece leaving an issue closes the gap in the print running order
    if (($d['type'] ?? 'ih_piece') === 'ih_piece' && $arr['post_status'] === 'draft' && $prev !== 'draft') {
      $iid = (int) get_post_meta($q[0]->ID, 'ih_issue_id', true);
      if ($iid) {
        $n = 0;
        foreach (get_posts(['post_type' => 'ih_piece', 'numberposts' => -1, 'post_status' => ['publish', 'future'], 'meta_key' => 'ih_position', 'orderby' => 'meta_value_num', 'order' => 'ASC', 'meta_query' => [['key' => 'ih_issue_id', 'value' => $iid, 'type' => 'NUMERIC']]]) as $sib) { update_post_meta($sib->ID, 'ih_position', ++$n); }
      }
    }
    restore_current_blog();
    return ['ok' => true, 'was' => $prev];
  }]);
  // Ghost-shaped pieces of one issue (any status), for the ebook builder: tags are the issue, the genre and the contributor, in that order.
  register_rest_route('inkhorn/v1', '/issue-pieces', ['methods' => 'GET', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) {
    switch_to_blog(site_id_for('review'));
    $iss = get_posts(['post_type' => 'ih_issue', 'name' => sanitize_title((string) $r['issue']), 'numberposts' => 1, 'post_status' => 'any']);
    if (!$iss) { restore_current_blog(); return new \WP_Error('nf', 'no such issue', ['status' => 404]); }
    $i = $iss[0]; $label = get_post_meta($i->ID, 'ih_label', true) ?: get_the_title($i); $rel = get_post_meta($i->ID, 'ih_release', true);
    $out = ['issue' => ['slug' => $i->post_name, 'name' => $label, 'feature_image' => get_the_post_thumbnail_url($i, 'full') ?: null], 'posts' => []];
    foreach (get_posts(['post_type' => 'ih_piece', 'numberposts' => -1, 'post_status' => 'any', 'meta_key' => 'ih_position', 'orderby' => 'meta_value_num', 'order' => 'ASC', 'meta_query' => [['key' => 'ih_issue_id', 'value' => $i->ID, 'type' => 'NUMERIC']]]) as $p) {
      $g = piece_genre($p); $pos = (int) get_post_meta($p->ID, 'ih_position', true); $cs = trim(explode(',', (string) get_post_meta($p->ID, 'ih_contributors', true))[0]);
      $tags = [['id' => 'issue:' . $i->post_name, 'name' => $label, 'slug' => $i->post_name], ['id' => 'genre:' . ($g ? $g->slug : ''), 'name' => $g ? $g->name : '', 'slug' => $g ? $g->slug : '']];
      if ($cs) { $tags[] = ['id' => 'c:' . $cs, 'name' => get_post_meta($p->ID, 'ih_author_name', true), 'slug' => $cs, 'description' => get_post_meta($p->ID, 'ih_bio', true)]; }
      $out['posts'][] = ['id' => (string) $p->ID, 'title' => get_the_title($p), 'slug' => $p->post_name, 'html' => $p->post_content, 'status' => $p->post_status === 'future' ? 'scheduled' : ($p->post_status === 'publish' ? 'published' : 'draft'),
        'published_at' => gmdate('c', strtotime(($rel ?: gmdate('Y-m-d')) . ' 12:00:00 UTC') + ($pos - 1) * 60), 'custom_excerpt' => 'by ' . get_post_meta($p->ID, 'ih_author_name', true), 'tags' => $tags];
    }
    restore_current_blog();
    return $out;
  }]);
  // Full content export of every site (backup): posts, pages and all Inkhorn types with their fields.
  register_rest_route('inkhorn/v1', '/export', ['methods' => 'GET', 'permission_callback' => $perm, 'callback' => function () {
    $out = [];
    foreach (get_sites(['number' => 50]) as $s) {
      switch_to_blog($s->blog_id); $items = [];
      foreach (get_posts(['post_type' => ['post', 'page', 'ih_issue', 'ih_piece', 'ih_contributor', 'ih_book', 'ih_episode', 'ih_guest'], 'post_status' => 'any', 'numberposts' => -1]) as $p) {
        $meta = []; foreach (get_post_meta($p->ID) as $k => $v) { if ($k[0] !== '_' ) { $meta[$k] = $v[0]; } }
        $terms = wp_get_object_terms($p->ID, get_object_taxonomies($p->post_type), ['fields' => 'names']);
        $items[] = ['id' => $p->ID, 'type' => $p->post_type, 'slug' => $p->post_name, 'title' => $p->post_title, 'status' => $p->post_status, 'date' => $p->post_date_gmt, 'content' => $p->post_content, 'excerpt' => $p->post_excerpt, 'meta' => $meta, 'terms' => is_wp_error($terms) ? [] : $terms, 'thumbnail' => get_the_post_thumbnail_url($p, 'full')];
      }
      $out[trim($s->path, '/') ?: 'hub'] = ['domain' => $s->domain, 'items' => $items];
      restore_current_blog();
    }
    return $out;
  }]);
  register_rest_route('inkhorn/v1', '/piece-bio', ['methods' => 'GET', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) {
    switch_to_blog(site_id_for((string) ($r['site'] ?: 'review')));
    $q = get_posts(['post_type' => 'ih_piece', 'name' => sanitize_title((string) $r['slug']), 'numberposts' => 1, 'post_status' => 'any']);
    $out = null;
    if ($q) { $p = $q[0]; $out = ['title' => get_the_title($p), 'author' => get_post_meta($p->ID, 'ih_author_name', true), 'bio' => get_post_meta($p->ID, 'ih_bio', true), 'contributor' => get_post_meta($p->ID, 'ih_contributors', true), 'position' => (int) get_post_meta($p->ID, 'ih_position', true)]; }
    restore_current_blog();
    if ($out && $out['contributor']) { switch_to_blog(get_main_site_id()); $c = get_posts(['post_type' => 'ih_contributor', 'name' => $out['contributor'], 'numberposts' => 1, 'post_status' => 'any']); $out['contributor_bio'] = $c ? get_post_meta($c[0]->ID, 'ih_bio', true) : ''; restore_current_blog(); }
    return $out ?: new \WP_Error('nf', 'not found', ['status' => 404]);
  }]);
  register_rest_route('inkhorn/v1', '/contributor-meta', ['methods' => 'POST', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) {
    $d = $r->get_json_params(); $allowed = ['ih_shelf', 'ih_url'];
    switch_to_blog(get_main_site_id());
    $c = get_posts(['post_type' => 'ih_contributor', 'name' => sanitize_title($d['slug']), 'numberposts' => 1, 'post_status' => 'any']);
    if (!$c) { restore_current_blog(); return new \WP_Error('nf', 'no such contributor', ['status' => 404]); }
    foreach (($d['meta'] ?? []) as $k => $v) { if (in_array($k, $allowed, true)) { update_post_meta($c[0]->ID, $k, $v); } }
    restore_current_blog();
    return ['ok' => true];
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
  register_rest_route('inkhorn/v1', '/month-notes', ['methods' => 'GET', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) {
    $from = gmdate('Y-m-d H:i:s', strtotime((string) $r['from'])); $to = gmdate('Y-m-d H:i:s', strtotime((string) $r['to']));
    $out = [];
    foreach (['terryheath' => 'post', 'review' => 'ih_piece', 'lifeonwords' => 'ih_episode'] as $key => $type) {
      $bid = site_id_for($key); if (!$bid) { continue; }
      switch_to_blog($bid);
      foreach (get_posts(['post_type' => $type, 'post_status' => 'publish', 'numberposts' => 100, 'date_query' => [['after' => $from, 'before' => $to, 'inclusive' => true, 'column' => 'post_date_gmt']]]) as $p) {
        $out[$key][] = ['title' => get_the_title($p), 'url' => get_permalink($p), 'at' => $p->post_date_gmt];
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
