<?php
namespace Inkhorn;

/**
 * Site text: every sentence, label, button and message the theme or this plugin prints goes through t().
 *   t('key', 'Default wording', ['name' => 'value'])  -> the wording saved on the "Site text" page of this site, else the default
 * The default is written at the place the text is used; the Site text page finds every t() call in the plugin, so nothing has to be registered twice.
 * {name} in a text is replaced by the value passed in (values are inserted as they are; use tx() to get escaped output).
 * Settings > Site text (each site has its own).
 */

const TEXT_OPTION = 'ih_site_text';

function text_overrides() {
  static $o = null;
  if ($o === null) { $o = get_option(TEXT_OPTION, []); if (!is_array($o)) { $o = []; } }
  return $o;
}
function text_reset_cache() { /* the static is per request; nothing to clear */ }

function t($key, $default, $vars = []) {
  $o = text_overrides();
  $s = (isset($o[$key]) && trim((string) $o[$key]) !== '') ? (string) $o[$key] : $default;
  foreach ($vars as $k => $v) { $s = str_replace('{' . $k . '}', (string) $v, $s); }
  return $s;
}
/** Plain text, escaped for HTML. */
function tx($key, $default, $vars = []) { return esc_html(t($key, $default, $vars)); }
/** Text that may carry links and emphasis (a, em, strong, br); everything else is removed. */
function th($key, $default, $vars = []) {
  return wp_kses(t($key, $default, $vars), ['a' => ['href' => [], 'class' => [], 'rel' => []], 'em' => [], 'i' => [], 'strong' => [], 'b' => [], 'br' => []]);
}
/** Text for an attribute (aria-label, placeholder, alt, title). */
function ta($key, $default, $vars = []) { return esc_attr(t($key, $default, $vars)); }

/* ---------- the Site text page ---------- */

/** Every t()/tx()/th()/ta() call in the plugin: key => [default, file]. Cached until a plugin file changes. */
function text_registry() {
  $files = array_merge(glob(INKHORN_DIR . '/includes/*.php') ?: [], []);
  $sig = '';
  foreach ($files as $f) { $sig .= basename($f) . filemtime($f); }
  $sig = md5($sig);
  $c = get_site_transient('ih_text_registry');
  if (is_array($c) && ($c['sig'] ?? '') === $sig) { return $c['reg']; }
  $reg = [];
  foreach ($files as $f) {
    if (basename($f) === 'text.php') { continue; }
    $src = (string) file_get_contents($f);
    if (preg_match_all('/\b(?:t|tx|th|ta)\(\s*\'([a-z0-9_.\-]+)\'\s*,\s*(\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*")/s', $src, $mm, PREG_SET_ORDER)) {
      foreach ($mm as $m) {
        $d = $m[2]; $q = $d[0]; $d = substr($d, 1, -1);
        $d = $q === "'" ? str_replace(["\\'", '\\\\'], ["'", '\\'], $d) : stripcslashes($d);
        if (!isset($reg[$m[1]])) { $reg[$m[1]] = [$d, basename($f)]; }
      }
    }
  }
  set_site_transient('ih_text_registry', ['sig' => $sig, 'reg' => $reg], DAY_IN_SECONDS);
  return $reg;
}

/** Group names for the page: the part of the key before the first dot. */
function text_groups() {
  return [
    'nav' => 'Navigation and chrome', 'welcome' => 'Welcome band', 'back' => 'Back links', 'signup' => 'Email sign-up form', 'issue' => 'Issue page',
    'piece' => 'Piece page', 'contrib' => 'Contributors', 'books' => 'Books', 'book' => 'Book page', 'episodes' => 'Episodes', 'episode' => 'Episode page',
    'strip' => 'Shop strip (press home)', 'hub' => 'Press home', 'generic' => 'Pages', 'soon' => 'Publication with no issue yet', 'e404' => 'Page not found',
    'search' => 'Search', 'archive' => 'Issue archive', 'low' => 'Life on Words home', 'author' => 'terryheath.com home', 'guest' => 'Guest page',
    'help' => 'Help page', 'start' => 'Start here', 'nl' => 'Newsletter: sign-up, confirmation and preferences', 'signin' => 'Sign in', 'account' => 'Account',
    'shop' => 'Shop', 'cart' => 'Cart', 'email' => 'Emails we send', 'msg' => 'Messages and errors', 'footer' => 'Footer',
    'js' => 'Cart, product page and order page', 'list' => 'Email list names', 'title' => 'Browser tab titles', 'feed' => 'Podcast feed',
  ];
}

