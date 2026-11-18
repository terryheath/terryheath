<?php
namespace Inkhorn;

add_action('init', function () {
  $kind = site()['kind'];
  $common = ['public' => true, 'show_in_rest' => true, 'has_archive' => false, 'supports' => ['title', 'editor', 'thumbnail', 'excerpt', 'custom-fields', 'page-attributes']];

  // every type is registered on every site (the importer writes across the network); only the right sites show them in the admin menu
  $ui = function (array $kinds) use ($kind) { return in_array($kind, $kinds, true); };
  {
    register_post_type('ih_issue', $common + [
      'labels' => ['name' => 'Issues', 'singular_name' => 'Issue'], 'show_ui' => $ui(['hub', 'publication']),
      'rewrite' => ['slug' => 'issues', 'with_front' => false], 'has_archive' => 'issues',
    ]);
    register_post_type('ih_piece', $common + [
      'labels' => ['name' => 'Pieces', 'singular_name' => 'Piece'], 'show_ui' => $ui(['hub', 'publication']),
      'rewrite' => ['slug' => 'work', 'with_front' => false],
    ]);
    register_taxonomy('ih_genre', 'ih_piece', ['label' => 'Genre', 'public' => true, 'hierarchical' => false, 'show_in_rest' => true, 'rewrite' => ['slug' => 'genre', 'with_front' => false]]);
    // poems keep their exact line and stanza breaks: views print piece content as stored (no wpautop)
  }
  {
    register_post_type('ih_contributor', $common + [ 'show_ui' => $ui(['hub']),
      'labels' => ['name' => 'Contributors', 'singular_name' => 'Contributor'],
      'rewrite' => ['slug' => 'contributors', 'with_front' => false], 'has_archive' => 'contributors',
    ]);
  }
  {
    register_post_type('ih_book', $common + ['show_ui' => $ui(['author']),'labels' => ['name' => 'Books', 'singular_name' => 'Book'], 'rewrite' => ['slug' => 'books', 'with_front' => false], 'has_archive' => 'books']);
  }
  {
    register_post_type('ih_episode', $common + ['show_ui' => $ui(['podcast']),'labels' => ['name' => 'Episodes', 'singular_name' => 'Episode'], 'rewrite' => ['slug' => 'episodes', 'with_front' => false], 'has_archive' => 'episodes']);
    register_post_type('ih_guest', $common + ['show_ui' => $ui(['podcast']),'labels' => ['name' => 'Guests', 'singular_name' => 'Guest'], 'rewrite' => ['slug' => 'guests', 'with_front' => false], 'has_archive' => 'guests']);
  }

  // fields (all plain post meta, exposed to the REST API so import scripts can set them)
  $meta = [
    'ih_issue' => ['ih_label' => 'string', 'ih_note' => 'string', 'ih_release' => 'string', 'ih_shop_url' => 'string', 'ih_current' => 'boolean'],
    'ih_piece' => ['ih_issue_id' => 'integer', 'ih_position' => 'integer', 'ih_author_name' => 'string', 'ih_contributors' => 'string', 'ih_bio' => 'string', 'ih_nomination' => 'string', 'ih_online_only' => 'boolean'],
    'ih_contributor' => ['ih_bio' => 'string', 'ih_url' => 'string', 'ih_headshot_id' => 'integer', 'ih_email' => 'string', 'ih_names' => 'string'],
    'ih_book' => ['ih_buy_url' => 'string', 'ih_year' => 'string', 'ih_blurb' => 'string'],
    'ih_episode' => ['ih_guest_id' => 'integer', 'ih_audio_url' => 'string', 'ih_guid' => 'string', 'ih_number' => 'integer', 'ih_duration' => 'string'],
    'ih_guest' => ['ih_bio' => 'string', 'ih_url' => 'string', 'ih_headshot_id' => 'integer'],
  ];
  foreach ($meta as $type => $fields) {
    foreach ($fields as $k => $t) {
      register_post_meta($type, $k, ['type' => $t, 'single' => true, 'show_in_rest' => true, 'auth_callback' => function () { return current_user_can('edit_posts'); }]);
    }
  }
});
