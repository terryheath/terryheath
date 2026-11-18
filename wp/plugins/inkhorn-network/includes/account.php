<?php
namespace Inkhorn;

/**
 * Accounts on the hub: magic-link sign-in only (no passwords), a signed cookie, and /account/.
 * Contributor accounts are created when an agreement is signed (POST /inkhorn/v1/contributor-account, server token), name and bio from the agreement.
 * Profile edits wait in the contributor's pending record until Terry approves them in the admin hub.
 */
const COOKIE = 'ih_session';

function secret() { return wp_salt('auth') . (getenv('INKHORN_IMPORT_TOKEN') ?: ''); }
function sign_email($email, $exp) { return $email . '|' . $exp . '|' . hash_hmac('sha256', $email . '|' . $exp, secret()); }
function session_email() {
  if (empty($_COOKIE[COOKIE])) { return ''; }
  $p = explode('|', wp_unslash($_COOKIE[COOKIE]));
  if (count($p) !== 3 || (int) $p[1] < time() || !hash_equals(hash_hmac('sha256', $p[0] . '|' . $p[1], secret()), $p[2])) { return ''; }
  return strtolower($p[0]);
}
function token_key($t) { return 'ih_tok_' . substr(hash('sha256', $t), 0, 32); }

/** Pages that are not posts: /signin/, /account/, /preferences/ (hub only). */
add_action('init', function () {
  add_rewrite_rule('^(signin|account|newsletter)/?$', 'index.php?ih_view=$matches[1]', 'top');
  add_rewrite_rule('^shop/(cart|order-complete|subscriptions)/?$', 'index.php?ih_view=$matches[1]', 'top');
  add_rewrite_rule('^shop/?$', 'index.php?ih_view=shop', 'top');
  add_rewrite_rule('^shop/([^/]+)/?$', 'index.php?ih_view=book&ih_book_slug=$matches[1]', 'top');
  add_rewrite_rule('^signin/verify/?$', 'index.php?ih_view=verify', 'top');
  add_rewrite_rule('^signin/out/?$', 'index.php?ih_view=out', 'top');
});
add_filter('query_vars', function ($v) { $v[] = 'ih_view'; $v[] = 'ih_book_slug'; return $v; });
add_action('template_redirect', function () {
  $v = get_query_var('ih_view'); if (!$v) { return; }
  if ($v === 'verify') {
    $t = sanitize_text_field($_GET['t'] ?? ''); $email = $t ? get_transient(token_key($t)) : '';
    if ($email) {
      delete_transient(token_key($t));
      $exp = time() + 30 * DAY_IN_SECONDS;
      setcookie(COOKIE, sign_email($email, $exp), ['expires' => $exp, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
      wp_safe_redirect(home_url('/account/')); exit;
    }
    wp_safe_redirect(home_url('/signin/?expired=1')); exit;
  }
  if ($v === 'out') { setcookie(COOKIE, '', ['expires' => 1, 'path' => '/', 'secure' => true, 'httponly' => true]); wp_safe_redirect(home_url('/')); exit; }
  global $wp_query; $wp_query->is_404 = false; status_header(200);
});

add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/signin', [
    'methods' => 'POST', 'permission_callback' => '__return_true',
    'callback' => function (\WP_REST_Request $r) {
      $email = strtolower(sanitize_email((string) $r->get_param('email')));
      // the same answer whether or not the address is known (no account enumeration)
      if (is_email($email)) {
        $t = wp_generate_password(40, false);
        set_transient(token_key($t), $email, 15 * MINUTE_IN_SECONDS);
        $url = add_query_arg('t', $t, home_url('/signin/verify/'));
        wp_mail($email, 'Your Inkhorn Press sign-in link', "Hello,\n\nUse this link to sign in. It works once and expires in 15 minutes:\n\n$url\n\nIf you did not ask for it, you can ignore this email.\n\nInkhorn Press");
      }
      return ['ok' => true, 'message' => 'If that address has an account, a sign-in link is on its way.'];
    },
  ]);
  // Server-to-server: create or update a contributor account from a signed agreement.
  register_rest_route('inkhorn/v1', '/contributor-account', [
    'methods' => 'POST',
    'permission_callback' => function (\WP_REST_Request $r) { $t = getenv('INKHORN_IMPORT_TOKEN'); return $t && hash_equals($t, (string) $r->get_header('x-import-token')); },
    'callback' => function (\WP_REST_Request $r) {
      $d = $r->get_json_params(); $email = strtolower(sanitize_email($d['email'] ?? '')); $name = sanitize_text_field($d['name'] ?? '');
      if (!is_email($email) || !$name) { return new \WP_Error('bad', 'email and name required', ['status' => 400]); }
      switch_to_blog(get_main_site_id());
      $found = get_posts(['post_type' => 'ih_contributor', 'meta_key' => 'ih_email', 'meta_value' => $email, 'numberposts' => 1, 'post_status' => 'any']);
      if (!$found) { $found = get_posts(['post_type' => 'ih_contributor', 'name' => sanitize_title($name), 'numberposts' => 1, 'post_status' => 'any']); }
      $id = $found ? $found[0]->ID : wp_insert_post(['post_type' => 'ih_contributor', 'post_title' => $name, 'post_name' => sanitize_title($name), 'post_status' => 'publish']);
      update_post_meta($id, 'ih_email', $email);
      if (!empty($d['bio']) && !get_post_meta($id, 'ih_bio', true)) { update_post_meta($id, 'ih_bio', sanitize_textarea_field($d['bio'])); }
      restore_current_blog();
      return ['id' => $id];
    },
  ]);
});

