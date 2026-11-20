FROM wordpress:6-php8.3-apache
RUN apt-get update && apt-get install -y --no-install-recommends less default-mysql-client unzip curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp \
 && chmod +x /usr/local/bin/wp
RUN a2dismod -f mpm_event mpm_worker >/dev/null 2>&1 || true; a2enmod mpm_prefork >/dev/null 2>&1 || true
COPY mu-plugins/ /usr/src/wordpress/wp-content/mu-plugins/
COPY themes/ /usr/src/wordpress/wp-content/themes/
COPY plugins/ /usr/src/wordpress/wp-content/plugins/
COPY boot/ /usr/local/share/inkhorn-boot/
COPY boot-after/ /usr/local/share/inkhorn-boot-after/
COPY railway-entrypoint.sh /usr/local/bin/railway-entrypoint.sh
RUN chmod +x /usr/local/bin/railway-entrypoint.sh
ENTRYPOINT ["railway-entrypoint.sh"]
CMD ["apache2-foreground"]
