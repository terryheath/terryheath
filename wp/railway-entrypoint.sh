#!/bin/bash
# Inkhorn network: WordPress Multisite (subdirectory install) on Railway.
# Env: WP_DOMAIN (host the network lives on; a Railway address while testing, inkhorn.press at cutover),
#      WORDPRESS_DB_* (from the MySQL service), WP_ADMIN_USER / WP_ADMIN_PASSWORD / WP_ADMIN_EMAIL.
set -e
# Apache must have exactly one MPM (prefork, which mod_php needs)
rm -f /etc/apache2/mods-enabled/mpm_event.* /etc/apache2/mods-enabled/mpm_worker.*
ln -sf /etc/apache2/mods-available/mpm_prefork.load /etc/apache2/mods-enabled/mpm_prefork.load
ln -sf /etc/apache2/mods-available/mpm_prefork.conf /etc/apache2/mods-enabled/mpm_prefork.conf
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
  # the .multisite flag lives in the container, so recreate it on every boot when the network tables already exist
  if mysql -h"${WORDPRESS_DB_HOST%%:*}" -P"${WORDPRESS_DB_HOST##*:}" -u"$WORDPRESS_DB_USER" -p"$WORDPRESS_DB_PASSWORD" "$WORDPRESS_DB_NAME" -N -e "SHOW TABLES LIKE 'wp_blogs'" 2>/dev/null | grep -q wp_blogs; then
    touch /var/www/html/.multisite; chown www-data:www-data /var/www/html/.multisite
  fi
  if ! wp core is-installed --allow-root 2>/dev/null; then
    wp core multisite-install --allow-root --url="https://${WP_DOMAIN}" --title="Inkhorn Press" \
      --admin_user="${WP_ADMIN_USER:-terry}" --admin_password="${WP_ADMIN_PASSWORD}" --admin_email="${WP_ADMIN_EMAIL:-hello@inkhorn.press}" \
      --skip-email --skip-config || true
    touch /var/www/html/.multisite
    chown www-data:www-data /var/www/html/.multisite
  fi
  # the network's sites (idempotent): press hub is site 1; the rest are subdirectory sites; terryheath and lifeonwords get mapped domains at cutover
  if [ -f /var/www/html/.multisite ]; then
    for spec in "review:Inkhorn Review" "whiterabbit:White Rabbit" "muse:Muse" "terryheath:Terry Heath" "lifeonwords:Life on Words"; do
      slug="${spec%%:*}"; title="${spec#*:}"
      wp site list --allow-root --field=path 2>/dev/null | grep -qx "/${slug}/" || wp site create --allow-root --slug="$slug" --title="$title" --email="${WP_ADMIN_EMAIL:-hello@inkhorn.press}" || true
    done
    wp theme enable inkhorn --network --allow-root || true
    wp theme activate inkhorn --allow-root || true
  fi
) &
exec docker-entrypoint.sh "$@"
