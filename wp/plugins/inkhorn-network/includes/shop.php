<?php
namespace Inkhorn;

/** Hub shop: books grid, book pages, cart and order pages. shop.js (the existing storefront script) drives them against the shop service. */
add_action('wp_enqueue_scripts', function () {
  if (!in_array(get_query_var('ih_view'), ['shop', 'book', 'cart', 'order-complete', 'subscriptions'], true)) { return; }
  wp_enqueue_style('inkhorn-shop', INKHORN_URL . '/assets/shop.css', ['inkhorn'], asset_ver());
  wp_enqueue_script('inkhorn-shop', INKHORN_URL . '/assets/shop.js', [], asset_ver(), true);
});

function book_by_slug($slug) {
  $q = get_posts(['post_type' => 'ih_book', 'name' => sanitize_title($slug), 'numberposts' => 1, 'post_status' => 'publish']);
  return $q ? $q[0] : null;
}

function view_shop_page($v) {
  if ($v === 'shop') {
    $h = '<main class="ih-main"><div class="ih-print-page"><h1 class="ih-h1">' . tx('shop.heading', 'Shop') . '</h1><p class="ih-note" style="margin:0 auto 40px;text-align:center">' . th('shop.intro', 'Print and ebook editions of <em>Inkhorn Review</em>. We ship print within the U.S.: $4 for the first book, $1 for each after. We email ebooks anywhere. Want every issue? <a href="{url}">Subscribe</a>.', ['url' => esc_url(home_url('/shop/subscriptions/'))]) . '</p><div class="ih-print-grid">';
    foreach (shop_books(50) as $b) {
      $img = get_the_post_thumbnail_url($b, 'medium');
      $h .= '<a class="ih-print-card" href="' . a(home_url('/shop/' . $b->post_name . '/')) . '" data-sku="' . a(m($b->ID, 'ih_sku')) . '">' . ($img ? '<div class="ih-print-card-cover"><img src="' . a($img) . '" alt="' . ta('books.cover', '{title} cover', ['title' => get_the_title($b)]) . '" loading="lazy" width="480" height="690"></div>' : '')
         . '<div class="ih-print-card-title">' . e(get_the_title($b)) . '</div><div class="ih-print-card-prices"></div></a>';
    }
    return $h . '</div></div></main>';
  }
  if ($v === 'cart') { return '<main class="ih-main"><div class="ih-cart-page"><h1 class="ih-cart-heading">' . tx('cart.heading', 'Cart') . '</h1><div id="ih-cart-items"></div><div id="ih-cart-summary"></div></div></main>'; }
  if ($v === 'order-complete') { return '<main class="ih-main"><div class="ih-order-complete-page"><div id="ih-order-complete"></div></div></main>'; }
  if ($v === 'subscriptions') { return view_subscriptions(); }
  return view_404();
}

function view_book() {
  $b = book_by_slug(get_query_var('ih_book_slug'));
  if (!$b) { global $wp_query; $wp_query->set_404(); status_header(404); return view_404(); }
  $img = get_the_post_thumbnail_url($b, 'large');
  $data = ['sku' => m($b->ID, 'ih_sku'), 'preorder' => (bool) m($b->ID, 'ih_preorder'), 'isbn' => m($b->ID, 'ih_isbn')];
  return '<main class="ih-main"><p class="ih-back"><a href="' . a(home_url('/shop/')) . '">&larr; ' . tx('shop.back', 'Shop') . '</a></p><div class="ih-book-page"><div class="ih-book-hero">'
    . ($img ? '<div class="ih-book-cover"><img src="' . a($img) . '" alt="' . ta('books.cover', '{title} cover', ['title' => get_the_title($b)]) . '" width="480" height="690"></div>' : '')
    . '<div class="ih-book-info"><div class="ih-book-eyebrow" id="ih-book-status"></div><h1 class="ih-book-title">' . e(get_the_title($b)) . '</h1>'
    . ($b->post_excerpt ? '<p class="ih-book-desc">' . e($b->post_excerpt) . '</p>' : '')
    . '<div class="ih-book-formats" id="ih-book-formats"><div class="ih-book-loading">' . tx('shop.loading', 'Loading…') . '</div></div></div></div><div class="ih-book-contents" id="ih-book-contents"></div></div>'
    . '<script id="ih-book" type="application/json">' . wp_json_encode($data) . '</script></main>';
}

