<?php
namespace Inkhorn;

/**
 * Help (FAQ + contact form), Start here, double opt-in confirmation, sign-in hand-off between the network's domains.
 */

/* ---------- Help ---------- */

function support_email() { return in_array(site()['kind'], ['author', 'podcast'], true) ? 'hello@terryheath.com' : 'hello@inkhorn.press'; }

function faq_items() {
  return [
    'Orders' => [
      ['Where is my order?', 'Every order is emailed to you when you pay. Print copies are packed within a few days and mailed in the U.S.; an ebook arrives by email as a private download link right after payment (for a preorder, on its release day). If nothing has come after a day, check spam, then write to us below with the email you used.'],
      ['I can’t find my ebook download link.', 'Download links last 30 days and work five times. If yours has expired or you lost it, write to us with the email you used at checkout and we will send a new one.'],
      ['Can I change or cancel an order?', 'Write to us as soon as you can. Print copies that have not shipped can be changed; ebooks that have been delivered cannot be cancelled.'],
    ],
    'Shipping' => [
      ['Where do print copies ship?', 'Print copies ship to U.S. addresses only. Shipping is $4 for the first copy and $1 for each additional copy in the same order. Outside the U.S., choose the ebook: it is delivered by email anywhere.'],
      ['I moved. How do I change my mailing address?', 'Sign in, open Account, and update “Where we mail your Print copies”. If you have a Print subscription, that address is used for every issue.'],
    ],
    'Subscriptions' => [
      ['What do the subscriptions include?', 'Inkhorn Review Ebook is $20 a year: the ebook of each quarterly issue. Inkhorn Review Print is $48 a year: four printed issues, mailed to any U.S. address, plus the ebook of each. You can add White Rabbit Ebook ($7 a year) or White Rabbit Print ($14 a year) to either one.'],
      ['How do I update my card, change plans or cancel?', 'Sign in, open Account, and choose Manage billing. It opens a secure page where you can update your card, see receipts, and cancel. Nothing renews without an email first.'],
      ['My payment failed.', 'Nothing was charged for a failed payment. Try again from Subscriptions or Manage billing with another card, and write to us if it keeps failing.'],
    ],
    'Contributor agreements and payments' => [
      ['How do I sign my agreement?', 'You receive an email from DocuSeal with a link. It opens in your browser and takes a minute; there is nothing to print. A signed copy is emailed to you and appears under Agreements in your account.'],
      ['When and how am I paid?', 'Paid pieces are paid on the issue’s release day: by Zelle or PayPal in the U.S., or by Wise elsewhere. Pay you have chosen to take as a Print subscription instead starts on signing. Everything you are owed or have been paid appears under Payments in your account.'],
      ['How do I change my bio or portrait?', 'Sign in, open Account, edit your profile and send the changes. They wait for approval; nothing changes in public until then, and you can withdraw a pending change at any time.'],
    ],
  ];
}

function view_help() {
  $msg = $_GET['sent'] ?? '';
  $h = '<main class="ih-main ih-help"><h1 class="ih-h1">Help</h1><p class="ih-note" style="margin:0 auto 40px;text-align:center">Answers first. If yours isn’t here, write to us below.</p>';
  foreach (faq_items() as $group => $qs) {
    $h .= '<section aria-label="' . a($group) . '"><h2>' . e($group) . '</h2>';
    foreach ($qs as $q) { $h .= '<details class="ih-faq"><summary>' . e($q[0]) . '</summary><p>' . e($q[1]) . '</p></details>'; }
    $h .= '</section>';
  }
  $h .= '<section id="contact" aria-label="Contact us"><h2>Contact us</h2><form class="ih-form ih-contact" method="post" action="' . a(rest_url('inkhorn/v1/contact')) . '" data-ih-signup>'
     . '<p><label for="ih-cn">Your name</label><input id="ih-cn" name="name" required autocomplete="name"></p>'
     . '<p><label for="ih-ce">Your email</label><input id="ih-ce" type="email" name="email" required autocomplete="email"></p>'
     . '<p><label for="ih-ct">What is this about?</label><select id="ih-ct" name="topic"><option>An order</option><option>Shipping</option><option>A subscription</option><option>My contributor agreement or payment</option><option>Something else</option></select></p>'
     . '<p><label for="ih-cm">Message</label><textarea id="ih-cm" name="message" rows="6" required></textarea></p>'
     . '<p class="ih-sr" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></p>'
     . '<p><button class="ih-btn" type="submit">Send</button></p><p class="ih-msg" role="status" aria-live="polite"></p></form>'
     . '<p class="ih-sub" style="text-align:left">Or write to <a href="mailto:' . a(support_email()) . '">' . e(support_email()) . '</a>.</p></section></main>';
  return $h;
}

