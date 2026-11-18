<?php
/**
 * Plugin Name: Inkhorn network
 * Description: Content types, shared data, views and signup for the Inkhorn Press network (Issue, Piece, Contributor, Book, Episode, Guest).
 * Network: true
 * Version: 0.1.0
 */
namespace Inkhorn;

if (!defined('ABSPATH')) { exit; }
define('INKHORN_DIR', __DIR__);
define('INKHORN_URL', plugins_url('', __FILE__));

require_once __DIR__ . '/includes/sites.php';
require_once __DIR__ . '/includes/content-types.php';
require_once __DIR__ . '/includes/views.php';
require_once __DIR__ . '/includes/blocks.php';
require_once __DIR__ . '/includes/subscribe.php';
require_once __DIR__ . '/includes/import.php';
require_once __DIR__ . '/includes/account.php';
require_once __DIR__ . '/includes/shop.php';
require_once __DIR__ . '/includes/feed.php';
require_once __DIR__ . '/includes/store.php';