function my_contributor($email) {
  switch_to_blog(get_main_site_id());
  $c = get_posts(['post_type' => 'ih_contributor', 'meta_key' => 'ih_email', 'meta_value' => $email, 'numberposts' => 1, 'post_status' => 'any']);
  restore_current_blog();
  return $c ? $c[0] : null;
}

/** Calls the shop service (subscription store). */
function shop($method, $path, $body = null) {
  $base = getenv('SHOP_SERVICE_URL'); $tok = getenv('MEMBER_API_TOKEN');
  if (!$base || !$tok) { return null; }
  $r = wp_remote_request(rtrim($base, '/') . $path, ['method' => $method, 'timeout' => 15, 'headers' => ['X-Member-Token' => $tok, 'Content-Type' => 'application/json'], 'body' => $body ? wp_json_encode($body) : null]);
  if (is_wp_error($r) || wp_remote_retrieve_response_code($r) >= 300) { return null; }
  return json_decode(wp_remote_retrieve_body($r), true);
}
/** Calls the agreements service for a contributor's agreements and payments (read-only). */
function agreements_for($email) {
  $base = getenv('AGREEMENTS_URL'); $tok = getenv('MEMBER_API_TOKEN');
  if (!$base || !$tok) { return null; }
  $r = wp_remote_get(rtrim($base, '/') . '/api/contributor?email=' . rawurlencode($email), ['timeout' => 15, 'headers' => ['X-Member-Token' => $tok]]);
  if (is_wp_error($r) || wp_remote_retrieve_response_code($r) >= 300) { return null; }
  return json_decode(wp_remote_retrieve_body($r), true);
}

/* POST handler for profile edits and portal (plain forms, with a nonce) */
add_action('template_redirect', function () {
  if (get_query_var('ih_view') !== 'account' || $_SERVER['REQUEST_METHOD'] !== 'POST') { return; }
  $email = session_email(); if (!$email) { wp_safe_redirect(home_url('/signin/')); exit; }
  if (!wp_verify_nonce($_POST['_n'] ?? '', 'ih_account_' . $email)) { wp_die('Please reload the page and try again.', '', 400); }
  $do = $_POST['do'] ?? '';
  if ($do === 'portal') {
    $r = shop('POST', '/subscription/portal', ['email' => $email, 'return_url' => home_url('/account/')]);
    if ($r && !empty($r['url'])) { wp_redirect($r['url']); exit; }
    wp_safe_redirect(add_query_arg('msg', 'noportal', home_url('/account/'))); exit;
  }
  if ($do === 'profile' && ($c = my_contributor($email))) {
    // changes wait for approval in the admin hub; nothing goes live until then
    $pending = ['bio' => sanitize_textarea_field($_POST['bio'] ?? ''), 'url' => esc_url_raw($_POST['url'] ?? ''), 'at' => time()];
    if (!empty($_FILES['headshot']['tmp_name'])) {
      require_once ABSPATH . 'wp-admin/includes/file.php'; require_once ABSPATH . 'wp-admin/includes/media.php'; require_once ABSPATH . 'wp-admin/includes/image.php';
      switch_to_blog(get_main_site_id());
      $att = media_handle_upload('headshot', 0, [], ['test_form' => false, 'mimes' => ['jpg|jpeg|jpe' => 'image/jpeg', 'png' => 'image/png']]);
      restore_current_blog();
      if (!is_wp_error($att)) { $pending['headshot_id'] = $att; }
    }
    update_post_meta($c->ID, 'ih_pending', $pending);
    wp_safe_redirect(add_query_arg('msg', 'pending', home_url('/account/'))); exit;
  }
  wp_safe_redirect(home_url('/account/'));
  exit;
});

