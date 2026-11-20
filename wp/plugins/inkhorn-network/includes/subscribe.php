<?php
namespace Inkhorn;

/**
 * Signup: the form posts here, WordPress passes it to listmonk's subscriber API.
 * Env on the wordpress service: LISTMONK_URL (the public listmonk address). The list uuids live in the network option inkhorn_listmonk_lists.
 */
add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/newsletter-signup', [
    'methods' => 'POST', 'permission_callback' => '__return_true',
    'callback' => function (\WP_REST_Request $req) {
      $email = sanitize_email((string) $req->get_param('email'));
      $lists = array_values(array_intersect((array) $req->get_param('lists'), array_keys(LIST_LABELS)));
      $wants_json = strpos((string) $req->get_header('accept'), 'application/json') !== false;
      $fail = function ($msg, $code = 400) use ($wants_json) {
        if ($wants_json) { return new \WP_REST_Response(['ok' => false, 'message' => $msg], $code); }
        wp_safe_redirect(add_query_arg('signed-up', '0', wp_get_referer() ?: home_url('/'))); exit;
      };
      if (!is_email($email)) { return $fail(t('msg.bademail', 'Please enter a valid email address.')); }
      if (!$lists) { return $fail(t('msg.nolist', 'Choose at least one list.')); }
      if (!getenv('LISTMONK_URL')) { return $fail(t('msg.nosignup', 'Signup is not switched on yet.'), 503); }
      $ip = md5((string) ($_SERVER['REMOTE_ADDR'] ?? '')); $kk = 'ih_su_' . $ip; $n = (int) get_transient($kk);
      if ($n >= 8) { return $fail(t('msg.toomany_signup', 'Too many sign-ups from this connection. Please try again in an hour.'), 429); }
      set_transient($kk, $n + 1, HOUR_IN_SECONDS);
      // double opt-in: nothing is subscribed until the person opens the link we email
      if (!nl_start($email, $lists, sanitize_key((string) $req->get_param('from')))) { return $fail(t('msg.confirm_fail', 'We could not send the confirmation email. Please try again.'), 502); }
      if ($wants_json) { return new \WP_REST_Response(['ok' => true, 'message' => t('signup.sent', 'Check your email. We sent a link to {email}.', ['email' => $email])]); }
      setcookie('ih_sent_to', $email, ['expires' => time() + 600, 'path' => '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax']); wp_safe_redirect(add_query_arg('signed-up', '1', wp_get_referer() ?: home_url('/'))); exit;
    },
  ]);
});

/** Map our list slugs to listmonk list UUIDs (cached; the lists are created by scripts/listmonk-setup.cjs). */
function lists_uuids($slugs) {
  $map = get_site_option('inkhorn_listmonk_lists', []);
  $out = [];
  foreach ($slugs as $s) { if (!empty($map[$s])) { $out[] = $map[$s]; } }
  return $out;
}