/** The storefront script's wording (cart, product page, order page): passed to shop.js as window.IH_T. */
function js_strings() {
  return [
    'js.cart_link' => t('js.cart_link', 'Cart ({n})'),
    'js.print' => t('js.print', 'Print'),
    'js.ebook' => t('js.ebook', 'Ebook'),
    'js.unavailable' => t('js.unavailable', 'Not yet available'),
    'js.g_poetry' => t('js.g_poetry', 'Poetry'),
    'js.g_fiction' => t('js.g_fiction', 'Fiction'),
    'js.g_nonfiction' => t('js.g_nonfiction', 'Nonfiction'),
    'js.in_issue' => t('js.in_issue', 'In This Issue'),
    'js.details' => t('js.details', 'Details'),
    'js.isbn' => t('js.isbn', 'ISBN'),
    'js.isbn_print' => t('js.isbn_print', '(print)'),
    'js.qty' => t('js.qty', 'Quantity'),
    'js.decrease' => t('js.decrease', 'Decrease'),
    'js.increase' => t('js.increase', 'Increase'),
    'js.preorder' => t('js.preorder', 'Preorder'),
    'js.add' => t('js.add', 'Add to cart'),
    'js.print_note' => t('js.print_note', 'We ship print within the U.S.: $4 for the first book, $1 for each after.'),
    'js.ebook_pre' => t('js.ebook_pre', 'Preorder. Emailed to you on release day. Available in any country.'),
    'js.ebook_note' => t('js.ebook_note', 'Delivered by email. Available in any country.'),
    'js.ebook_refund' => t('js.ebook_refund', 'Ebooks can’t be refunded once downloaded.'),
    'js.added' => t('js.added', 'Added.'),
    'js.view_cart' => t('js.view_cart', 'View cart'),
    'js.empty' => t('js.empty', 'Your cart is empty.'),
    'js.browse' => t('js.browse', 'Browse the shop'),
    'js.pre_email' => t('js.pre_email', 'Preorder — emailed on release day'),
    'js.pre_ship' => t('js.pre_ship', 'Preorder — ships on release'),
    'js.remove' => t('js.remove', 'Remove'),
    'js.free' => t('js.free', 'Free'),
    'js.subtotal' => t('js.subtotal', 'Subtotal:'),
    'js.shipping' => t('js.shipping', 'Shipping:'),
    'js.total' => t('js.total', 'Total:'),
    'js.cart_note' => t('js.cart_note', 'Ships to U.S. addresses only. $4 for the first book, $1 for each additional.'),
    'js.checkout' => t('js.checkout', 'Checkout'),
    'js.loading' => t('js.loading', 'Loading…'),
    'js.checkout_error' => t('js.checkout_error', 'Checkout error: {error}'),
    'js.try_again' => t('js.try_again', 'Please try again.'),
    'js.connect_error' => t('js.connect_error', 'Unable to connect to shop. Please try again.'),
    'js.price_error' => t('js.price_error', 'Unable to load product prices. Please refresh.'),
    'js.pre_issue' => t('js.pre_issue', 'Preorder this issue'),
    'js.buy_issue' => t('js.buy_issue', 'Buy this issue'),
    'js.noorder_h' => t('js.noorder_h', 'No order to show'),
    'js.noorder' => t('js.noorder', 'This page shows your receipt right after you pay. If you just paid, check your email for the confirmation; if you did not, <a href="/shop/cart/">your cart</a> or <a href="/shop/">the shop</a> is the place to start. Questions? <a href="mailto:hello@inkhorn.press">hello@inkhorn.press</a>.'),
    'js.complete' => t('js.complete', 'Order Complete'),
    'js.loading_order' => t('js.loading_order', 'Loading your order…'),
    'js.thanks_check' => t('js.thanks_check', 'Thank you for your order! Check your email for confirmation.'),
    'js.thanks_h' => t('js.thanks_h', 'Thank you!'),
    'js.thanks_p' => t('js.thanks_p', 'Your order has been placed. A confirmation has been sent to your email.'),
    'js.qty_n' => t('js.qty_n', 'Qty: {n}'),
    'js.ebook_on' => t('js.ebook_on', 'Your ebook will be emailed to you on {date}.'),
    'js.ebook_now' => t('js.ebook_now', 'Your download link is being emailed to you.'),
    'js.continue' => t('js.continue', 'Continue reading'),
    'js.thanks_way' => t('js.thanks_way', 'Thank you for your order! A confirmation email is on its way.'),
  ];
}
add_action('wp_enqueue_scripts', function () { wp_add_inline_script('inkhorn-shop', 'window.IH_T=Object.assign(window.IH_T||{},' . wp_json_encode(js_strings()) . ');', 'before'); }, 20);
