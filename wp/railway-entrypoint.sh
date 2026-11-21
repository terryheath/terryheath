#!/bin/bash
# Inkhorn network: WordPress Multisite (subdirectory install) on Railway.
# Env: WP_DOMAIN (host the network lives on; a Railway address while testing, inkhorn.press at cutover),
#      WORDPRESS_DB_* (from the MySQL service), WP_ADMIN_USER / WP_ADMIN_PASSWORD / WP_ADMIN_EMAIL.
set -e
# the uploads volume is mounted root-owned: let Apache's user write to it
mkdir -p /var/www/html/wp-content/uploads && chown -R www-data:www-data /var/www/html/wp-content/uploads
# Apache must have exactly one MPM (prefork, which mod_php needs)
rm -f /etc/apache2/mods-enabled/mpm_event.* /etc/apache2/mods-enabled/mpm_worker.*
ln -sf /etc/apache2/mods-available/mpm_prefork.load /etc/apache2/mods-enabled/mpm_prefork.load
ln -sf /etc/apache2/mods-available/mpm_prefork.conf /etc/apache2/mods-enabled/mpm_prefork.conf
: "${WP_DOMAIN:?WP_DOMAIN is required}"
export WORDPRESS_CONFIG_EXTRA="
if (isset(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') { \$_SERVER['HTTPS'] = 'on'; }
define('WP_ALLOW_MULTISITE', true);
define('FS_METHOD', 'direct');
define('WP_MEMORY_LIMIT', '256M');
define('WP_MAX_MEMORY_LIMIT', '512M');
define('WP_AUTO_UPDATE_CORE', 'minor');
define('WP_DEFAULT_THEME', 'inkhorn');
if (file_exists('/var/www/html/wp-content/uploads/.multisite')) {
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
# folder paths that a root domain replaced answer with a plain 404 (the Muse folder, /muse/, stays)
RewriteCond %{HTTP_HOST} ^(www\.)?inkhorn\.press$ [NC]
RewriteRule ^(review|whiterabbit|terryheath|lifeonwords)(/|$) - [R=404,L]
RewriteCond %{HTTP_HOST} ^(www\.)?terryheath\.com$ [NC]
RewriteCond %{REQUEST_URI} !^/podcast/guests/?$
RewriteRule ^(podcast|lifeonwords)(/|$) - [R=404,L]
RewriteCond %{HTTP_HOST} ^(www\.)?lifeonwords\.com$ [NC]
RewriteRule ^podcast(/|$) - [R=404,L]
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
      # a site mapped to its own domain (IH_MAP_DOMAINS) lives at / on that domain: it is never recreated at a folder path
      mapped=$(printf '%s\n' ${IH_MAP_DOMAINS:-} | sed -n "s/^${slug}=//p")
      if [ -n "$mapped" ] && wp site list --allow-root --field=domain 2>/dev/null | grep -qx "$mapped"; then continue; fi
      wp site list --allow-root --field=path 2>/dev/null | grep -qx "/${slug}/" || wp site create --allow-root --slug="$slug" --title="$title" --email="${WP_ADMIN_EMAIL:-hello@inkhorn.press}" || true
    done
    wp plugin activate inkhorn-network --network --allow-root || true
    wp theme enable inkhorn --network --allow-root || true
    for url in $(wp site list --allow-root --field=url); do
      wp theme activate inkhorn --url="$url" --allow-root || true
      wp option update permalink_structure '/%postname%/' --url="$url" --allow-root || true
      wp rewrite flush --hard --url="$url" --allow-root || true
    done
  fi
  # ---- plugins, themes and languages live on the volume, so anything installed or updated from the dashboard survives a redeploy.
  # Our own code (the inkhorn-network plugin and the inkhorn theme) is copied from the image on every boot; everything else on the volume is left alone.
  IMG=/usr/src/wordpress/wp-content; WC=/var/www/html/wp-content; P=$WC/uploads/.persist
  mkdir -p "$P/plugins" "$P/themes" "$P/languages"
  for d in plugins themes languages; do
    if [ ! -f "$P/$d/.seeded" ]; then [ -d "$IMG/$d" ] && cp -a "$IMG/$d/." "$P/$d/"; touch "$P/$d/.seeded"; fi
  done
  rm -rf "$P/plugins/inkhorn-network" "$P/themes/inkhorn"
  cp -a "$IMG/plugins/inkhorn-network" "$P/plugins/inkhorn-network"; cp -a "$IMG/themes/inkhorn" "$P/themes/inkhorn"
  printf "Require all denied\n" > "$P/.htaccess"   # the volume folder is not a public address; the same files are served at /wp-content/plugins and /wp-content/themes
  chown -R www-data:www-data "$P"
  for d in plugins themes languages; do
    if [ ! -L "$WC/$d" ]; then rm -rf "$WC/$d"; ln -s "$P/$d" "$WC/$d"; fi
  done
  # ---- boot tasks: idempotent PHP files run with WP-CLI on every start (see wp/boot)
  for f in /usr/local/share/inkhorn-boot/*.php; do [ -f "$f" ] && wp eval-file "$f" --allow-root 2>&1 | sed 's/^/[inkhorn] boot: /'; done
  # ---- plugins to keep installed (space-separated wordpress.org slugs in IH_INSTALL_PLUGINS); installed once, network-activated, then managed from the dashboard
  for slug in ${IH_INSTALL_PLUGINS:-}; do
    wp plugin is-installed "$slug" --allow-root || wp plugin install "$slug" --activate-network --allow-root 2>&1 | sed "s/^/[inkhorn] install $slug: /"
    wp plugin is-active "$slug" --network --allow-root || wp plugin activate "$slug" --network --allow-root 2>&1 | sed "s/^/[inkhorn] activate $slug: /"
  done
  # new plugins add rewrite rules (sitemaps): flush them for every site
  for url in $(wp site list --allow-root --field=url); do wp option update permalink_structure '/%postname%/' --url="$url" --allow-root >/dev/null 2>&1 || true; wp rewrite flush --url="$url" --allow-root >/dev/null 2>&1 || true; done
  for f in /usr/local/share/inkhorn-boot-after/*.php; do [ -f "$f" ] && wp eval-file "$f" --allow-root 2>&1 | sed 's/^/[inkhorn] boot: /'; done
  # ---- one-off check that dashboard installs persist (IH_PLUGIN_TEST=install, then redeploy, then =check)
  wp eval 'require_once ABSPATH."wp-admin/includes/file.php"; echo "filesystem method: ".get_filesystem_method(WP_PLUGIN_DIR)." | plugins dir writable: ".(wp_is_writable(WP_PLUGIN_DIR)?"yes":"no")."\n";' --allow-root 2>&1 | sed 's/^/[inkhorn] fs: /'
  case "${IH_PLUGIN_TEST:-}" in
    install) wp plugin install classic-widgets --activate-network --allow-root 2>&1 | sed 's/^/[inkhorn] plugintest: /' ;;
    check) if wp plugin is-installed classic-widgets --allow-root; then echo "[inkhorn] plugintest: classic-widgets SURVIVED the redeploy"; wp plugin is-active classic-widgets --network --allow-root && echo "[inkhorn] plugintest: still network-active"; wp plugin deactivate classic-widgets --network --allow-root 2>&1 | sed 's/^/[inkhorn] plugintest: /'; wp plugin delete classic-widgets --allow-root 2>&1 | sed 's/^/[inkhorn] plugintest: /'; else echo "[inkhorn] plugintest: classic-widgets is GONE"; fi ;;
  esac
  chown -R www-data:www-data "$P"
) &
exec docker-entrypoint.sh "$@"
