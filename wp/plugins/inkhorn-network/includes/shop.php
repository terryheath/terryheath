<?php
namespace Inkhorn;

/** Hub shop: books grid, book pages, cart and order pages. shop.js (the existing storefront script) drives them against the shop service. */
add_action('wp_enqueue_scripts', function () {
  if (!in_array(get_query_var('ih_view'), ['shop', 'book', 'cart', 'order-complete', 'address', 'print-edition'], true)) { return; }
  wp_enqueue_style('inkhorn-shop', INKHORN_URL . '/assets/shop.css', ['inkhorn'], asset_ver());
  wp_enqueue_script('inkhorn-shop', INKHORN_URL . '/assets/shop.js', [], asset_ver(), true);
});

function book_by_slug($slug) {
  $q = get_posts(['post_type' => 'ih_book', 'name' => sanitize_title($slug), 'numberposts' => 1, 'post_status' => 'publish']);
  return $q ? $q[0] : null;
}

function view_shop_page($v) {
  if ($v === 'shop') {
    $h = '<main class="ih-main"><div class="ih-print-page"><h1 class="ih-h1">Shop</h1><p class="ih-note" style="margin:0 auto 40px;text-align:center">Print and ebook editions of <em>Inkhorn Review</em>. Print copies ship to U.S. addresses only ($4 for the first book, $1 for each additional); ebooks are emailed and ship anywhere. Sold by Inkhorn Press, a nonprofit; checkout is by Stripe. Want every issue? See <a href="' . a(home_url('/subscribe/')) . '">memberships</a>.</p><div class="ih-print-grid">';
    foreach (get_posts(['post_type' => 'ih_book', 'numberposts' => 50, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']) as $b) {
      $img = get_the_post_thumbnail_url($b, 'medium');
      $h .= '<a class="ih-print-card" href="' . a(home_url('/shop/' . $b->post_name . '/')) . '" data-sku="' . a(m($b->ID, 'ih_sku')) . '">' . ($img ? '<div class="ih-print-card-cover"><img src="' . a($img) . '" alt="' . a(get_the_title($b)) . ' cover" loading="lazy" width="480" height="690"></div>' : '')
         . '<div class="ih-print-card-title">' . e(get_the_title($b)) . '</div><div class="ih-print-card-prices"></div></a>';
    }
    return $h . '</div></div></main>';
  }
  if ($v === 'cart') { return '<main class="ih-main"><div class="ih-cart-page"><h1 class="ih-cart-heading">Cart</h1><div id="ih-cart-items"></div><div id="ih-cart-summary"></div></div></main>'; }
  if ($v === 'order-complete') { return '<main class="ih-main"><div class="ih-order-complete-page"><div id="ih-order-complete"></div></div></main>'; }
  $p = get_page_by_path($v, OBJECT, 'page');
  return view_generic($p ?: get_post(0));
}

function view_book() {
  $b = book_by_slug(get_query_var('ih_book_slug'));
  if (!$b) { global $wp_query; $wp_query->set_404(); status_header(404); return view_404(); }
  $img = get_the_post_thumbnail_url($b, 'large');
  $data = ['sku' => m($b->ID, 'ih_sku'), 'preorder' => (bool) m($b->ID, 'ih_preorder'), 'isbn' => m($b->ID, 'ih_isbn')];
  return '<main class="ih-main"><p class="ih-back"><a href="' . a(home_url('/shop/')) . '">&larr; All books</a></p><div class="ih-book-page"><div class="ih-book-hero">'
    . ($img ? '<div class="ih-book-cover"><img src="' . a($img) . '" alt="' . a(get_the_title($b)) . ' cover" width="480" height="690"></div>' : '')
    . '<div class="ih-book-info"><div class="ih-book-eyebrow" id="ih-book-status"></div><h1 class="ih-book-title">' . e(get_the_title($b)) . '</h1>'
    . ($b->post_excerpt ? '<p class="ih-book-desc">' . e($b->post_excerpt) . '</p>' : '')
    . '<div class="ih-book-formats" id="ih-book-formats"><div class="ih-book-loading">Loading&hellip;</div></div></div></div><div class="ih-book-contents" id="ih-book-contents"></div></div>'
    . '<script id="ih-book" type="application/json">' . wp_json_encode($data) . '</script></main>';
}
