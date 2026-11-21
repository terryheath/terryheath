<?php
namespace Inkhorn;

/**
 * The podcast feed lives at lifeonwords.com/feed/ (the podcast is the whole site, so there is no /podcast/ in its address). Same channel, same items, same
 * GUIDs (the old Ghost post ids). Apple Podcasts reads the Riverside feed, not this one. The old terryheath.com/podcast/rss/ and lifeonwords.com/podcast/rss/
 * redirect here. It is built from the Episode type.
 */
add_action('init', function () {
  if (site_key() !== 'lifeonwords') { return; }
  add_rewrite_rule('^feed/?$', 'index.php?ih_feed=podcast', 'top');
});
add_filter('query_vars', function ($v) { $v[] = 'ih_feed'; return $v; });

add_action('template_redirect', function () {
  if (get_query_var('ih_feed') !== 'podcast') { return; }
  $cdata = function ($s) { return '<![CDATA[' . str_replace(']]>', ']]]]><![CDATA[>', (string) $s) . ']]>'; };
  // episodes live on the lifeonwords site
  $lb = site_blog_id('lifeonwords'); $ls = $lb ? [(object) ['blog_id' => $lb]] : [];
  $home = home_url('/');
  $self = home_url('/feed/');
  header('Content-Type: application/rss+xml; charset=UTF-8');
  echo '<?xml version="1.0" encoding="UTF-8"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>';
  echo '<title>' . $cdata(t('feed.title', 'Life on Words with Terry Heath - Terry Heath')) . '</title><description>' . $cdata(t('feed.description', 'Writer, Educator, Editor, Host')) . '</description><link>' . esc_url($home) . '</link>';
  echo '<image><url>' . esc_url($home . 'favicon.png') . '</url><title>' . $cdata(t('feed.title', 'Life on Words with Terry Heath - Terry Heath')) . '</title><link>' . esc_url($home) . '</link></image>';
  echo '<generator>Inkhorn network</generator><lastBuildDate>' . gmdate('D, d M Y H:i:s') . ' GMT</lastBuildDate><atom:link href="' . esc_url($self) . '" rel="self" type="application/rss+xml"/><ttl>60</ttl>';
  if ($ls) {
    switch_to_blog($ls[0]->blog_id);
    foreach (get_posts(['post_type' => 'ih_episode', 'numberposts' => -1, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']) as $p) {
      $guid = get_post_meta($p->ID, 'ih_guid', true) ?: ('ih-' . $p->ID);
      $img = get_the_post_thumbnail_url($p, 'full');
      echo '<item><title>' . $cdata(get_the_title($p)) . '</title><description>' . $cdata($p->post_excerpt) . '</description><link>' . esc_url(get_permalink($p)) . '</link><guid isPermaLink="false">' . esc_html($guid) . '</guid>';
      foreach (array_filter(explode('|', (string) get_post_meta($p->ID, 'ih_categories', true))) as $c) { echo '<category>' . $cdata($c) . '</category>'; }
      echo '<dc:creator>' . $cdata(get_post_meta($p->ID, 'ih_creator', true) ?: 'Terry Heath') . '</dc:creator><pubDate>' . esc_html(gmdate('D, d M Y H:i:s', strtotime($p->post_date_gmt . ' UTC')) . ' GMT') . '</pubDate>';
      if ($img) { echo '<media:content url="' . esc_url($img) . '" medium="image"/>'; }
      echo '<content:encoded>' . $cdata($p->post_content) . '</content:encoded></item>';
    }
    restore_current_blog();
  }
  echo '</channel></rss>';
  exit;
});
