<?php
namespace Inkhorn;

add_action('init', function () {
  register_block_type('inkhorn/top', ['render_callback' => function () { return press_bar() . site_header(); }]);
  register_block_type('inkhorn/page', ['render_callback' => function () { return render_page(); }]);
  register_block_type('inkhorn/bottom', ['render_callback' => function () { return site_footer(); }]);
  // Dynamic blocks: the parts of a page whose content comes from the site's data. Place, move or remove them in the Site Editor; their wording is under Settings > Site text.
  $dyn = [
    'welcome' => ['Welcome band', function () { return welcome_band(); }],
    'account-link' => ['Sign in / Account link', function () { return account_link(); }],
    'signup' => ['Email sign-up form', function () { return signup(); }],
    'pubs' => ['Publications row (press home)', function () { return section_pubs(); }],
    'shop-strip' => ['From the shop strip', function () { return shop_strip(); }],
    'folio' => ['Issue: cover, title, buttons and contents', function () { $i = is_singular('ih_issue') ? get_queried_object() : current_issue(); return $i ? section_folio($i) : section_soon(); }],
    'author-banner' => ['Banner image (terryheath.com)', function () { return section_author_banner(); }],
    'author-top' => ['Latest essay and more writing', function () { return section_author_top(); }],
    'author-low' => ['From Life on Words', function () { return section_author_low(); }],
    'author-books' => ['Books (terryheath.com)', function () { return section_author_books(); }],
    'low-latest' => ['Latest episode (Life on Words)', function () { return section_low_latest(); }],
    'low-recent' => ['Recent episodes (Life on Words)', function () { return section_low_recent(); }],
    'patreon' => ['Patreon supporters list', function () { return section_patreon(); }],
  ];
  foreach ($dyn as $name => $d) {
    register_block_type('inkhorn/' . $name, ['title' => $d[0], 'category' => 'widgets', 'icon' => 'layout', 'supports' => ['autoRegister' => true, 'html' => false], 'render_callback' => $d[1]]);
  }
  register_block_type('inkhorn/site-part', ['title' => 'This site\'s header, footer or home', 'category' => 'theme', 'attributes' => ['area' => ['type' => 'string', 'default' => 'header']], 'supports' => ['autoRegister' => true, 'html' => false],
    'render_callback' => function ($atts) { return render_site_part($atts['area'] ?? 'header'); }]);
});

/** Each site has its own header, footer and home layout: template parts named header-<site>, footer-<site>, home-<site> (Site Editor > Patterns > Template parts). */
function render_site_part($area) {
  $k = site_key();
  if ($area === 'home' && site()['kind'] === 'publication') { $k = 'publication'; }
  $slug = ($area === 'header' || $area === 'footer' || $area === 'home') ? $area . '-' . $k : $area;
  return render_block(['blockName' => 'core/template-part', 'attrs' => ['slug' => $slug, 'theme' => 'inkhorn', 'tagName' => 'div'], 'innerBlocks' => [], 'innerHTML' => '', 'innerContent' => []]);
}
/** Links and image paths in template parts use tokens so they stay right when a domain changes: {hub} {review} {whiterabbit} {terryheath} {lifeonwords} {home} {img}; the page you are on is marked in the menus. */
add_filter('render_block_core/template-part', function ($html) {
  $tok = ['{hub}' => untrailingslashit(hub_url()), '{review}' => untrailingslashit(pub_url('review')), '{whiterabbit}' => untrailingslashit(pub_url('whiterabbit')), '{terryheath}' => untrailingslashit(pub_url('terryheath')),
    '{lifeonwords}' => untrailingslashit(pub_url('lifeonwords')), '{home}' => untrailingslashit(home_url()), '{img}' => INKHORN_URL . '/assets/img'];
  $html = str_replace(array_keys($tok), array_values($tok), $html);
  $req = untrailingslashit((string) strtok($_SERVER['REQUEST_URI'] ?? '/', '?'));
  return preg_replace_callback('#<a class="wp-block-navigation-item__content"\s+href="([^"]+)"#', function ($m) use ($req) {
    $u = wp_parse_url(html_entity_decode($m[1])); $same = empty($u['host']) || strcasecmp($u['host'], (string) wp_parse_url(home_url(), PHP_URL_HOST)) === 0;
    $cur = $same && untrailingslashit($u['path'] ?? '/') === $req && empty($u['fragment']) && !isset($u['query']);
    return $m[0] . ($cur ? ' aria-current="page"' : '');
  }, $html);
}, 10, 1);

/** Fonts, one stylesheet, the site's accent as CSS variables. */
add_action('wp_enqueue_scripts', function () {
  wp_enqueue_style('inkhorn-fonts', 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Karla:wght@400;500;600&family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&display=swap', [], null);
  wp_enqueue_style('inkhorn', INKHORN_URL . '/assets/inkhorn.css', ['inkhorn-fonts'], asset_ver());
  $s = site();
  wp_enqueue_style('inkhorn-redesign', INKHORN_URL . '/assets/redesign.css', ['inkhorn'], (string) @filemtime(INKHORN_DIR . '/assets/redesign.css'));
  wp_add_inline_style('inkhorn', ':root{--ih-accent:' . $s['accent'] . ';--ih-tint:' . $s['tint'] . ';}');
  add_filter('body_class', function ($c) { $c[] = 'ih-' . site_key(); return $c; });
  wp_enqueue_script('inkhorn', INKHORN_URL . '/assets/inkhorn.js', [], asset_ver(), true);
  wp_add_inline_script('inkhorn', 'window.IH_T=Object.assign(window.IH_T||{},' . wp_json_encode([
    'js.sending' => t('js.sending', 'Sending…'), 'js.thanks' => t('js.thanks', 'Thank you.'), 'js.wrong' => t('js.wrong', 'Something went wrong.'), 'js.wrong_retry' => t('js.wrong_retry', 'Something went wrong. Please try again.'),
  ]) . ');', 'before');
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