function view_signin() {
  $h = '<main class="ih-main"><h1 class="ih-h1">Sign in</h1><p class="ih-note" style="margin:0 auto 24px;text-align:center">We email you a link. No password.</p>';
  if (!empty($_GET['expired'])) { $h .= '<p class="ih-sub" style="text-align:center">That link has expired or was already used. Ask for a new one.</p>'; }
  return $h . '<form class="ih-form" method="post" action="' . a(rest_url('inkhorn/v1/signin')) . '" data-ih-signup><div class="ih-row"><label class="ih-sr" for="ih-si">Email address</label>'
    . '<input id="ih-si" type="email" name="email" required autocomplete="email" placeholder="you@example.com"><button class="ih-btn" type="submit">Email me a link</button></div><p class="ih-msg" role="status" aria-live="polite"></p></form></main>';
}

function view_account() {
  $email = session_email();
  if (!$email) { return view_signin(); }
  $n = wp_create_nonce('ih_account_' . $email);
  $msg = $_GET['msg'] ?? '';
  $h = '<main class="ih-main ih-acct"><p class="ih-back"><a href="' . a(home_url('/signin/out/')) . '">Sign out</a></p><h1 class="ih-h1" style="text-align:left">Your account</h1><p class="ih-sub" style="text-align:left">' . e($email) . '</p>';
  if ($msg === 'pending') { $h .= '<p class="ih-note" role="status">Thank you. Your changes are waiting for approval; nothing is public until then.</p>'; }
  if ($msg === 'noportal') { $h .= '<p class="ih-note" role="status">There is no paid subscription to manage for this address.</p>'; }

  // Subscriptions (paid Ebook and Print plans, and the Print subscription taken in place of payment)
  $st = shop('GET', '/subscription/status?email=' . rawurlencode($email));
  $h .= '<section><h2>Subscriptions</h2>';
  if ($st && $st['subscriptions']) {
    $h .= '<ul class="ih-list">';
    foreach ($st['subscriptions'] as $m) {
      $what = ($m['publication'] === 'review' ? 'Inkhorn Review' : 'White Rabbit') . ' ' . ucfirst($m['kind']);
      $how = $m['source'] === 'comp' ? 'Subscription taken in place of payment' : 'Paid subscription';
      $h .= '<li><span class="ih-pt">' . e($what) . '</span><span class="ih-pa">' . e($how) . ' · ' . e($m['status']) . ($m['until'] ? ' · through ' . e(substr($m['until'], 0, 10)) : '') . '</span></li>';
    }
    $h .= '</ul><form method="post"><input type="hidden" name="_n" value="' . a($n) . '"><input type="hidden" name="do" value="portal"><p><button class="ih-btn" type="submit">Manage billing</button></p></form>';
  } else { $h .= '<p class="ih-sub" style="text-align:left">You have no subscription yet.</p><p>' . btn(home_url('/shop/subscriptions/'), 'See subscriptions') . '</p>'; }
  $h .= '</section>';

  // Contributor sections
  $c = my_contributor($email);
  if ($c) {
    $pend = get_post_meta($c->ID, 'ih_pending', true);
    $h .= '<section><h2>Profile</h2><form method="post" enctype="multipart/form-data"><input type="hidden" name="_n" value="' . a($n) . '"><input type="hidden" name="do" value="profile">';
    $img = get_post_meta($c->ID, 'ih_headshot_id', true) ? wp_get_attachment_image_url((int) get_post_meta($c->ID, 'ih_headshot_id', true), 'thumbnail') : '';
    if ($img) { $h .= '<img class="ih-headshot" src="' . a($img) . '" alt="Your current portrait" width="96" height="96">'; }
    $h .= '<p><label for="ih-h">Portrait (JPG or PNG)</label><br><input id="ih-h" type="file" name="headshot" accept="image/jpeg,image/png"></p>'
        . '<p><label for="ih-b">Bio</label><br><textarea id="ih-b" name="bio" rows="5" style="width:100%;font:inherit">' . e($pend['bio'] ?? get_post_meta($c->ID, 'ih_bio', true)) . '</textarea></p>'
        . '<p><label for="ih-u">Website</label><br><input id="ih-u" type="url" name="url" value="' . a($pend['url'] ?? get_post_meta($c->ID, 'ih_url', true)) . '" style="width:100%;min-height:44px"></p>'
        . '<p><button class="ih-btn" type="submit">Send changes for approval</button></p>' . ($pend ? '<p class="ih-sub" style="text-align:left">Waiting for approval.</p>' : '') . '</form></section>';
    $work = contributor_work($c->post_name);
    $h .= '<section><h2>Your work</h2>';
    foreach ($work as $pub => $items) { $h .= '<h3>' . e($pub) . '</h3><ul class="ih-list">'; foreach ($items as $it) { $h .= '<li><a href="' . a($it['url']) . '"><span class="ih-pt">' . e($it['title']) . '</span><span class="ih-pa">' . e($it['issue']) . '</span></a></li>'; } $h .= '</ul>'; }
    if (!$work) { $h .= '<p class="ih-sub" style="text-align:left">Nothing published yet.</p>'; }
    $h .= '</section>';
    $ag = agreements_for($email);
    $h .= '<section><h2>Agreements</h2>';
    if ($ag && !empty($ag['agreements'])) {
      $h .= '<ul class="ih-list">';
      foreach ($ag['agreements'] as $x) { $h .= '<li><span class="ih-pt">' . e($x['title']) . '</span><span class="ih-pa">' . e($x['publication'] . ' ' . $x['issue']) . ' · ' . ($x['signed'] ? 'signed ' . e($x['signed_at']) : 'not signed yet') . ($x['pdf'] ? ' · <a href="' . a($x['pdf']) . '">PDF</a>' : '') . '</span></li>'; }
      $h .= '</ul>';
    } else { $h .= '<p class="ih-sub" style="text-align:left">No agreements yet.</p>'; }
    $h .= '</section><section><h2>Payments</h2>';
    if ($ag && !empty($ag['payments'])) {
      $h .= '<ul class="ih-list">';
      foreach ($ag['payments'] as $x) { $h .= '<li><span class="ih-pt">' . e($x['title']) . '</span><span class="ih-pa">' . e($x['line']) . '</span></li>'; }
      $h .= '</ul>';
    } else { $h .= '<p class="ih-sub" style="text-align:left">No payments yet.</p>'; }
    $h .= '</section>';
  }
  return $h . '</main>';
}

