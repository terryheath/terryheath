<?php
namespace Inkhorn;

/**
 * Help (FAQ + contact form), Start here, double opt-in confirmation, sign-in hand-off between the network's domains.
 */

/* ---------- Help ---------- */

function support_email() { return in_array(site()['kind'], ['author', 'podcast'], true) ? 'hello@terryheath.com' : 'hello@inkhorn.press'; }

function faq_items() {
  return [
    t('help.g_orders', 'Orders') => [
      [t('help.q1', 'Where is my order?'), t('help.a1', 'We email a confirmation when you pay. We mail print copies within a few days. Ebooks arrive by email right away, or on release day for a preorder. Nothing after a day? Check spam, then write to us with the email you used.')],
      [t('help.q2', 'I can’t find my ebook download link.'), t('help.a2', 'Links work for 30 days and five downloads. Lost or expired? Write to us with the email you used, and we’ll send a new one.')],
      [t('help.q3', 'Can I change or cancel an order?'), t('help.a3', 'Write to us right away. We can change a print order until it ships. We can’t cancel a delivered ebook.')],
    ],
    t('help.g_shipping', 'Shipping') => [
      [t('help.q4', 'Where do print copies ship?'), t('help.a4', 'We ship print within the U.S.: $4 for the first copy, $1 for each after. Outside the U.S., buy the ebook. We email it anywhere.')],
      [t('help.q5', 'I moved. How do I change my mailing address?'), t('help.a5', 'Sign in, open Account and update your address. We mail every subscription issue there.')],
    ],
    t('help.g_subs', 'Subscriptions') => [
      [t('help.q6', 'What do the subscriptions include?'), t('help.a6', 'Ebook, $20 a year: every issue as an ebook. Print, $48 a year: four printed issues mailed in the U.S., plus the ebooks. Add White Rabbit Ebook ($7) or White Rabbit Print ($14) to either.')],
      [t('help.q7', 'How do I update my card, change plans or cancel?'), t('help.a7', 'Sign in, open Account and choose Manage billing. Update your card, see receipts, change plans or cancel there. We email you before each renewal.')],
      [t('help.q8', 'My payment failed.'), t('help.a8', 'We didn’t charge you. Try another card from Subscriptions or Manage billing. Still failing? Write to us.')],
    ],
    t('help.g_agree', 'Contributor agreements and payments') => [
      [t('help.q9', 'How do I sign my agreement?'), t('help.a9', 'Open the link in your agreement email and sign online. It takes a minute. We email you a signed copy and keep it under Agreements in your account.')],
      [t('help.q10', 'When and how am I paid?'), t('help.a10', 'We pay on the issue’s release day: Zelle or PayPal in the U.S., Wise elsewhere. Chose a subscription instead? It starts when you sign. See everything under Payments in your account.')],
      [t('help.q11', 'How do I change my bio or headshot?'), t('help.a11', 'Sign in, open Account and edit your profile. The editor approves changes before they go live. Withdraw a change any time before then.')],
    ],
  ];
}

