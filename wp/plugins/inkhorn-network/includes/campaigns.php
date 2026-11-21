<?php
namespace Inkhorn;

/**
 * When an issue, a terryheath.com post or a podcast episode is published, a DRAFT campaign is created in listmonk (never sent).
 * Terry opens it in listmonk, picks the lists and sends it himself. Guards: not during imports, not for old posts, once per post.
 */
add_action('transition_post_status', function ($new, $old, $post) {
  if ($new !== 'publish' || $old === 'publish') { return; }
  if (defined('INKHORN_IMPORTING') && INKHORN_IMPORTING) { return; }
  $types = ['ih_issue', 'post', 'ih_episode'];
  if (!in_array($post->post_type, $types, true) || get_post_meta($post->ID, 'ih_campaign_id', true)) { return; }
  if (strtotime($post->post_date_gmt . ' UTC') < time() - DAY_IN_SECONDS) { return; }
  $u = getenv('LISTMONK_URL'); $tok = getenv('LISTMONK_API_TOKEN'); $user = getenv('LISTMONK_API_USER') ?: 'automation';
  if (!$u || !$tok) { return; }
  $s = site(); $key = site_key();
  $brand = ['review' => 'Inkhorn: Inkhorn Review', 'whiterabbit' => 'Inkhorn: White Rabbit', 'muse' => 'Inkhorn: Muse', 'terryheath' => 'Inkhorn: Terry Heath', 'lifeonwords' => 'Inkhorn: Life on Words', 'hub' => 'Inkhorn: Inkhorn Press'][$key] ?? 'Inkhorn: Inkhorn Press';
  $title = get_the_title($post);
  $label = $post->post_type === 'ih_issue' ? (get_post_meta($post->ID, 'ih_label', true) ?: $title) : $title;
  $body = $post->post_type === 'post' ? apply_filters('the_content', $post->post_content)
    : '<h1 style="font-weight:400">' . esc_html($label) . '</h1><p>' . esc_html($post->post_excerpt ?: ($post->post_type === 'ih_issue' ? t('email.issue_line', 'The new issue is online.') : '')) . '</p><p><a href="' . esc_url(get_permalink($post)) . '">' . ($post->post_type === 'ih_issue' ? t('email.issue_start', 'Start reading') : t('email.listen', 'Listen')) . ' &rarr;</a></p>';
  $api = function ($m, $p, $b = null) use ($u, $tok, $user) {
    $r = wp_remote_request(rtrim($u, '/') . '/api' . $p, ['method' => $m, 'timeout' => 15, 'headers' => ['Authorization' => 'token ' . $user . ':' . $tok, 'Content-Type' => 'application/json'], 'body' => $b ? wp_json_encode($b) : null]);
    return is_wp_error($r) ? null : json_decode(wp_remote_retrieve_body($r), true)['data'] ?? null;
  };
  $lists = $api('GET', '/lists?per_page=all');
  $ids = []; foreach (($lists['results'] ?? []) as $l) { if (array_intersect($s['lists'], $l['tags'] ?? [])) { $ids[] = $l['id']; } }
  $tpls = $api('GET', '/templates'); $tid = 0; foreach ((array) $tpls as $t) { if (($t['name'] ?? '') === $brand) { $tid = $t['id']; } }
  $c = $api('POST', '/campaigns', ['name' => ($post->post_type === 'ih_issue' ? 'Issue: ' : '') . $title . ' (draft from ' . $s['name'] . ')', 'subject' => $label, 'lists' => $ids, 'type' => 'regular', 'content_type' => 'html', 'body' => $body, 'template_id' => $tid, 'from_email' => mail_from_for_site(), 'messenger' => 'email']);
  if (!empty($c['id'])) { update_post_meta($post->ID, 'ih_campaign_id', (int) $c['id']); }
}, 10, 3);
