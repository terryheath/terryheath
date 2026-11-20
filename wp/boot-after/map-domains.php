<?php
/**
 * Boot task: give each site its own domain. Off until the environment variable IH_MAP_DOMAINS is set, e.g.
 *   IH_MAP_DOMAINS="whiterabbit=whiterabbitreview.com review=inkhornreview.com terryheath=terryheath.com lifeonwords=lifeonwords.com"
 * Every site lives on its own root domain; inkhorn.press is the press hub only. A site is mapped when its DNS points at this service and the
 * domain is added to the Railway service (so the certificate exists); until then leave it out. Idempotent: running it again changes nothing.
 */
$spec = trim((string) getenv('IH_MAP_DOMAINS'));
if ($spec === '' || !is_multisite()) { return; }
foreach (preg_split('/\s+/', $spec) as $pair) {
  if (strpos($pair, '=') === false) { continue; }
  list($key, $domain) = explode('=', $pair, 2);
  foreach (get_sites(['number' => 100]) as $s) {
    $path = trim($s->path, '/');
    if (!(($key === 'hub' && $path === '') || $path === $key || $s->domain === $domain)) { continue; }
    if ($s->domain === $domain && $s->path === '/') { echo "[inkhorn] map: $key already on $domain\n"; continue 2; }
    update_blog_details($s->blog_id, ['domain' => $domain, 'path' => '/']);
    switch_to_blog($s->blog_id);
    update_option('siteurl', 'https://' . $domain); update_option('home', 'https://' . $domain);
    restore_current_blog();
    echo "[inkhorn] map: $key -> $domain\n"; continue 2;
  }
}
