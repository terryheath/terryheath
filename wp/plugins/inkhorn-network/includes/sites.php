<?php
namespace Inkhorn;

/** The network's sites: look, name, signup lists, outside links. */
function sites() {
  return [
    'hub' => ['name' => 'Inkhorn Press', 'short' => 'Inkhorn Press', 'accent' => '#4F5B66', 'tint' => '#EDEFF1', 'bar' => true, 'kind' => 'hub',
      'lists' => ['inkhorn-review', 'white-rabbit', 'muse', 'events']],
    'review' => ['name' => 'Inkhorn Review', 'short' => 'the Review', 'accent' => '#5E7268', 'tint' => '#EEF1EE', 'bar' => true, 'kind' => 'publication',
      'submit' => 'https://duotrope.com/duosuma/submit/inkhorn-review-iGX4p', 'lists' => ['inkhorn-review']],
    'whiterabbit' => ['name' => 'White Rabbit', 'short' => 'White Rabbit', 'accent' => '#7A6478', 'tint' => '#F1EDF0', 'bar' => true, 'kind' => 'publication',
      'submit' => '', 'lists' => ['white-rabbit']],
    'muse' => ['name' => 'Muse', 'short' => 'Muse', 'accent' => '#5D6F86', 'tint' => '#EEF1F5', 'bar' => true, 'kind' => 'publication',
      'submit' => 'https://gomuse.io', 'lists' => ['muse']],
    'terryheath' => ['name' => 'Terry Heath', 'short' => 'Terry Heath', 'accent' => '#7A664B', 'tint' => '#F3EFE8', 'bar' => false, 'kind' => 'author',
      'lists' => ['writing', 'digest', 'new-books']],
    'lifeonwords' => ['name' => 'Life on Words', 'short' => 'Life on Words', 'accent' => '#4E6E6E', 'tint' => '#EDF2F2', 'bar' => false, 'kind' => 'podcast',
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
/** Address of a sibling publication. */
function pub_url($key, $path = '') {
  // until inkhorn.press/muse is routed to the Muse app, review builds point the Muse links at the app's own address (env MUSE_APP_URL)
  if ($key === 'muse' && getenv('MUSE_APP_URL')) { return rtrim(getenv('MUSE_APP_URL'), '/') . '/' . ltrim($path, '/'); }
  $s = get_sites(['path' => $key === 'hub' ? '/' : '/' . $key . '/', 'number' => 1]);
  if (!$s) { return hub_url($key); }
  return get_site_url($s[0]->blog_id, '/' . ltrim($path, '/'));
}
