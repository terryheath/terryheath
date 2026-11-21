'use strict';
// listmonk client (replaces Ghost newsletters). Env: LISTMONK_URL, LISTMONK_API_USER, LISTMONK_API_TOKEN (Keychain listmonk-api-token for local runs).
const { execSync } = require('child_process');
const kc = (s) => { try { return execSync(`security find-generic-password -s ${s} -w`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const URL_ = () => (process.env.LISTMONK_URL || 'https://listmonk-production-b3fcccbe.up.railway.app').replace(/\/$/, '');
const auth = () => `token ${process.env.LISTMONK_API_USER || 'automation'}:${process.env.LISTMONK_API_TOKEN || kc('listmonk-api-token')}`;
async function api(method, path, body) {
  const r = await fetch(URL_() + '/api' + path, { method, headers: { Authorization: auth(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`listmonk ${method} ${path}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t).data : null;
}
const BRAND_TEMPLATE = { review: 'Inkhorn: Inkhorn Review', whiterabbit: 'Inkhorn: White Rabbit', muse: 'Inkhorn: Muse', hub: 'Inkhorn: Inkhorn Press', terryheath: 'Inkhorn: Terry Heath', lifeonwords: 'Inkhorn: Life on Words' };
async function listBySlug(slug) { const l = (await api('GET', '/lists?per_page=all')).results.find((x) => (x.tags || []).includes(slug)); if (!l) throw new Error('no listmonk list ' + slug); return l; }
async function templateId(brand) { const t = (await api('GET', '/templates')).find((x) => x.name === BRAND_TEMPLATE[brand]); if (!t) throw new Error('no template for ' + brand); return t.id; }
/** Creates a campaign as a draft. Terry (or a script with mode 'send') starts it. */
// Each list sends from its own site's domain.
const FROM_BY_LIST = { 'inkhorn-review': 'Inkhorn Review <hello@inkhornreview.com>', 'white-rabbit': 'White Rabbit <hello@whiterabbitreview.com>', events: 'Inkhorn Press <hello@inkhorn.press>', writing: 'Terry Heath <hello@terryheath.com>', digest: 'Terry Heath <hello@terryheath.com>', 'new-books': 'Terry Heath <hello@terryheath.com>', 'life-on-words': 'Life on Words <hello@lifeonwords.com>' };
async function draftCampaign({ name, subject, listSlugs, brand, html, fromEmail, sendAt }) {
  fromEmail = fromEmail || FROM_BY_LIST[listSlugs[0]];
  const lists = await Promise.all(listSlugs.map(listBySlug));
  return api('POST', '/campaigns', { name, subject, lists: lists.map((l) => l.id), type: 'regular', content_type: 'html', body: html, template_id: await templateId(brand), from_email: fromEmail || undefined, messenger: 'email', headers: [], send_at: sendAt || null });
}
const setStatus = (id, status) => api('PUT', `/campaigns/${id}/status`, { status });
const testSend = async (id, to, c) => {
  c = c || await api('GET', `/campaigns/${id}`);
  return api('POST', `/campaigns/${id}/test`, { name: c.name, subject: c.subject, lists: (c.lists || []).map((l) => (typeof l === 'object' ? l.id : l)), from_email: c.from_email, content_type: c.content_type, body: c.body, template_id: c.template_id, messenger: c.messenger || 'email', headers: c.headers || [], subscribers: [to] });
};
const campaigns = (q = '') => api('GET', '/campaigns?per_page=all' + q).then((d) => d.results);
module.exports = { api, listBySlug, templateId, draftCampaign, setStatus, testSend, campaigns, BRAND_TEMPLATE };
