<?php
namespace Inkhorn;

/** The network's sites: look, name, signup lists, outside links. */
function sites() {
  return [
    'hub' => ['name' => 'Inkhorn Press', 'short' => 'Inkhorn Press', 'accent' => '#0A2454', 'tint' => '#E9EDF5', 'bar' => true, 'kind' => 'hub',
      'lists' => ['inkhorn-review', 'white-rabbit', 'events']],
    'review' => ['name' => 'Inkhorn Review', 'short' => 'the Review', 'accent' => '#2E4A3F', 'tint' => '#E9EEEB', 'bar' => true, 'kind' => 'publication',
      'submit' => 'https://duotrope.com/duosuma/submit/inkhorn-review-iGX4p', 'lists' => ['inkhorn-review']],
    'whiterabbit' => ['name' => 'White Rabbit', 'short' => 'White Rabbit', 'accent' => '#4B2346', 'tint' => '#F0E9EF', 'bar' => true, 'kind' => 'publication',
      'submit' => '', 'lists' => ['white-rabbit']],
    'terryheath' => ['name' => 'Terry Heath', 'short' => 'Terry Heath', 'accent' => '#6B1E22', 'tint' => '#F4EAEA', 'bar' => false, 'kind' => 'author',
      'lists' => ['writing', 'digest', 'new-books']],
    'lifeonwords' => ['name' => 'Life on Words', 'short' => 'Life on Words', 'accent' => '#A8361A', 'tint' => '#F7ECE8', 'bar' => false, 'kind' => 'podcast',
      'lists' => ['life-on-words']],
  ];
}

/** Which site of the network is this request on? */
function site_key() {
  static $key = null;
  if ($key !== null) { return $key; }
  $host = (string) wp_parse_url(home_url(), PHP_URL_HOST);
  if (strpos($host, 'terryheath.com') !== false) { return $key = 'terryheath'; }
  if (strpos($host, 'lifeonwords.com') !== false) { return $key = 'lifeonwords'; }
  if (strpos($host, 'inkhornreview.com') !== false) { return $key = 'review'; }
  if (strpos($host, 'whiterabbitreview.com') !== false) { return $key = 'whiterabbit'; }
  $path = trim((string) wp_parse_url(home_url(), PHP_URL_PATH), '/');
  $all = sites();
  return $key = isset($all[$path]) ? $path : 'hub';
}
function site() { return sites()[site_key()]; }

/** The hub's address (every cross-site link to hub pages starts here). */
function hub_url($path = '') {
  switch_to_blog(get_main_site_id());
  $u = home_url('/' . ltrim($path, '/'));
  restore_current_blog();
  return $u;
}
/** Blog id of a site of the network by its key. Every site is on its own domain (path /), */
function site_blog_id($key) {
  static $cache = [];
  if (isset($cache[$key])) { return $cache[$key]; }
  $domains = ['review' => 'inkhornreview.com', 'whiterabbit' => 'whiterabbitreview.com', 'terryheath' => 'terryheath.com', 'lifeonwords' => 'lifeonwords.com'];
  $id = 0;
  if ($key === 'hub') { $id = (int) get_main_site_id(); }
  else {
    if (isset($domains[$key])) { $r = get_sites(['domain' => $domains[$key], 'number' => 1]); if ($r) { $id = (int) $r[0]->blog_id; } }
    if (!$id) { $r = get_sites(['path' => '/' . $key . '/', 'number' => 1]); $id = $r ? (int) $r[0]->blog_id : 0; } // the temporary folder layout
  }
  return $cache[$key] = $id;
}
/** Address of a sibling publication. */
function pub_url($key, $path = '') {
  $b = site_blog_id($key);
  if (!$b) { return hub_url($key); }
  return get_site_url($b, '/' . ltrim($path, '/'));
}

/** Each site sends its own mail from its own domain (SES identities for all five). */
function mail_from_for_site() {
  $m = ['hub' => 'Inkhorn Press <hello@inkhorn.press>', 'review' => 'Inkhorn Review <hello@inkhornreview.com>', 'whiterabbit' => 'White Rabbit <hello@whiterabbitreview.com>', 'terryheath' => 'Terry Heath <hello@terryheath.com>', 'lifeonwords' => 'Life on Words <hello@lifeonwords.com>'];
  // A site sends from its own domain only when its domain is listed in IH_MAIL_OWN (space-separated site keys on the wordpress service): the SES identity must be verified and the mail user's IAM policy must allow it. Others send from the press address.
  $own = preg_split('/\s+/', trim((string) (getenv('IH_MAIL_OWN') !== false && getenv('IH_MAIL_OWN') !== '' ? getenv('IH_MAIL_OWN') : 'hub terryheath')));
  if (!in_array(site_key(), $own, true)) { return $m['hub']; }
  return $m[site_key()] ?? $m['hub'];
}
