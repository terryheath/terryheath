<?php
namespace Inkhorn;

add_action('init', function () {
  register_block_type('inkhorn/top', ['render_callback' => function () { return press_bar() . site_header(); }]);
  register_block_type('inkhorn/page', ['render_callback' => function () { return render_page(); }]);
  register_block_type('inkhorn/bottom', ['render_callback' => function () { return site_footer(); }]);
});

/** Fonts, one stylesheet, the site's accent as CSS variables. */
add_action('wp_enqueue_scripts', function () {
  wp_enqueue_style('inkhorn-fonts', 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Karla:wght@400;500;600&family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&display=swap', [], null);
  wp_enqueue_style('inkhorn', INKHORN_URL . '/assets/inkhorn.css', ['inkhorn-fonts'], asset_ver());
  $s = site();
  wp_enqueue_style('inkhorn-redesign', INKHORN_URL . '/assets/redesign.css', ['inkhorn'], (string) @filemtime(INKHORN_DIR . '/assets/redesign.css'));
  wp_add_inline_style('inkhorn', ':root{--ih-accent:' . $s['accent'] . ';--ih-tint:' . $s['tint'] . ';}');
  add_filter('body_class', function ($c) { $c[] = 'ih-' . site_key(); return $c; });
  wp_enqueue_script('inkhorn', INKHORN_URL . '/assets/inkhorn.js', [], asset_ver(), true);
});
function asset_ver() { return (string) @filemtime(INKHORN_DIR . '/assets/inkhorn.css') ?: '0'; }

add_action('wp_head', function () { echo '<meta name="theme-color" content="' . esc_attr(site()['accent']) . '">'; });
/** Open Graph / Twitter tags: pieces use their issue's cover, issues and books their own image (replaces the Ghost og-webhook). */
add_action('wp_head', function () {
  $img = ''; $title = wp_get_document_title(); $url = '';
  if (is_singular('ih_piece')) { $iss = get_post((int) get_post_meta(get_the_ID(), 'ih_issue_id', true)); $img = $iss ? get_the_post_thumbnail_url($iss, 'large') : ''; }
  elseif (is_singular()) { $img = get_the_post_thumbnail_url(get_the_ID(), 'large'); }
  elseif (is_front_page() && site()['kind'] === 'publication') { $c = current_issue(); $img = $c ? get_the_post_thumbnail_url($c, 'large') : ''; }
  if (is_singular()) { $url = get_permalink(); }
  echo '<meta property="og:site_name" content="' . esc_attr(site()['name']) . '"><meta property="og:title" content="' . esc_attr($title) . '"><meta property="og:type" content="' . (is_singular() ? 'article' : 'website') . '">';
  if ($url) { echo '<meta property="og:url" content="' . esc_url($url) . '">'; }
  if ($img) { echo '<meta property="og:image" content="' . esc_url($img) . '"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="' . esc_url($img) . '">'; }
});

/** Self-hosted Umami: no cookies, no profile of the reader. Env UMAMI_URL and UMAMI_IDS (JSON: site key => website id). Skipped for signed-in admins. */
add_action('wp_head', function () {
  $u = getenv('UMAMI_URL'); $ids = json_decode((string) getenv('UMAMI_IDS'), true);
  $id = is_array($ids) ? ($ids[site_key()] ?? '') : '';
  if (!$u || !$id || current_user_can('edit_posts')) { return; }
  echo '<script defer src="' . esc_url(rtrim($u, '/') . '/ih-stats') . '" data-website-id="' . esc_attr($id) . '" data-do-not-track="true"></script>';
}, 20);