function view_help() {
  $msg = $_GET['sent'] ?? '';
  $h = '<main class="ih-main ih-help"><h1 class="ih-h1">' . tx('help.heading', 'Help') . '</h1><p class="ih-note" style="margin:0 auto 40px;text-align:center">' . tx('help.intro', 'Find your question below, or write to us with the form at the bottom.') . '</p>';
  foreach (faq_items() as $group => $qs) {
    $h .= '<section aria-label="' . a($group) . '"><h2>' . e($group) . '</h2>';
    foreach ($qs as $q) { $h .= '<details class="ih-faq"><summary>' . e($q[0]) . '</summary><p>' . e($q[1]) . '</p></details>'; }
    $h .= '</section>';
  }
  $h .= '<section id="contact" aria-label="' . ta('help.contact', 'Contact us') . '"><h2>' . tx('help.contact', 'Contact us') . '</h2><form class="ih-form ih-contact" method="post" action="' . a(rest_url('inkhorn/v1/contact')) . '" data-ih-signup>'
     . '<p><label for="ih-cn">' . tx('help.name', 'Your name') . '</label><input id="ih-cn" name="name" required autocomplete="name"></p>'
     . '<p><label for="ih-ce">' . tx('help.email', 'Your email') . '</label><input id="ih-ce" type="email" name="email" required autocomplete="email"></p>'
     . '<p><label for="ih-ct">' . tx('help.topic', 'What is this about?') . '</label><select id="ih-ct" name="topic"><option>' . tx('help.t1', 'An order') . '</option><option>' . tx('help.t2', 'Shipping') . '</option><option>' . tx('help.t3', 'A subscription') . '</option><option>' . tx('help.t4', 'My contributor agreement or payment') . '</option><option>' . tx('help.t5', 'Something else') . '</option></select></p>'
     . '<p><label for="ih-cm">' . tx('help.message', 'Message') . '</label><textarea id="ih-cm" name="message" rows="6" required></textarea></p>'
     . '<div hidden aria-hidden="true" style="display:none"><input name="website" tabindex="-1" autocomplete="off" value=""></div>'
     . '<p><button class="ih-btn" type="submit">' . tx('help.send', 'Send') . '</button></p><p class="ih-msg" role="status" aria-live="polite"></p></form>'
     . '<p class="ih-sub" style="text-align:left">' . th('help.or_write', 'Or write to <a href="mailto:{email}">{email}</a>.', ['email' => esc_html(support_email())]) . '</p></section></main>';
  return $h;
}

add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/contact', ['methods' => 'POST', 'permission_callback' => '__return_true', 'callback' => function (\WP_REST_Request $r) {
    if ($r->get_param('website')) { return ['ok' => true, 'message' => t('msg.contact_ok', 'Thank you. We will write back soon.')]; } // honeypot
    $ip = md5((string) ($_SERVER['REMOTE_ADDR'] ?? '')); $k = 'ih_contact_' . $ip; $n = (int) get_transient($k);
    if ($n >= 5) { return new \WP_REST_Response(['ok' => false, 'message' => t('msg.contact_many', 'Too many messages from this connection. Please try again in an hour.')], 429); }
    $email = sanitize_email((string) $r->get_param('email')); $name = sanitize_text_field((string) $r->get_param('name'));
    $msg = sanitize_textarea_field((string) $r->get_param('message')); $topic = sanitize_text_field((string) $r->get_param('topic'));
    if (!is_email($email) || !$name || !$msg) { return new \WP_REST_Response(['ok' => false, 'message' => t('msg.contact_missing', 'Please fill in your name, a valid email and a message.')], 400); }
    set_transient($k, $n + 1, HOUR_IN_SECONDS);
    $to = support_email();
    $sent = wp_mail($to, '[Help] ' . ($topic ?: 'Message') . ' from ' . $name, "From: $name <$email>\nSite: " . site()['name'] . "\nTopic: $topic\n\n$msg\n", ['Reply-To: ' . $name . ' <' . $email . '>']);
    return $sent ? ['ok' => true, 'message' => t('msg.contact_ok', 'Thank you. We will write back soon.')] : new \WP_REST_Response(['ok' => false, 'message' => t('msg.contact_fail', 'The message did not send. Please write to {email}.', ['email' => $to])], 502);
  }]);
});

/* ---------- Start here (body text is marked placeholders for Terry to write) ---------- */

function ph($label) { return '<p class="ih-ph"><span class="ih-ph-tag">' . tx('start.placeholder', 'PLACEHOLDER') . '</span> ' . e($label) . '</p>'; }

