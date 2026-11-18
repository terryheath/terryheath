'use strict';
// Private JSON stores. Until the Ghost switch-off they stay in private draft Ghost pages (STORE_MODE unset); with STORE_MODE=wp they live in the WordPress network
// (see wp/plugins/inkhorn-network/includes/store.php). scripts/store-migrate.cjs copies Ghost -> WordPress; then set STORE_MODE=wp on every service that uses a store.
const wp = () => (process.env.STORE_MODE || '').toLowerCase() === 'wp';
const base = () => (process.env.WP_URL || '').replace(/\/$/, '') + '/wp-json/inkhorn/v1/store/';
const headers = () => ({ 'Content-Type': 'application/json', 'X-Import-Token': process.env.INKHORN_IMPORT_TOKEN || '' });
async function load(key) {
  const r = await fetch(base() + key, { headers: headers() });
  if (!r.ok) throw new Error(`store ${key}: ${r.status}`);
  return r.json(); // { value, version }
}
async function save(key, value, version) {
  const r = await fetch(base() + key, { method: 'POST', headers: headers(), body: JSON.stringify({ value, version: version || undefined }) });
  if (!r.ok) throw new Error(`store ${key} save: ${r.status}`);
  return (await r.json()).version;
}
module.exports = { wp, load, save };
