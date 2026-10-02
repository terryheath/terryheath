#!/usr/bin/env bash
# deploy.sh — Build, upload, and activate the Inkhorn theme via Ghost Admin API.
# Usage: ./deploy.sh
# Credentials read from macOS Keychain.
set -euo pipefail

GHOST_URL=$(security find-generic-password -s "ghost-url-inkhorn" -w)
ADMIN_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w)

THEME_NAME="inkhorn"
ZIP_PATH="dist/${THEME_NAME}.zip"

# 1. Build
echo "→ Building theme..."
node_modules/.bin/gulp zip

# 2. Split Admin API key into id:secret
KEY_ID="${ADMIN_KEY%%:*}"
KEY_SECRET="${ADMIN_KEY#*:}"

# 3. Generate JWT (HS256, 5-minute expiry)
now=$(date +%s)
exp=$((now + 300))
header=$(printf '{"alg":"HS256","kid":"%s","typ":"JWT"}' "$KEY_ID" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
payload=$(printf '{"iat":%d,"exp":%d,"aud":"/admin/"}' "$now" "$exp" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
sig_input="${header}.${payload}"
hex_secret=$(printf '%s' "$KEY_SECRET" | xxd -r -p | openssl base64 -A | tr '+/' '-_' | tr -d '=')
# HMAC-SHA256 via node (openssl dgst -hmac needs binary key)
JWT=$(node -e "
const crypto = require('crypto');
const key = Buffer.from('$KEY_SECRET', 'hex');
const sig = crypto.createHmac('sha256', key).update('$sig_input').digest('base64url');
console.log('$sig_input.' + sig);
")

# 4. Upload theme
echo "→ Uploading ${ZIP_PATH} to ${GHOST_URL}..."
UPLOAD_RESP=$(curl -s -X POST \
  -H "Authorization: Ghost ${JWT}" \
  -F "file=@${ZIP_PATH};type=application/zip" \
  "${GHOST_URL}/ghost/api/admin/themes/upload/")

echo "$UPLOAD_RESP" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || echo "$UPLOAD_RESP"

# 5. Activate theme
echo "→ Activating theme '${THEME_NAME}'..."
ACTIVATE_RESP=$(curl -s -X PUT \
  -H "Authorization: Ghost ${JWT}" \
  -H "Content-Type: application/json" \
  "${GHOST_URL}/ghost/api/admin/themes/${THEME_NAME}/activate/")

echo "$ACTIVATE_RESP" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || echo "$ACTIVATE_RESP"

echo "✓ Done."
