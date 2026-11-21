<?php
/**
 * Boot task: give each site its own domain and rewrite the old temporary address everywhere. Off until IH_MAP_DOMAINS is set, e.g.
 *   IH_MAP_DOMAINS="hub=inkhorn.press review=inkhornreview.com whiterabbit=whiterabbitreview.com terryheath=terryheath.com lifeonwords=lifeonwords.com"
 *   IH_OLD_HOST=wordpress-production-754b3e08.up.railway.app      (the temporary address being retired)
 * Every site lives on its own root domain; inkhorn.press is the press hub only (the muse site stays at inkhorn.press/muse and redirects to gomuse.io).
 * Idempotent: a site already on its domain is left alone, and the search-replace finds nothing the second time.
 */
$spec = trim((string) getenv('IH_MAP_DOMAINS')); $old = trim((string) getenv('IH_OLD_HOST'));
if ($spec === '' || !is_multisite()) { return; }
global $wpdb;
$map = [];
foreach (preg_split('/\s+/', $spec) as $pair) { if (strpos($pair, '=') !== false) { list($k, $d) = explode('=', $pair, 2); $map[$k] = $d; } }
$hub = $map['hub'] ?? '';
$before = [];
foreach (get_sites(['number' => 100]) as $s) { $before[trim($s->path, '/') ?: 'hub'] = $s; }
// 1. the network itself and the hub
if ($hub) {
  $wpdb->update($wpdb->site, ['domain' => $hub], ['id' => 1]);
  $wpdb->update($wpdb->sitemeta, ['meta_value' => $hub], ['meta_key' => 'site_url_dummy']); // no-op guard
  update_network_option(1, 'siteurl', 'https://' . $hub . '/');
}
$oldUrl = $old ? 'https://' . $old : '';
$pairs = []; // [old prefix, new prefix], longest first
foreach (['review', 'whiterabbit', 'terryheath', 'lifeonwords'] as $key) { if (!empty($map[$key]) && $oldUrl) { $pairs[] = [$oldUrl . '/' . $key, 'https://' . $map[$key]]; } }
if ($oldUrl && $hub) { $pairs[] = [$oldUrl . '/muse', 'https://' . $hub . '/muse']; $pairs[] = [$oldUrl, 'https://' . $hub]; }
// 2. each site: domain, path, siteurl, home
foreach ($map as $key => $domain) {
  $s = $before[$key] ?? null; if (!$s) { continue; }
  if ($s->domain === $domain && $s->path === '/') {
    switch_to_blog($s->blog_id);
    foreach (['siteurl', 'home'] as $opt) { if (get_option($opt) !== 'https://' . $domain) { echo "[inkhorn] map: $key $opt " . get_option($opt) . " -> https://$domain\n"; update_option($opt, 'https://' . $domain); } }
    restore_current_blog();
    echo "[inkhorn] map: $key already on $domain\n"; continue;
  }
  update_blog_details($s->blog_id, ['domain' => $domain, 'path' => '/']);
  switch_to_blog($s->blog_id); update_option('siteurl', 'https://' . $domain); update_option('home', 'https://' . $domain); restore_current_blog();
  echo "[inkhorn] map: $key -> $domain\n";
}
if (!empty($before['muse']) && $hub) { $m = $before['muse']; if ($m->domain !== $hub) { update_blog_details($m->blog_id, ['domain' => $hub]); switch_to_blog($m->blog_id); update_option('siteurl', 'https://' . $hub . '/muse'); update_option('home', 'https://' . $hub . '/muse'); restore_current_blog(); echo "[inkhorn] map: muse -> $hub/muse\n"; } }
// 3. the old temporary address inside content, metadata and options of every site
foreach ($pairs as $p) {
  ob_start();
  try { \WP_CLI::runcommand('search-replace ' . escapeshellarg($p[0]) . ' ' . escapeshellarg($p[1]) . ' --network --skip-columns=guid --report-changed-only --precise --quiet', ['return' => false, 'launch' => false, 'exit_error' => false]); } catch (\Throwable $e) { echo 'ERR ' . $e->getMessage(); }
  $out = trim(ob_get_clean());
  echo '[inkhorn] replace ' . $p[0] . ' -> ' . $p[1] . ($out ? ': ' . $out : '') . "\n";
}
// rewrite rules are flushed per site by the entrypoint (each site needs its own process: its rules depend on its host)
