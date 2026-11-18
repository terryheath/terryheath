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
if (file_exists(__DIR__ . '/wp-content/uploads/.multisite')) {
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
  dbphp() { php -r '$h=explode(":",getenv("WORDPRESS_DB_HOST"));$c=@mysqli_connect($h[0],getenv("WORDPRESS_DB_USER"),getenv("WORDPRESS_DB_PASSWORD"),getenv("WORDPRESS_DB_NAME"),(int)$h[1]);if(!$c)exit(2);if($argv[1]??false){$r=mysqli_query($c,$argv[1]);exit($r&&mysqli_num_rows($r)>0?0:1);}exit(0);' "$1"; }
  for i in $(seq 1 90); do [ -f /var/www/html/wp-config.php ] && dbphp && break; sleep 2; done
  cd /var/www/html
  echo "[inkhorn] network bootstrap starting"
  if dbphp "SHOW TABLES LIKE 'wp_blogs'"; then echo "[inkhorn] wp_blogs present"; else echo "[inkhorn] wp_blogs missing"; fi
  dbphp "SHOW TABLES" && echo "[inkhorn] db has tables"
  cat > /var/www/html/.htaccess <<'HT'
RewriteEngine On
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
RewriteBase /
RewriteRule ^index\.php$ - [L]
RewriteRule ^([_0-9a-zA-Z-]+/)?wp-admin$ $1wp-admin/ [R=301,L]
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]
RewriteRule ^([_0-9a-zA-Z-]+/)?(wp-(content|admin|includes).*) $2 [L]
RewriteRule ^([_0-9a-zA-Z-]+/)?(.*\.php)$ $2 [L]
RewriteRule . index.php [L]
HT
  chown www-data:www-data /var/www/html/.htaccess
  # the .multisite flag lives in the container, so recreate it on every boot when the network tables already exist
  if dbphp "SHOW TABLES LIKE 'wp_blogs'"; then
    touch /var/www/html/wp-content/uploads/.multisite; chown www-data:www-data /var/www/html/wp-content/uploads/.multisite
  fi
  ls -la /var/www/html/wp-content/uploads/ | sed 's/^/[inkhorn] ls /' 
  grep -n "multisite" /var/www/html/wp-config.php | head -5 | sed 's/^/[inkhorn] cfg /'
  wp eval 'var_dump(defined("MULTISITE"), is_multisite(), defined("DOMAIN_CURRENT_SITE"));' --allow-root 2>&1 | sed 's/^/[inkhorn] eval /'
  if ! wp core is-installed --allow-root 2>/dev/null; then
    wp core multisite-install --allow-root --url="https://${WP_DOMAIN}" --title="Inkhorn Press" \
      --admin_user="${WP_ADMIN_USER:-terry}" --admin_password="${WP_ADMIN_PASSWORD}" --admin_email="${WP_ADMIN_EMAIL:-hello@inkhorn.press}" \
      --skip-email --skip-config || true
    touch /var/www/html/wp-content/uploads/.multisite
    chown www-data:www-data /var/www/html/wp-content/uploads/.multisite
  fi
  # the network's sites (idempotent): press hub is site 1; the rest are subdirectory sites; terryheath and lifeonwords get mapped domains at cutover
  if [ -f /var/www/html/wp-content/uploads/.multisite ]; then
    for spec in "review:Inkhorn Review" "whiterabbit:White Rabbit" "muse:Muse" "terryheath:Terry Heath" "lifeonwords:Life on Words"; do
      slug="${spec%%:*}"; title="${spec#*:}"
      wp site list --allow-root --field=path 2>/dev/null | grep -qx "/${slug}/" || wp site create --allow-root --slug="$slug" --title="$title" --email="${WP_ADMIN_EMAIL:-hello@inkhorn.press}" || true
    done
    wp theme enable inkhorn --network --allow-root || true
    wp theme activate inkhorn --allow-root || true
  fi
) &
exec docker-entrypoint.sh "$@"
