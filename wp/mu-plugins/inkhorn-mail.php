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
});
add_filter('wp_mail_from', function () { return getenv('MAIL_FROM_ADDRESS') ?: 'hello@inkhorn.press'; });
add_filter('wp_mail_from_name', function () { return getenv('MAIL_FROM_NAME') ?: 'Inkhorn Press'; });
