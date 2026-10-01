#!/usr/bin/env bash
# cutover.sh — Inkhorn theme cutover and rollback.
#
# Usage:
#   ./cutover.sh            — run the cutover (interactive)
#   ./cutover.sh --rollback — re-activate Dawn and print saved injection text
#
# What it does:
#   1. Downloads current Dawn theme zip to rollback/
#   2. Reads + saves current site Header and Footer injection to rollback/
#   3. Prints the injection inventory so you can copy what to keep
#   4. Uploads the new theme (does NOT activate yet)
#   5. Prompts: "Clear Code Injection now, then press Enter"
#   6. On Enter: activates the new theme immediately
#
# --rollback:
#   Re-activates Dawn (from rollback/dawn.zip) and prints the saved
#   injection text to paste back manually.
set -euo pipefail

GHOST_URL=$(security find-generic-password -s "ghost-url-inkhorn" -w)
ADMIN_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w)
KEY_ID="${ADMIN_KEY%%:*}"
KEY_SECRET="${ADMIN_KEY#*:}"

THEME_NAME="inkhorn"
ZIP_PATH="dist/${THEME_NAME}.zip"
ROLLBACK_DIR="rollback"

build_jwt() {
  local now exp
  now=$(date +%s)
  exp=$((now + 300))
  node -e "
const crypto = require('crypto');
const now = $now, exp = $exp;
const h = Buffer.from(JSON.stringify({alg:'HS256',kid:'${KEY_ID}',typ:'JWT'})).toString('base64url');
const p = Buffer.from(JSON.stringify({iat:now,exp,aud:'/admin/'})).toString('base64url');
const s = crypto.createHmac('sha256',Buffer.from('${KEY_SECRET}','hex')).update(h+'.'+p).digest('base64url');
console.log(h+'.'+p+'.'+s);
"
}

read_injection() {
  # Returns the site settings as JSON from the Admin API
  local jwt="$1"
  curl -s -H "Authorization: Ghost ${jwt}" "${GHOST_URL}/ghost/api/admin/settings/"
}

# ── ROLLBACK MODE ─────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--rollback" ]]; then
  echo "── ROLLBACK ──────────────────────────────────────────────────────────────"
  [[ -f "${ROLLBACK_DIR}/dawn.zip" ]] || { echo "ERROR: ${ROLLBACK_DIR}/dawn.zip not found."; exit 1; }

  JWT=$(build_jwt)
  echo "→ Uploading saved Dawn theme..."
  curl -s -X PUT \
    -H "Authorization: Ghost ${JWT}" \
    -F "file=@${ROLLBACK_DIR}/dawn.zip;type=application/zip" \
    "${GHOST_URL}/ghost/api/admin/themes/upload/" \
    | python3 -m json.tool --no-ensure-ascii 2>/dev/null | grep -E '"name"|"active"' || true

  JWT=$(build_jwt)
  echo "→ Activating Dawn..."
  curl -s -X PUT \
    -H "Authorization: Ghost ${JWT}" \
    -H "Content-Type: application/json" \
    "${GHOST_URL}/ghost/api/admin/themes/dawn/activate/" \
    | python3 -m json.tool --no-ensure-ascii 2>/dev/null | grep -E '"name"|"active"' || true

  echo ""
  echo "✓ Dawn re-activated."
  echo ""
  echo "── PASTE THIS INTO Ghost Admin → Settings → Code injection → Site Header:"
  echo "────────────────────────────────────────────────────────────────────────"
  cat "${ROLLBACK_DIR}/ghost_head.txt"
  echo ""
  echo "── PASTE THIS INTO Ghost Admin → Settings → Code injection → Site Footer:"
  echo "────────────────────────────────────────────────────────────────────────"
  cat "${ROLLBACK_DIR}/ghost_foot.txt"
  echo ""
  exit 0
fi

# ── CUTOVER MODE ──────────────────────────────────────────────────────────────
[[ -f "${ZIP_PATH}" ]] || { echo "ERROR: ${ZIP_PATH} not found — run 'gulp zip' first."; exit 1; }
mkdir -p "${ROLLBACK_DIR}"

JWT=$(build_jwt)

# 1. Download current Dawn theme zip
echo "→ Downloading current Dawn theme zip to ${ROLLBACK_DIR}/dawn.zip..."
DAWN_DL=$(curl -s -w "%{http_code}" -o "${ROLLBACK_DIR}/dawn.zip" \
  -H "Authorization: Ghost ${JWT}" \
  "${GHOST_URL}/ghost/api/admin/themes/dawn/download/")
if [[ "$DAWN_DL" == "200" ]] && [[ -s "${ROLLBACK_DIR}/dawn.zip" ]]; then
  echo "   Saved ($(du -h "${ROLLBACK_DIR}/dawn.zip" | cut -f1))."
