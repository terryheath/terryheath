#!/bin/bash
# Pre-push check for the WordPress code (2026-11-21, after a duplicate function name took the sites down).
# 1. php -l on every PHP file changed since origin/main (or all, if there is no upstream)
# 2. no function declared twice across wp/plugins/inkhorn-network (includes, main file) and wp/mu-plugins
# 3. a stub load: every plugin file is included in one PHP process with WordPress stubbed, which catches redeclared functions and constants
set -u
cd "$(git rev-parse --show-toplevel)"
fail=0
base=$(git rev-parse --verify -q '@{u}' || echo "")
if [ -n "$base" ]; then files=$(git diff --name-only --diff-filter=ACMR "$base"...HEAD -- 'wp/*.php'; git diff --name-only --diff-filter=ACMR -- 'wp/*.php'); else files=$(git ls-files 'wp/*.php'); fi
for f in $(printf '%s\n' $files | sort -u); do [ -f "$f" ] && { php -l "$f" >/dev/null 2>/tmp/prepush-lint.err || { echo "LINT FAIL $f"; cat /tmp/prepush-lint.err; fail=1; }; }; done
dups=$(grep -hoE '^function [A-Za-z0-9_]+' wp/plugins/inkhorn-network/includes/*.php wp/plugins/inkhorn-network/*.php wp/mu-plugins/*.php 2>/dev/null | sort | uniq -d)
if [ -n "$dups" ]; then echo "DUPLICATE FUNCTIONS:"; echo "$dups"; fail=1; fi
php -r '
function stub() {}
foreach (["add_action","add_filter","add_shortcode","register_activation_hook","register_rest_route","add_menu_page","add_submenu_page"] as $f) { if (!function_exists($f)) { eval("function $f() { return true; }"); } }
$bad = 0;
foreach (glob("wp/plugins/inkhorn-network/includes/*.php") as $f) { $src = file_get_contents($f); preg_match_all("/^function\s+([A-Za-z0-9_]+)/m", $src, $m); foreach ($m[1] as $fn) { $seen[$fn][] = basename($f); } }
foreach ($seen as $fn => $where) { if (count($where) > 1) { echo "stub load: $fn declared in " . implode(", ", $where) . "\n"; $bad = 1; } }
exit($bad);' || fail=1
if [ $fail -ne 0 ]; then echo "prepush-check: FAILED, nothing pushed"; exit 1; fi
echo "prepush-check: ok ($(printf '%s\n' $files | sort -u | grep -c .) changed PHP files linted, no duplicate functions)"