function view_start_here() {
  $h = '<main class="ih-main ih-start"><h1 class="ih-h1">' . tx('start.heading', 'Start here') . '</h1>'
     . '<section aria-label="' . ta('start.s1', 'Welcome') . '"><h2>' . tx('start.h_new', 'New to poetry?') . '</h2>' . ph(t('start.p_welcome', 'Two or three sentences of welcome for a reader who thinks poetry is not for them.')) . '</section>'
     . '<section aria-label="' . ta('start.s2', 'The forms we read') . '"><h2>' . tx('start.h_forms', 'The forms the Review focuses on') . '</h2>'
     . '<h3>' . tx('start.h_poetry', 'Poetry') . '</h3>' . ph(t('start.p_poetry', 'What a reader can expect from a poem in the Review, in a few lines.'))
     . '<h3>' . tx('start.h_prose', 'Short prose') . '</h3>' . ph(t('start.p_prose', 'What short prose means here, and how long a piece runs.'))
     . '<h3>' . tx('start.h_art', 'Art') . '</h3>' . ph(t('start.p_art', 'How art appears in the issue.')) . '</section>'
     . '<section aria-label="' . ta('start.s3', 'A few poems to begin with') . '"><h2>' . tx('start.h_poems', 'A few poems to begin with') . '</h2><ol class="ih-order">';
  for ($i = 1; $i <= 3; $i++) { $h .= '<li>' . ph(t('start.p_poem', 'Poem {n}: title, poet, and a link to the poem. One sentence on why to start here.', ['n' => $i])) . '</li>'; }
  $h .= '</ol></section>' . signup() . '</main>';
  return $h;
}

/* ---------- double opt-in ---------- */

function nl_key($t) { return 'ih_nl_' . substr(hash('sha256', $t), 0, 32); }
function nl_long_key($t) { return 'ih_nlx_' . substr(hash('sha256', $t), 0, 32); }

/** Records a pending signup and emails the confirmation link (valid two days; the choices are kept two weeks so an expired link can be resent). */
function nl_start($email, array $lists, $from = '') {
  $t = wp_generate_password(40, false);
  $rec = ['email' => $email, 'lists' => $lists, 'from' => $from];
  set_transient(nl_key($t), $rec, 2 * DAY_IN_SECONDS);
  set_transient(nl_long_key($t), $rec, 14 * DAY_IN_SECONDS);
  $url = add_query_arg('t', $t, hub_url('newsletter/confirm/'));
  $names = implode(', ', array_map(function ($l) { return list_label($l); }, $lists));
  $mail = site()['kind'] === 'author' || site()['kind'] === 'podcast' ? 'Terry Heath' : 'Inkhorn Press';
  return wp_mail($email, t('email.confirm_subject', 'Confirm your sign-up'), t('email.confirm_body', "Hello,\n\nYou asked to get news and updates by email: {lists}.\n\nConfirm it with this link (it works for two days):\n\n{url}\n\nIf you did not ask for this, ignore this email and nothing will happen.\n\nQuestions? Write to {support} or see {help}\n\n{sender}", ['lists' => $names, 'url' => $url, 'support' => support_email(), 'help' => home_url('/help/'), 'sender' => $mail]));
}

add_action('template_redirect', function () {
  $v = get_query_var('ih_view');
  if ($v === 'nl-confirm') {
    $t = sanitize_text_field($_GET['t'] ?? ''); $rec = $t ? get_transient(nl_key($t)) : null;
    if (!$rec) { wp_safe_redirect(add_query_arg('t', $t, home_url('/newsletter/expired/'))); exit; }
    $map = lm_lists_by_slug(); $ids = [];
    foreach ($rec['lists'] as $s) { if (!empty($map[$s])) { $ids[] = $map[$s]; } }
    $ok = $ids && lm('POST', '/subscribers', ['email' => $rec['email'], 'name' => '', 'status' => 'enabled', 'lists' => $ids, 'preconfirm_subscriptions' => true]);
    if (!$ok) { // already a subscriber: add the lists to the existing record
      $d = lm('GET', '/subscribers?per_page=1&query=' . rawurlencode("subscribers.email = '" . str_replace("'", "''", $rec['email']) . "'"));
      $sid = $d['results'][0]['id'] ?? 0;
      $ok = $sid && $ids && lm('PUT', '/subscribers/lists', ['ids' => [(int) $sid], 'action' => 'add', 'target_list_ids' => $ids, 'status' => 'confirmed']);
    }
    if (!$ok) { wp_safe_redirect(home_url('/newsletter/expired/?t=' . rawurlencode($t) . '&problem=1')); exit; }
    delete_transient(nl_key($t)); delete_transient(nl_long_key($t));
    wp_safe_redirect(home_url('/newsletter/confirmed/')); exit;
  }
  if ($v === 'adopt') { // sign-in hand-off: a two-minute signed token sets this domain's session cookie
    $p = explode('|', sanitize_text_field(wp_unslash($_GET['t'] ?? '')));
    if (count($p) === 3 && (int) $p[1] > time() && hash_equals(hash_hmac('sha256', 'adopt|' . $p[0] . '|' . $p[1], secret()), $p[2])) {
      $exp = time() + 30 * DAY_IN_SECONDS;
      setcookie(COOKIE, sign_email(strtolower($p[0]), $exp), ['expires' => $exp, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
      wp_safe_redirect(home_url('/')); exit;
    }
    wp_safe_redirect(hub_url('signin/?expired=1')); exit;
  }
});

add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/newsletter-resend', ['methods' => 'POST', 'permission_callback' => '__return_true', 'callback' => function (\WP_REST_Request $r) {
    $t = sanitize_text_field((string) $r->get_param('t')); $rec = $t ? get_transient(nl_long_key($t)) : null;
    if (!$rec) { return new \WP_REST_Response(['ok' => false, 'message' => t('msg.nl_notfound', 'We could not find that sign-up. Please sign up again below.')], 404); }
    $to = sanitize_email((string) $r->get_param('email')); if (!is_email($to)) { $to = $rec['email']; }
    nl_start($to, $rec['lists'], $rec['from']);
    return ['ok' => true, 'message' => t('signup.sent', 'Check your email. We sent a link to {email}.', ['email' => $to])];
  }]);
});

