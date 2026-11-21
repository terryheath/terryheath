<?php
/* Plugin Name: Inkhorn boot (network-wide settings that must always be on) */
add_filter('xmlrpc_enabled', '__return_false');

/* Uploads: 64 MB on every site, and large photos are scaled down on upload (2560 px on the long side) so a phone or camera original does not fill the library. */
add_filter('pre_site_option_fileupload_maxk', function () { return 65536; });   // network setting, in KB
add_filter('big_image_size_threshold', function () { return 2560; });
add_filter('upload_size_limit', function ($size) { return max($size, 64 * 1024 * 1024); }, 20);
add_filter('wp_image_editors', function ($e) { return $e; });
