<?php
namespace Inkhorn;

add_action('init', function () {
  register_block_type('inkhorn/top', ['render_callback' => function () { return press_bar() . site_header(); }]);
  register_block_type('inkhorn/page', ['render_callback' => function () { return render_page(); }]);
  register_block_type('inkhorn/bottom', ['render_callback' => function () { return site_footer(); }]);
});

/** Fonts, one stylesheet, the site's accent as CSS variables. */
add_action('wp_enqueue_scripts', function () {
  wp_enqueue_style('inkhorn-fonts', 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Karla:wght@400;500&display=swap', [], null);
  wp_enqueue_style('inkhorn', INKHORN_URL . '/assets/inkhorn.css', ['inkhorn-fonts'], asset_ver());
  $s = site();
  wp_add_inline_style('inkhorn', ':root{--ih-accent:' . $s['accent'] . ';--ih-tint:' . $s['tint'] . ';}');
  wp_enqueue_script('inkhorn', INKHORN_URL . '/assets/inkhorn.js', [], asset_ver(), true);
});
function asset_ver() { return (string) @filemtime(INKHORN_DIR . '/assets/inkhorn.css') ?: '0'; }

add_action('wp_head', function () { echo '<meta name="theme-color" content="' . esc_attr(site()['accent']) . '">'; });
add_filter('wp_robots', function ($r) { return $r; });