/** listmonk, server to server (reading and changing one subscriber's lists). Env: LISTMONK_URL, LISTMONK_API_USER, LISTMONK_API_TOKEN. */
function lm($method, $path, $body = null) {
  $u = getenv('LISTMONK_URL'); $user = getenv('LISTMONK_API_USER') ?: 'automation'; $tok = getenv('LISTMONK_API_TOKEN');
  if (!$u || !$tok) { return null; }
  $r = wp_remote_request(rtrim($u, '/') . '/api' . $path, ['method' => $method, 'timeout' => 15, 'headers' => ['Authorization' => 'token ' . $user . ':' . $tok, 'Content-Type' => 'application/json'], 'body' => $body ? wp_json_encode($body) : null]);
  if (is_wp_error($r) || wp_remote_retrieve_response_code($r) >= 300) { return null; }
  $d = json_decode(wp_remote_retrieve_body($r), true);
  return $d['data'] ?? true;
}
function lm_lists_by_slug() {
  $out = [];
  $d = lm('GET', '/lists?per_page=all');
  foreach (($d['results'] ?? []) as $l) { foreach (($l['tags'] ?? []) as $t) { $out[$t] = (int) $l['id']; } }
  return $out;
}
function lm_subscriber_by_uuid($uuid) {
  if (!preg_match('/^[0-9a-f-]{36}$/i', $uuid)) { return null; }
  $d = lm('GET', '/subscribers?per_page=1&query=' . rawurlencode("subscribers.uuid = '" . $uuid . "'"));
  return $d['results'][0] ?? null;
}