function view_nl_confirmed() {
  return '<main class="ih-main"><h1 class="ih-h1">' . tx('nl.confirmed_h', 'You’re signed up') . '</h1><p class="ih-note" style="margin:0 auto 24px;text-align:center" role="status">' . tx('nl.confirmed', 'Thanks. Watch for our next email.') . '</p>'
    . '<div class="ih-btns" style="justify-content:center">' . btn(hub_url('newsletter/'), t('nl.choose', 'Change your lists')) . btn(home_url('/'), t('nl.back', 'Back to the site')) . '</div></main>';
}
function view_nl_expired() {
  $t = sanitize_text_field($_GET['t'] ?? ''); $rec = $t ? get_transient(nl_long_key($t)) : null;
  $h = '<main class="ih-main"><h1 class="ih-h1">' . tx('nl.expired_h', 'That link has expired') . '</h1><p class="ih-note" style="margin:0 auto 24px;text-align:center" role="alert">' . tx('nl.expired', 'Links last two days. Enter your email for a new one.') . '</p>';
  if ($rec) {
    $h .= '<form class="ih-form" method="post" action="' . a(rest_url('inkhorn/v1/newsletter-resend')) . '" data-ih-signup><input type="hidden" name="t" value="' . a($t) . '"><div class="ih-row"><label class="ih-sr" for="ih-re">' . tx('signup.email', 'Email address') . '</label><input id="ih-re" type="email" name="email" required autocomplete="email" value="' . a($rec['email']) . '"><button class="ih-btn" type="submit">' . tx('nl.resend', 'Email me a new link') . '</button></div><p class="ih-msg" role="status" aria-live="polite"></p></form>';
  } else { $h .= signup(); }
  return $h . '</main>';
}

/* ---------- terryheath.com and lifeonwords.com: host line, related essays and episodes ---------- */

function site_blog_id($key) { $s = get_sites(['path' => $key === 'hub' ? '/' : '/' . $key . '/', 'number' => 1]); return $s ? (int) $s[0]->blog_id : 0; }
function related_block($heading, array $items) {
  if (!$items) { return ''; }
  $h = '<section class="ih-related" aria-label="' . a($heading) . '"><h2>' . e($heading) . '</h2><ul class="ih-list">';
  foreach ($items as $it) { $h .= '<li><a href="' . a($it['url']) . '"><span class="ih-pt">' . e($it['title']) . '</span><span class="ih-pa">' . e($it['meta']) . '</span></a></li>'; }
  return $h . '</ul></section>';
}
function host_line() {
  return '<p class="ih-host">' . th('episode.host', 'Hosted by <a href="{url}">Terry Heath</a>', ['url' => esc_url(pub_url('terryheath', 'about/'))]) . '</p>';
}