add_action('admin_menu', function () {
  add_options_page('Site text', 'Site text', 'manage_options', 'ih-site-text', __NAMESPACE__ . '\\text_page');
});
add_action('network_admin_menu', function () {
  add_submenu_page('settings.php', 'Site text', 'Site text', 'manage_network_options', 'ih-site-text-net', function () {
    echo '<div class="wrap"><h1>Site text</h1><p>Each site has its own wording. Open a site’s dashboard, then <b>Settings → Site text</b>.</p><ul>';
    foreach (get_sites(['number' => 100]) as $s) { echo '<li><a href="' . esc_url(get_admin_url($s->blog_id, 'options-general.php?page=ih-site-text')) . '">' . esc_html(get_blog_option($s->blog_id, 'blogname')) . '</a></li>'; }
    echo '</ul></div>';
  });
});

function text_page($only = null) {
  if (!current_user_can('manage_options')) { return; }
  $reg = text_registry();
  if ($only) { $reg = array_filter($reg, function ($k) use ($only) { foreach ($only as $p) { if (strpos($k, $p) === 0) { return true; } } return false; }, ARRAY_FILTER_USE_KEY); }
  $all_reg = text_registry(); $o = get_option(TEXT_OPTION, []); if (!is_array($o)) { $o = []; }
  if (isset($_POST['ih_text_save']) && check_admin_referer('ih_text')) {
    $new = [];
    foreach ($o as $k => $v) { if (!isset($reg[$k])) { $new[$k] = $v; } } // keep what is not on this page
    foreach ((array) ($_POST['ih_text'] ?? []) as $k => $v) {
      $k = sanitize_text_field($k); $v = trim(wp_unslash((string) $v));
      if (isset($reg[$k]) && $v !== '' && $v !== $reg[$k][0]) { $new[$k] = wp_kses_post($v); }
    }
    update_option(TEXT_OPTION, $new, false); $o = $new;
    delete_site_transient('ih_text_registry');
    echo '<div class="notice notice-success is-dismissible"><p>Saved.</p></div>';
  }
  $groups = text_groups(); $by = [];
  foreach ($reg as $k => $v) { $g = strtok($k, '.'); $by[$groups[$g] ?? ucfirst($g)][$k] = $v; }
  ksort($by);
  echo '<div class="wrap"><h1>' . ($only ? 'Shop text' : 'Site text') . '</h1>' . ($only ? '' : '') . '<p>Every sentence, label, button and message this site prints. Change a box and save; leave a box as it is to keep the original wording. Clear a box to go back to the original. <code>{name}</code> marks a value the site fills in (a name, an address): keep it where it should appear. Links and <code>&lt;em&gt;</code> are allowed where a box already has them.</p>'
     . '<p><b>Page text</b> (About, Donate, Events, Submit, Help articles on pages you wrote in the editor) lives in <a href="' . esc_url(admin_url('edit.php?post_type=page')) . '">Pages</a>; navigation, header and footer live in the <a href="' . esc_url(admin_url('site-editor.php')) . '">Site Editor</a>.</p>'
     . '<form method="post">'; wp_nonce_field('ih_text');
  echo '<p><input type="search" id="ih-text-filter" placeholder="Find a sentence…" style="width:min(420px,100%)" oninput="var q=this.value.toLowerCase();document.querySelectorAll(\'.ih-trow\').forEach(function(r){r.style.display=r.textContent.toLowerCase().indexOf(q)<0&&(r.querySelector(\'textarea\').value.toLowerCase().indexOf(q)<0)?\'none\':\'\'})"></p>';
  foreach ($by as $name => $items) {
    echo '<details open style="margin:0 0 18px"><summary style="font-size:15px;font-weight:600;cursor:pointer;margin-bottom:8px">' . esc_html($name) . ' (' . count($items) . ')</summary><table class="form-table" role="presentation">';
    foreach ($items as $k => $v) {
      $cur = $o[$k] ?? $v[0]; $rows = max(1, min(8, (int) ceil(strlen($cur) / 70)));
      echo '<tr class="ih-trow"><th scope="row" style="width:30%"><label for="t-' . esc_attr($k) . '" style="font-weight:400">' . esc_html(mb_strimwidth($v[0], 0, 70, '…')) . '</label><br><code style="font-size:11px;color:#777">' . esc_html($k) . '</code></th>'
         . '<td><textarea id="t-' . esc_attr($k) . '" name="ih_text[' . esc_attr($k) . ']" rows="' . $rows . '" class="large-text">' . esc_textarea($cur) . '</textarea></td></tr>';
    }
    echo '</table></details>';
  }
  echo '<p><button class="button button-primary" name="ih_text_save" value="1">Save</button></p></form></div>';
}