add_action('template_redirect', function () {
  if (get_query_var('ih_view') !== 'newsletter' || $_SERVER['REQUEST_METHOD'] !== 'POST') { return; }
  $uuid = sanitize_text_field($_POST['id'] ?? ''); $sub = lm_subscriber_by_uuid($uuid);
  if (!$sub) { wp_safe_redirect(home_url('/newsletter/?msg=nope')); exit; }
  $map = lm_lists_by_slug(); $all = array_values($map);
  $chosen = ($_POST['do'] ?? '') === 'none' ? [] : array_values(array_intersect($all, array_map(function ($s) use ($map) { return $map[$s] ?? 0; }, (array) ($_POST['lists'] ?? []))));
  $drop = array_values(array_diff($all, $chosen));
  if ($chosen) { lm('PUT', '/subscribers/lists', ['ids' => [(int) $sub['id']], 'action' => 'add', 'target_list_ids' => $chosen, 'status' => 'confirmed']); }
  if ($drop) { lm('PUT', '/subscribers/lists', ['ids' => [(int) $sub['id']], 'action' => 'unsubscribe', 'target_list_ids' => $drop]); }
  wp_safe_redirect(add_query_arg(['id' => $uuid, 'msg' => ($_POST['do'] ?? '') === 'none' ? 'none' : 'saved'], home_url('/newsletter/'))); exit;
});

function view_newsletter() {
  $uuid = sanitize_text_field($_GET['id'] ?? ''); $msg = $_GET['msg'] ?? '';
  $sub = $uuid ? lm_subscriber_by_uuid($uuid) : null;
  $h = '<main class="ih-main">' . back_link() . '<h1 class="ih-h1">Newsletter</h1>';
  if ($msg === 'saved') { $h .= '<p class="ih-note" style="text-align:center" role="status">Saved. Your choices apply to the next email.</p>'; }
  if ($msg === 'none') { $h .= '<p class="ih-note" style="text-align:center" role="status">You are unsubscribed from every list. You can come back any time.</p>'; }
  if ($msg === 'nope') { $h .= '<p class="ih-note" style="text-align:center" role="alert">That link did not work. Use the link in your latest email, or sign up again below.</p>'; }
  if (!$sub) { return $h . '<p class="ih-note" style="margin:0 auto;text-align:center">Not on a list yet? Choose the ones you want.</p>' . signup('Your lists') . '</main>'; }
  $on = []; foreach (($sub['lists'] ?? []) as $l) { if (($l['subscription_status'] ?? '') !== 'unsubscribed') { foreach (($l['tags'] ?? []) as $t) { $on[$t] = true; } } }
  $groups = ['Inkhorn Press' => ['inkhorn-review', 'white-rabbit', 'muse', 'events'], 'Terry Heath' => ['writing', 'digest', 'new-books'], 'Life on Words' => ['life-on-words']];
  $h .= '<p class="ih-sub" style="text-align:center">' . e($sub['email']) . '</p><form class="ih-form" method="post" action="' . a(home_url('/newsletter/')) . '"><input type="hidden" name="id" value="' . a($uuid) . '">';
  foreach ($groups as $g => $slugs) {
    $h .= '<fieldset><legend style="position:static;font:500 13px Karla,sans-serif;letter-spacing:.12em;color:var(--ih-accent);margin:24px 0 8px;display:block;width:100%">' . e(strtoupper($g)) . '</legend>';
    foreach ($slugs as $s) { $h .= '<label style="display:flex;gap:10px;min-height:44px;align-items:center"><input type="checkbox" name="lists[]" value="' . a($s) . '"' . (!empty($on[$s]) ? ' checked' : '') . '> ' . e(LIST_LABELS[$s] ?? $s) . '</label>'; }
    $h .= '</fieldset>';
  }
  return $h . '<div class="ih-btns" style="justify-content:center"><button class="ih-btn" type="submit" name="do" value="save">Save my choices</button><button class="ih-btn" type="submit" name="do" value="none">Unsubscribe from all</button></div></form></main>';
}

