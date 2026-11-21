#!/usr/bin/env node
/**
 * Creates the lists and the per-brand email templates in listmonk (idempotent) and tells WordPress the list uuids.
 *   node inkhorn/scripts/listmonk-setup.cjs
 * Env: LISTMONK_URL (default the Railway address). Keychain: listmonk-admin-password, inkhorn-wp-import-token.
 */
const { execSync } = require('child_process');
const kc = (s) => execSync(`security find-generic-password -s ${s} -w`).toString().trim();
const LM = (process.env.LISTMONK_URL || 'https://lists.inkhorn.press').replace(/\/$/, '');
const WP = (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '');

const LISTS = [
  ['inkhorn-review', 'Inkhorn Review'], ['white-rabbit', 'White Rabbit'], ['muse', 'Muse'], ['events', 'Events'],
  ['writing', 'Terry Heath: Writing'], ['digest', 'Terry Heath: Digest'], ['new-books', 'Terry Heath: New books'], ['life-on-words', 'Life on Words'],
];
const BRANDS = {
  hub: ['Inkhorn Press', '#4F5B66', '#EDEFF1'], review: ['Inkhorn Review', '#5E7268', '#EEF1EE'], whiterabbit: ['White Rabbit', '#7A6478', '#F1EDF0'],
  muse: ['Muse', '#5D6F86', '#EEF1F5'], terryheath: ['Terry Heath', '#7A664B', '#F3EFE8'], lifeonwords: ['Life on Words', '#4E6E6E', '#EDF2F2'],
};
const FOOT = { 'Terry Heath': 'terryheath.com is published by Follow the Rabbit LLC.', 'Life on Words': 'Life on Words, hosted by Terry Heath, is produced by Follow the Rabbit LLC.' };
const template = (name, accent, tint, nonprofit) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{ .Campaign.Subject }}</title></head>
<body style="margin:0;background:#FBFAF7;color:#2C2A26;font-family:'EB Garamond',Georgia,serif;font-size:19px;line-height:1.55">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<p style="margin:0 0 32px;font-family:Karla,Arial,sans-serif;font-size:13px;letter-spacing:.06em;color:${accent}">${name.toUpperCase()}</p>
{{ template "content" . }}
<hr style="border:0;border-top:1px solid #ECE8E0;margin:48px 0 20px">
<p style="margin:0;font-family:Karla,Arial,sans-serif;font-size:13px;color:#67645D">${FOOT[name] || 'Inkhorn Press is a 501(c)(3) nonprofit press.'}<br>
<a href="{{ UnsubscribeURL }}" style="color:#67645D">Unsubscribe</a> · <a href="https://inkhorn.press/newsletter/?id={{ .Subscriber.UUID }}" style="color:#67645D">Newsletter preferences</a> · <a href="https://inkhorn.press/help/" style="color:#67645D">Help</a> · <a href="{{ MessageURL }}" style="color:#67645D">View in browser</a></p>
</div>{{ TrackView }}</body></html>`;

let cookie = '';
async function login() {
  const html = await (await fetch(LM + '/admin/login')).text();
  const nonce = (/name="nonce" value="([^"]*)"/.exec(html) || [])[1];
  const c0 = ''; 
  const r0 = await fetch(LM + '/admin/login', { headers: {} });
  const sc = (r0.headers.getSetCookie ? r0.headers.getSetCookie() : []).map((x) => x.split(';')[0]).join('; ');
  const r = await fetch(LM + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sc },
    body: new URLSearchParams({ username: 'terry', password: kc('listmonk-admin-password'), nonce: (/name="nonce" value="([^"]*)"/.exec(await (await fetch(LM + '/admin/login', { headers: { Cookie: sc } })).text()) || [])[1] || '', next: '/admin' }) });
  const set = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((x) => x.split(';')[0]);
  cookie = [sc, ...set].filter(Boolean).join('; ');
  if (r.status !== 302) throw new Error('listmonk login failed: ' + r.status);
}
const api = async (m, p, b) => {
  const r = await fetch(LM + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${t.slice(0, 200)}`); return JSON.parse(t).data;
};

(async () => {
  await login();
  const have = (await api('GET', '/lists?per_page=all')).results;
  const uuids = {};
  for (const [slug, name] of LISTS) {
    let l = have.find((x) => x.name === name);
    if (!l) l = await api('POST', '/lists', { name, type: 'public', optin: 'double', tags: [slug], description: '' });
    uuids[slug] = l.uuid; console.log('list', slug, l.id);
  }
  const tpls = await api('GET', '/templates');
  for (const [key, [name, accent, tint]] of Object.entries(BRANDS)) {
    const tn = 'Inkhorn: ' + name;
    const body = template(name, accent, tint, ['review', 'whiterabbit', 'muse'].includes(key));
    const ex = tpls.find((t) => t.name === tn);
    if (ex) await api('PUT', '/templates/' + ex.id, { name: tn, type: 'campaign', subject: '', body });
    else await api('POST', '/templates', { name: tn, type: 'campaign', subject: '', body });
    console.log('template', tn);
  }
  const r = await fetch(WP + '/wp-json/inkhorn/v1/option', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': kc('inkhorn-wp-import-token') }, body: JSON.stringify({ name: 'inkhorn_listmonk_lists', value: uuids }) });
  console.log('wordpress option', r.status);
})().catch((e) => { console.error(e.message); process.exit(1); });
