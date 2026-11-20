<?php
/**
 * Boot task (after plugins are installed): The SEO Framework defaults for each site, set once and never overwritten, so changes made in the dashboard stay.
 * Default share image = the site's logo. Descriptions are left to the plugin (it builds them from each page's excerpt or opening text); no copy is written here.
 */
if (!is_multisite() || !class_exists('The_SEO_Framework\\Load') && !defined('THE_SEO_FRAMEWORK_VERSION')) { echo "[inkhorn] SEO Framework not active; skipping defaults\n"; return; }
$logos = ['hub' => 'inkhorn-press-logo.png', 'review' => 'inkhorn-review-header.png', 'whiterabbit' => 'inkhorn-press-logo.png', 'terryheath' => 'th-wrc-avatar.png', 'lifeonwords' => 'th-LOW-tag-page-1.png'];
foreach (get_sites(['number' => 100]) as $s) {
  switch_to_blog($s->blog_id);
  if (get_option('ih_seo_defaults_done') !== '1') {
    $path = trim($s->path, '/'); $host = $s->domain;
    $key = $path !== '' && isset($logos[$path]) ? $path : (strpos($host, 'terryheath') !== false ? 'terryheath' : (strpos($host, 'lifeonwords') !== false ? 'lifeonwords' : 'hub'));
    if ($path === 'muse') { restore_current_blog(); continue; }
    $opt = get_option('autodescription-site-settings', []); if (!is_array($opt)) { $opt = []; }
    $opt['social_image_fb_url'] = plugins_url('inkhorn-network/assets/img/' . $logos[$key]);
    $opt['social_image_fb_id'] = 0;
    update_option('autodescription-site-settings', $opt);
    update_option('ih_seo_defaults_done', '1');
    echo "[inkhorn] SEO defaults set for " . $s->domain . $s->path . "\n";
  }
  restore_current_blog();
}