add_action('rest_api_init', function () {
  register_rest_route('inkhorn/v1', '/contact', ['methods' => 'POST', 'permission_callback' => '__return_true', 'callback' => function (\WP_REST_Request $r) {
    if ($r->get_param('website')) { return ['ok' => true, 'message' => 'Thank you. We will write back soon.']; } // honeypot
    $ip = md5((string) ($_SERVER['REMOTE_ADDR'] ?? '')); $k = 'ih_contact_' . $ip; $n = (int) get_transient($k);
    if ($n >= 5) { return new \WP_REST_Response(['ok' => false, 'message' => 'Too many messages from this connection. Please try again in an hour.'], 429); }
    $email = sanitize_email((string) $r->get_param('email')); $name = sanitize_text_field((string) $r->get_param('name'));
    $msg = sanitize_textarea_field((string) $r->get_param('message')); $topic = sanitize_text_field((string) $r->get_param('topic'));
    if (!is_email($email) || !$name || !$msg) { return new \WP_REST_Response(['ok' => false, 'message' => 'Please fill in your name, a valid email and a message.'], 400); }
    set_transient($k, $n + 1, HOUR_IN_SECONDS);
    $to = support_email();
    $sent = wp_mail($to, '[Help] ' . ($topic ?: 'Message') . ' from ' . $name, "From: $name <$email>\nSite: " . site()['name'] . "\nTopic: $topic\n\n$msg\n", ['Reply-To: ' . $name . ' <' . $email . '>']);
    return $sent ? ['ok' => true, 'message' => 'Thank you. We will write back soon.'] : new \WP_REST_Response(['ok' => false, 'message' => 'The message did not send. Please write to ' . $to . '.'], 502);
  }]);
});

/* ---------- Start here (body text is marked placeholders for Terry to write) ---------- */

function ph($label) { return '<p class="ih-ph"><span class="ih-ph-tag">PLACEHOLDER</span> ' . e($label) . '</p>'; }

function view_start_here() {
  $h = '<main class="ih-main ih-start"><h1 class="ih-h1">Start here</h1>'
     . '<section aria-label="Welcome"><h2>New to poetry?</h2>' . ph('Two or three sentences of welcome for a reader who thinks poetry is not for them.') . '</section>'
     . '<section aria-label="The forms we read"><h2>The forms the Review focuses on</h2>'
     . '<h3>Poetry</h3>' . ph('What a reader can expect from a poem in the Review, in a few lines.')
     . '<h3>Short prose</h3>' . ph('What short prose means here, and how long a piece runs.')
     . '<h3>Micro</h3>' . ph('What a micro piece is and how to read one.')
     . '<h3>Art</h3>' . ph('How art appears in the issue.') . '</section>'
     . '<section aria-label="A few poems to begin with"><h2>A few poems to begin with</h2><ol class="ih-order">';
  for ($i = 1; $i <= 3; $i++) { $h .= '<li>' . ph('Poem ' . $i . ': title, poet, and a link to the poem. One sentence on why to start here.') . '</li>'; }
  $h .= '</ol></section><section aria-label="Muse"><h2>Write your own</h2>' . ph('One or two sentences inviting the reader to try Muse.')
     . '<p>' . btn(pub_url('muse'), 'Go to Muse') . '</p></section>' . signup() . '</main>';
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
  $names = implode(', ', array_map(function ($l) { return LIST_LABELS[$l] ?? $l; }, $lists));
  $mail = site()['kind'] === 'author' || site()['kind'] === 'podcast' ? 'Terry Heath' : 'Inkhorn Press';
  return wp_mail($email, 'Confirm your sign-up', "Hello,\n\nYou asked to get news and updates by email: $names.\n\nConfirm it with this link (it works for two days):\n\n$url\n\nIf you did not ask for this, ignore this email and nothing will happen.\n\n$mail");
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
    if (!$rec) { return new \WP_REST_Response(['ok' => false, 'message' => 'We could not find that sign-up. Please sign up again below.'], 404); }
    nl_start($rec['email'], $rec['lists'], $rec['from']);
    return ['ok' => true, 'message' => 'A new link is on its way. Check your email.'];
  }]);
});

