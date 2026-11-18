<?php
namespace Inkhorn;

/**
 * Signup: the form posts here, WordPress passes it to listmonk's subscriber API.
 * Env on the wordpress service: LISTMONK_URL (the public listmonk address). The list uuids live in the network option inkhorn_listmonk_lists.
 */
add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/subscribe', [
    'methods' => 'POST', 'permission_callback' => '__return_true',
    'callback' => function (\WP_REST_Request $req) {
      $email = sanitize_email((string) $req->get_param('email'));
      $lists = array_values(array_intersect((array) $req->get_param('lists'), array_keys(LIST_LABELS)));
      $wants_json = strpos((string) $req->get_header('accept'), 'application/json') !== false;
      $fail = function ($msg, $code = 400) use ($wants_json) {
        if ($wants_json) { return new \WP_REST_Response(['ok' => false, 'message' => $msg], $code); }
        wp_safe_redirect(add_query_arg('subscribed', '0', wp_get_referer() ?: home_url('/'))); exit;
      };
      if (!is_email($email)) { return $fail('Please enter a valid email address.'); }
      if (!$lists) { return $fail('Choose at least one list.'); }
      $url = getenv('LISTMONK_URL');
      $uuids = lists_uuids($lists);
      if (!$url || !$uuids) { return $fail('Signup is not switched on yet.', 503); }
      // listmonk's public subscription endpoint creates the subscriber and sends the opt-in email
      $pub = wp_remote_post(rtrim($url, '/') . '/subscription/form', ['timeout' => 15, 'body' => ['email' => $email, 'name' => '', 'l' => $uuids, 'nonce' => '']]);
      if (is_wp_error($pub)) { return $fail('Something went wrong. Please try again.', 502); }
      if ($wants_json) { return new \WP_REST_Response(['ok' => true, 'message' => 'Thank you. Check your email to confirm.']); }
      wp_safe_redirect(add_query_arg('subscribed', '1', wp_get_referer() ?: home_url('/'))); exit;
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
