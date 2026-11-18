#!/bin/bash
# Inkhorn network: WordPress Multisite (subdirectory install) on Railway.
# Env: WP_DOMAIN (host the network lives on; a Railway address while testing, inkhorn.press at cutover),
#      WORDPRESS_DB_* (from the MySQL service), WP_ADMIN_USER / WP_ADMIN_PASSWORD / WP_ADMIN_EMAIL.
set -e
: "${WP_DOMAIN:?WP_DOMAIN is required}"
export WORDPRESS_CONFIG_EXTRA="
if (isset(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') { \$_SERVER['HTTPS'] = 'on'; }
define('WP_ALLOW_MULTISITE', true);
define('DISALLOW_FILE_EDIT', true);
define('WP_DEFAULT_THEME', 'inkhorn');
if (file_exists(__DIR__ . '/.multisite')) {
  define('MULTISITE', true);
  define('SUBDOMAIN_INSTALL', false);
  define('DOMAIN_CURRENT_SITE', '${WP_DOMAIN}');
  define('PATH_CURRENT_SITE', '/');
  define('SITE_ID_CURRENT_SITE', 1);
  define('BLOG_ID_CURRENT_SITE', 1);
}
"
(
  # wait for wp-config.php (written by the stock entrypoint) and the database, then install once
  for i in $(seq 1 90); do [ -f /var/www/html/wp-config.php ] && mysqladmin ping -h"${WORDPRESS_DB_HOST%%:*}" -P"${WORDPRESS_DB_HOST##*:}" -u"$WORDPRESS_DB_USER" -p"$WORDPRESS_DB_PASSWORD" --silent 2>/dev/null && break; sleep 2; done
  cd /var/www/html
  if ! wp core is-installed --allow-root 2>/dev/null; then
    wp core multisite-install --allow-root --url="https://${WP_DOMAIN}" --title="Inkhorn Press" \
      --admin_user="${WP_ADMIN_USER:-terry}" --admin_password="${WP_ADMIN_PASSWORD}" --admin_email="${WP_ADMIN_EMAIL:-hello@inkhorn.press}" \
      --skip-email --skip-config || true
    touch /var/www/html/.multisite
    chown www-data:www-data /var/www/html/.multisite
  fi
) &
exec docker-entrypoint.sh "$@"