function view_nl_confirmed() {
  return '<main class="ih-main"><h1 class="ih-h1">You’re signed up</h1><p class="ih-note" style="margin:0 auto 24px;text-align:center" role="status">Thank you. Your address is confirmed and the next email will reach you.</p>'
    . '<div class="ih-btns" style="justify-content:center">' . btn(hub_url('newsletter/'), 'Choose your lists') . btn(home_url('/'), 'Back to the site') . '</div></main>';
}
function view_nl_expired() {
  $t = sanitize_text_field($_GET['t'] ?? '');
  $h = '<main class="ih-main"><h1 class="ih-h1">That link has expired</h1><p class="ih-note" style="margin:0 auto 24px;text-align:center" role="alert">' . (!empty($_GET['problem']) ? 'We could not finish your sign-up just now.' : 'Confirmation links work for two days.') . ' We can send a new one.</p>';
  if ($t && get_transient(nl_long_key($t))) {
    $h .= '<form class="ih-form" method="post" action="' . a(rest_url('inkhorn/v1/newsletter-resend')) . '" data-ih-signup><input type="hidden" name="t" value="' . a($t) . '"><div class="ih-btns" style="justify-content:center"><button class="ih-btn" type="submit">Send a new link</button></div><p class="ih-msg" role="status" aria-live="polite"></p></form>';
  } else { $h .= signup(); }
  return $h . '</main>';
}

/* ---------- terryheath.com and lifeonwords.com: host line, related essays and episodes ---------- */

function site_blog_id($key) { $s = get_sites(['path' => $key === 'hub' ? '/' : '/' . $key . '/', 'number' => 1]); return $s ? (int) $s[0]->blog_id : 0; }
function words($s) {
  static $stop = ['the','and','for','that','this','with','from','what','have','your','about','into','their','there','they','were','been','who','how','why','not','but','are','was','you','his','her','its','one','all','can','out','our','has','had','than','then','when','which','will','would','more','some','just'];
  preg_match_all('/[a-z]{4,}/', strtolower(wp_strip_all_tags((string) $s)), $m);
  return array_values(array_diff(array_unique($m[0]), $stop));
}
/** The items of $types on site $key that read most like $post (shared words in title, excerpt and opening), newest first on ties. */
function related_from($post, $key, array $types, $n = 3) {
  $bid = site_blog_id($key); if (!$bid) { return []; }
  $mine = words($post->post_title . ' ' . $post->post_excerpt . ' ' . mb_substr(wp_strip_all_tags($post->post_content), 0, 1500));
  $out = []; $here = get_current_blog_id();
  switch_to_blog($bid);
  foreach (get_posts(['post_type' => $types, 'numberposts' => 60, 'post_status' => 'publish', 'orderby' => 'date', 'order' => 'DESC']) as $q) {
    if ($bid === $here && $q->ID === $post->ID) { continue; }
    $score = count(array_intersect($mine, words($q->post_title . ' ' . $q->post_excerpt . ' ' . mb_substr(wp_strip_all_tags($q->post_content), 0, 1500))));
    $guest = $q->post_type === 'ih_episode' ? get_post((int) get_post_meta($q->ID, 'ih_guest_id', true)) : null;
    $out[] = ['score' => $score, 'title' => get_the_title($q), 'url' => get_permalink($q), 'meta' => $q->post_type === 'ih_episode' ? ($guest ? get_the_title($guest) : 'Episode') : get_the_date('', $q)];
  }
  restore_current_blog();
  usort($out, function ($x, $y) { return $y['score'] <=> $x['score']; });
  return array_slice($out, 0, $n);
}
function related_block($heading, array $items) {
  if (!$items) { return ''; }
  $h = '<section class="ih-related" aria-label="' . a($heading) . '"><h2>' . e($heading) . '</h2><ul class="ih-list">';
  foreach ($items as $it) { $h .= '<li><a href="' . a($it['url']) . '"><span class="ih-pt">' . e($it['title']) . '</span><span class="ih-pa">' . e($it['meta']) . '</span></a></li>'; }
  return $h . '</ul></section>';
}
function host_line() {
  return '<p class="ih-host">Hosted by <a href="' . a(pub_url('terryheath', 'about/')) . '">Terry Heath</a></p>';
}