/* ---------- Shop: what the shop shows, and where prices live ---------- */
add_action('admin_menu', function () {
  if (site_key() !== 'hub') { return; }
  add_menu_page('Shop', 'Shop', 'manage_options', 'ih-shop', __NAMESPACE__ . '\\shop_admin_page', 'dashicons-cart', 26);
});
function shop_admin_page() {
  if (!current_user_can('manage_options')) { return; }
  $prices = shop_prices();
  echo '<div class="wrap"><h1>Shop</h1><div class="notice notice-info inline"><p><b>Prices are set in Stripe, not here.</b> The shop charges what Stripe holds, and the prices shown on the site are read from it (cached ten minutes). To change a price, '
     . 'open <a href="https://dashboard.stripe.com/products" target="_blank" rel="noopener">Stripe &rarr; Product catalog</a> and add a new price to the product (Stripe prices are not edited in place); the shop picks the new default. '
     . 'Shipping ($4 for the first print copy, $1 for each additional) is set in the shop service code (<code>inkhorn/shop-service/index.js</code>) and needs a code change; the wording that describes it is below.</p></div>';
  echo '<h2>Products</h2><p>Name, description and cover are edited on each product.</p><table class="widefat striped" style="max-width:900px"><thead><tr><th>Product</th><th>SKU</th><th>Print price (from Stripe)</th><th></th></tr></thead><tbody>';
  foreach (get_posts(['post_type' => 'ih_book', 'numberposts' => -1, 'post_status' => ['publish', 'draft', 'future']]) as $b) {
    $sku = get_post_meta($b->ID, 'ih_sku', true);
    echo '<tr><td>' . esc_html(get_the_title($b)) . '</td><td>' . esc_html($sku) . '</td><td>' . (isset($prices[$sku]) ? '$' . esc_html(number_format($prices[$sku] / 100, 2)) : '<em>not in the shop service</em>') . '</td><td><a href="' . esc_url(get_edit_post_link($b->ID)) . '">Edit</a></td></tr>';
  }
  echo '</tbody></table><p><a class="button" href="' . esc_url(admin_url('post-new.php?post_type=ih_book')) . '">Add a product page</a></p>';
  echo '<h2>Subscriptions and shop wording</h2><p>The names, descriptions and display prices of the subscriptions, and the shop, cart and order-page text. The amount Stripe charges comes from Stripe (above); if you change a price there, change the matching text here so the page agrees.</p>';
  text_page(['shop.', 'cart.', 'js.', 'strip.', 'books.', 'book.']);
  echo '</div>';
}
