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
    // Muse is a Follow the Rabbit LLC publication at gomuse.io. This WordPress site exists only to 301 old /muse/ addresses there; it is in no nav, list, search or footer.
    'muse' => ['name' => 'Muse', 'short' => 'Muse', 'accent' => '#5D6F86', 'tint' => '#EEF1F5', 'bar' => false, 'kind' => 'publication', 'submit' => 'https://gomuse.io', 'lists' => []],
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
/** Address of a sibling publication. */
function pub_url($key, $path = '') {
  if ($key === 'muse') { return 'https://gomuse.io/' . ltrim($path, '/'); }
  $s = get_sites(['path' => $key === 'hub' ? '/' : '/' . $key . '/', 'number' => 1]);
  if (!$s) { return hub_url($key); }
  return get_site_url($s[0]->blog_id, '/' . ltrim($path, '/'));
}

/** Each site sends its own mail from its own domain (SES identities for all five). */
function mail_from_for_site() {
  $m = ['hub' => 'Inkhorn Press <hello@inkhorn.press>', 'review' => 'Inkhorn Review <hello@inkhornreview.com>', 'whiterabbit' => 'White Rabbit <hello@whiterabbitreview.com>', 'terryheath' => 'Terry Heath <hello@terryheath.com>', 'lifeonwords' => 'Life on Words <hello@lifeonwords.com>'];
  // White Rabbit sends from its own domain once SES has verified it (IH_SES_WR=1 on the wordpress service); until then its mail goes from the press address
  if (site_key() === 'whiterabbit' && getenv('IH_SES_WR') !== '1') { return $m['hub']; }
  return $m[site_key()] ?? $m['hub'];
}
