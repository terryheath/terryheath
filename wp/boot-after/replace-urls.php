<?php
/** Boot task: IH_REPLACE_URLS="old=new old2=new2" rewrites addresses stored in content, metadata and options of every site (service addresses that moved to their own names). Idempotent. */
$spec = trim((string) getenv('IH_REPLACE_URLS'));
if ($spec === '' || !is_multisite()) { return; }
foreach (preg_split('/\s+/', $spec) as $pair) {
  if (strpos($pair, '=') === false) { continue; }
  list($old, $new) = explode('=', $pair, 2);
  ob_start();
  try { \WP_CLI::runcommand('search-replace ' . escapeshellarg($old) . ' ' . escapeshellarg($new) . ' --network --skip-columns=guid --report-changed-only --precise --quiet', ['return' => false, 'launch' => false, 'exit_error' => false]); } catch (\Throwable $e) { echo 'ERR ' . $e->getMessage(); }
  echo '[inkhorn] urls: ' . $old . ' -> ' . $new . ' ' . trim(ob_get_clean()) . "\n";
}
