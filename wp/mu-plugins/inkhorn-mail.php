<?php
/* Plugin Name: Inkhorn mail (WordPress sends through Amazon SES SMTP when SMTP_HOST is set) */
add_action('phpmailer_init', function ($m) {
  $host = getenv('SMTP_HOST');
  if (!$host) { return; }
  $m->isSMTP();
  $m->Host = $host;
  $m->Port = (int) (getenv('SMTP_PORT') ?: 587);
  $m->SMTPAuth = true;
  $m->Username = getenv('SMTP_USERNAME');
  $m->Password = getenv('SMTP_PASSWORD');
  $m->SMTPSecure = 'tls';
  // whiterabbitreview.com has no inbox of its own yet: replies to its mail go to Terry's address (the other four domains receive mail at hello@ and forward to him)
  if (function_exists('Inkhorn\\site_key') && \Inkhorn\site_key() === 'whiterabbit' && !$m->getReplyToAddresses()) { $m->addReplyTo('hello@terryheath.com', 'Terry Heath'); }
});
// each site sends from its own domain; MAIL_FROM_ADDRESS / MAIL_FROM_NAME override for every site
add_filter('wp_mail_from', function () { if (getenv('MAIL_FROM_ADDRESS')) { return getenv('MAIL_FROM_ADDRESS'); } return function_exists('Inkhorn\\mail_from_for_site') && preg_match('/<([^>]+)>/', \Inkhorn\mail_from_for_site(), $m) ? $m[1] : 'hello@inkhorn.press'; });
add_filter('wp_mail_from_name', function () { if (getenv('MAIL_FROM_NAME')) { return getenv('MAIL_FROM_NAME'); } return function_exists('Inkhorn\\mail_from_for_site') && preg_match('/^([^<]+)</', \Inkhorn\mail_from_for_site(), $m) ? trim($m[1]) : 'Inkhorn Press'; });
// log why a message did not send (goes to the service log)
add_action('wp_mail_failed', function ($err) { error_log('[inkhorn] mail failed: ' . $err->get_error_message()); });