else
  echo "   WARN: Download returned HTTP ${DAWN_DL} — Ghost may not expose theme download via API."
  echo "   Save rollback/dawn.zip manually: Ghost Admin → Design → Themes → Download."
  rm -f "${ROLLBACK_DIR}/dawn.zip"
fi

# 2. Save current injection to rollback files (read via Admin API)
JWT=$(build_jwt)
echo "→ Reading current site code injection..."
SETTINGS_JSON=$(read_injection "$JWT")
node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const s = d.settings || [];
const head = s.find(x=>x.key==='codeinjection_head')?.value || '';
const foot = s.find(x=>x.key==='codeinjection_foot')?.value || '';
require('fs').writeFileSync('${ROLLBACK_DIR}/ghost_head.txt', head);
require('fs').writeFileSync('${ROLLBACK_DIR}/ghost_foot.txt', foot);
console.log('Site Header saved (' + head.length + ' chars) → ${ROLLBACK_DIR}/ghost_head.txt');
console.log('Site Footer saved (' + foot.length + ' chars) → ${ROLLBACK_DIR}/ghost_foot.txt');
" <<< "$SETTINGS_JSON"

# 3. Print injection inventory
echo ""
echo "── INJECTION INVENTORY ──────────────────────────────────────────────────"
echo ""
echo "SITE HEADER (${ROLLBACK_DIR}/ghost_head.txt) — what it contains:"
echo "  • Google Fonts preconnect + stylesheet (EB Garamond, Libre Franklin)"
echo "    THEME REPLACES: theme CSS already imports these fonts — remove"
echo "  • All Inkhorn CSS (~700 lines): base, masthead, home page, archive,"
echo "    contributor shelf, responsive, etc."
echo "    THEME REPLACES: all of this → CLEAR the Site Header entirely"
echo ""
echo "SITE FOOTER (${ROLLBACK_DIR}/ghost_foot.txt) — what it contains:"
echo "  • SHELVES_URL / ATTRIBUTIONS_URL fetches"
echo "    THEME REPLACES: server-side via tag codeinjection_head → REMOVE"
echo "  • PRINT_META array (home hero, buy link, contents)"
echo "    THEME REPLACES: #catalog page JSON + home.hbs → REMOVE"
echo "  • EBOOK_LINKS                     REMOVE (no ebook links, per Terry's decision)"
echo "  • injectMasthead() / injectFooter()   THEME REPLACES: theme templates → REMOVE"
echo "  • buildHomePage()                     THEME REPLACES: home.hbs → REMOVE"
echo "  • buildPrintCatalogPage()             THEME REPLACES: page-print.hbs → REMOVE"
echo "  • Contributor shelf logic             THEME REPLACES: build-shelves.cjs → REMOVE"
echo "  • Portal links (Sign in/up/Subscribe) THEME REPLACES: subscribe-block partial → REMOVE"
echo "  • maybeShowAddressBanner()            THEME REPLACES: assets/js/lib/address-banner.js → REMOVE"
echo ""
echo "WHAT TO LEAVE IN EACH FIELD AFTER CUTOVER:"
echo "  Site Header: EMPTY (clear completely)"
echo "  Site Footer: EMPTY (clear completely)"
echo ""
echo "── END INVENTORY ────────────────────────────────────────────────────────"
echo ""

# 4. Upload new theme (no activation yet)
JWT=$(build_jwt)
echo "→ Uploading new theme (not activating yet)..."
UPLOAD_RESP=$(curl -s -X PUT \
  -H "Authorization: Ghost ${JWT}" \
  -F "file=@${ZIP_PATH};type=application/zip" \
  "${GHOST_URL}/ghost/api/admin/themes/upload/")
echo "$UPLOAD_RESP" | python3 -m json.tool --no-ensure-ascii 2>/dev/null \
  | grep -E '"name"|"active"|"errors"' || echo "$UPLOAD_RESP"

echo ""
echo "────────────────────────────────────────────────────────────────────────"
echo "ACTION REQUIRED:"
echo ""
echo "  Go to Ghost Admin → Settings → Code injection"
echo "  • Site Header: CLEAR everything"
echo "  • Site Footer: CLEAR everything"
echo "  Save."
echo ""
read -rp "Clear Code Injection now, then press Enter: "

# 5. Activate the new theme
JWT=$(build_jwt)
echo "→ Activating theme '${THEME_NAME}'..."
ACTIVATE_RESP=$(curl -s -X PUT \
  -H "Authorization: Ghost ${JWT}" \
  -H "Content-Type: application/json" \
  "${GHOST_URL}/ghost/api/admin/themes/${THEME_NAME}/activate/")
echo "$ACTIVATE_RESP" | python3 -m json.tool --no-ensure-ascii 2>/dev/null \
  | grep -E '"name"|"active"|"errors"' || echo "$ACTIVATE_RESP"

echo ""
echo "✓ Theme activated. Rollback files saved in ${ROLLBACK_DIR}/."
echo "  To roll back: ./cutover.sh --rollback"