function view_subscriptions() {
  $h = '<main class="ih-main">' . back_link() . '<h1 class="ih-h1">Subscriptions</h1><div class="ih-grid" style="max-width:760px;margin:0 auto">';
  foreach ([['review-ebook', 'Inkhorn Review Ebook', '$20 a year', 'The ebook of each quarterly issue.'], ['review-print', 'Inkhorn Review Print', '$48 a year', 'Four printed issues a year, mailed to any U.S. address, plus the ebook of each.']] as $t) {
    $h .= '<div class="ih-gi"><h3>' . e($t[1]) . '</h3><p>' . e($t[2]) . '</p><p>' . e($t[3]) . '</p><form method="post" action="' . a(rest_url('inkhorn/v1/subscription-checkout')) . '"><input type="hidden" name="tier" value="' . a($t[0]) . '">'
       . '<p><label><input type="checkbox" name="wr" value="ebook"> Add White Rabbit Ebook, $7 a year</label><br><label><input type="checkbox" name="wr" value="print"> Add White Rabbit Print, $14 a year</label></p><button class="ih-btn" type="submit">Subscribe</button></form></div>';
  }
  return $h . '</div></main>';
}

add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/subscription-checkout', [
    'methods' => 'POST', 'permission_callback' => '__return_true',
    'callback' => function (\WP_REST_Request $r) {
      $wr = (array) $r->get_param('wr'); $wr = in_array('print', $wr, true) ? 'print' : (in_array('ebook', $wr, true) ? 'ebook' : null);
      $base = getenv('SHOP_SERVICE_URL');
      $resp = wp_remote_post(rtrim($base, '/') . '/subscription/checkout', ['timeout' => 20, 'headers' => ['Content-Type' => 'application/json'],
        'body' => wp_json_encode(['tier' => sanitize_text_field((string) $r->get_param('tier')), 'whiterabbit' => $wr, 'email' => session_email() ?: null])]);
      $d = is_wp_error($resp) ? null : json_decode(wp_remote_retrieve_body($resp), true);
      if (!empty($d['url'])) { wp_redirect($d['url']); exit; }
      wp_safe_redirect(add_query_arg('msg', 'failed', home_url('/shop/subscriptions/'))); exit;
    },
  ]);
});

/** Admin hub: pending profile changes (list, approve, reject). Same server token. */
add_action('rest_api_init', function () {
  $perm = function (\WP_REST_Request $r) { $t = getenv('INKHORN_IMPORT_TOKEN'); return $t && hash_equals($t, (string) $r->get_header('x-import-token')); };
  register_rest_route('inkhorn/v1', '/pending', ['methods' => 'GET', 'permission_callback' => $perm, 'callback' => function () {
    switch_to_blog(get_main_site_id());
    $out = [];
    foreach (get_posts(['post_type' => 'ih_contributor', 'numberposts' => -1, 'post_status' => 'any', 'meta_key' => 'ih_pending', 'meta_compare' => 'EXISTS']) as $c) {
      $p = get_post_meta($c->ID, 'ih_pending', true); if (!$p) { continue; }
      $out[] = ['id' => $c->ID, 'name' => $c->post_title, 'now' => ['bio' => get_post_meta($c->ID, 'ih_bio', true), 'url' => get_post_meta($c->ID, 'ih_url', true), 'headshot' => get_post_meta($c->ID, 'ih_headshot_id', true) ? wp_get_attachment_image_url((int) get_post_meta($c->ID, 'ih_headshot_id', true), 'thumbnail') : ''],
        'pending' => ['bio' => $p['bio'] ?? '', 'url' => $p['url'] ?? '', 'headshot' => !empty($p['headshot_id']) ? wp_get_attachment_image_url((int) $p['headshot_id'], 'thumbnail') : '', 'at' => $p['at'] ?? 0]];
    }
    restore_current_blog();
    return $out;
  }]);
  register_rest_route('inkhorn/v1', '/pending/(?P<id>\d+)', ['methods' => 'POST', 'permission_callback' => $perm, 'callback' => function (\WP_REST_Request $r) {
    switch_to_blog(get_main_site_id());
    $id = (int) $r['id']; $d = $r->get_json_params(); $p = get_post_meta($id, 'ih_pending', true);
    if ($p && ($d['do'] ?? '') === 'approve') {
      update_post_meta($id, 'ih_bio', $p['bio'] ?? ''); update_post_meta($id, 'ih_url', $p['url'] ?? '');
      if (!empty($p['headshot_id'])) { update_post_meta($id, 'ih_headshot_id', (int) $p['headshot_id']); }
    }
    delete_post_meta($id, 'ih_pending');
    restore_current_blog();
    return ['ok' => true];
  }]);
});
