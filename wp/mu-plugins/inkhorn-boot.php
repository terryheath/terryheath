<?php
/* Plugin Name: Inkhorn boot (network-wide settings that must always be on) */
add_filter('xmlrpc_enabled', '__return_false');
