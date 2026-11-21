<?php
/**
 * Boot task (2026-11-21): every site lives on its own root domain, so nothing may exist at inkhorn.press/review/, /whiterabbit/, /terryheath/ or /lifeonwords/.
 * Blank sites were recreated at those folders by the old site-creation step (it looked sites up by folder path). They are removed here, with safeguards:
 * only a site on the hub's domain at one of those four paths, holding no content of ours, is removed. The Muse site at /muse/ is never touched.
 */
if (!is_multisite()) { return; }
$hub = get_site(get_main_site_id()); $hubDomain = $hub ? $hub->domain : '';
foreach (get_sites(['number' => 100]) as $s) {
  if ($s->domain !== $hubDomain || !in_array(trim($s->path, '/'), ['review', 'whiterabbit', 'terryheath', 'lifeonwords'], true)) { continue; }
  switch_to_blog($s->blog_id);
  $mine = 0; foreach (['ih_issue', 'ih_piece', 'ih_episode', 'ih_guest', 'ih_book', 'ih_contributor'] as $t) { $mine += (int) (post_type_exists($t) ? wp_count_posts($t)->publish + wp_count_posts($t)->draft : 0); }
  $pages = (int) wp_count_posts('page')->publish; $posts = (int) wp_count_posts('post')->publish;
  restore_current_blog();
  if ($mine > 0 || $pages > 3 || $posts > 2) { echo "[inkhorn] folder site {$s->domain}{$s->path} has content ($mine/$pages/$posts): left alone\n"; continue; }
  wpmu_delete_blog($s->blog_id, true);
  echo "[inkhorn] folder site {$s->domain}{$s->path} (blog {$s->blog_id}) removed\n";
}
