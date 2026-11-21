#!/usr/bin/env node
'use strict';
/**
 * Monthly growth report (2026-11-20). Runs on the 1st (Railway cron, 16:00 UTC) for the month just ended, saves it in the WordPress store
 * `growth-snapshots`, emails hello@terryheath.com (the report goes to Terry only), and is shown in the admin hub at /growth.
 *
 *   Email lists      confirmed subscribers (listmonk), target +2.5% net a month
 *   Donations        online gifts (Stripe Checkout, metadata kind=donation), target +15% a year (this month against the same month last year)
 *   Subscriptions    active paid subscriptions (Stripe), target set from the first 3 months of data
 *   Sales            shop orders paid in the month (Stripe), target set from the first 3 months of data
 *   Visits           visits across every site (Umami), target set from the first 3 months of data
 * "Set from the first 3 months": the first three reports are the baseline; the fourth report onward is measured against their average,
 * which is stored once as `targets` (Terry can change it by editing the store value).
 *
 * Env: WP_URL, INKHORN_IMPORT_TOKEN, LISTMONK_*, STRIPE_SECRET_KEY, UMAMI_URL, UMAMI_USER, UMAMI_PASSWORD, UMAMI_IDS (json), SMTP_*, NOTICE_EMAIL.
 *   node inkhorn/growth-report.cjs [--month 2026-11] [--dry] [--no-mail]
 */
// The report history always lives in the WordPress store (never changes the process-wide STORE_MODE the hub uses for its other stores).
const WPB = () => (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '') + '/wp-json/inkhorn/v1/store/';
const WPH = () => ({ 'Content-Type': 'application/json', 'X-Import-Token': process.env.INKHORN_IMPORT_TOKEN || '' });
const STORE = {
  async load(key) { const r = await fetch(WPB() + key, { headers: WPH() }); if (!r.ok) throw new Error(`store ${key}: ${r.status}`); return r.json(); },
  async save(key, value, version) { const r = await fetch(WPB() + key, { method: 'POST', headers: WPH(), body: JSON.stringify({ value, version: version || undefined }) }); if (!r.ok) throw new Error(`store ${key} save: ${r.status}`); return (await r.json()).version; },
};
const LM = require('./listmonk.cjs');
const KEY = 'growth-snapshots';
const LISTS_MONTHLY = 0.025, DONATIONS_YEARLY = 0.15, BASELINE_MONTHS = 3;
const SITES = ['hub', 'review', 'whiterabbit', 'muse', 'terryheath', 'lifeonwords'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a, b) => (b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(1)}%` : 'n/a');

const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); return { from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1) }; };
const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
const lastYear = (ym) => { const [y, m] = ym.split('-').map(Number); return `${y - 1}-${String(m).padStart(2, '0')}`; };
const justEnded = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

async function stripe(path, params = {}) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`https://api.stripe.com/v1${path}?${q}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`stripe ${path}: ${r.status}`);
  return r.json();
}
async function* stripeAll(path, params) {
  let after;
  for (;;) {
    const d = await stripe(path, { ...params, limit: 100, ...(after ? { starting_after: after } : {}) });
    for (const x of d.data) yield x;
    if (!d.has_more) return;
    after = d.data[d.data.length - 1].id;
  }
}
/** Checkout sessions paid in the month: donations (kind=donation) and shop orders (everything else in payment mode). */
async function money(ym) {
  const { from, to } = monthRange(ym);
  let donations = 0, gifts = 0, sales = 0, orders = 0;
  for await (const s of stripeAll('/checkout/sessions', { 'created[gte]': Math.floor(from / 1000), 'created[lt]': Math.floor(to / 1000) })) {
    if (s.status !== 'complete' || s.payment_status !== 'paid' || s.mode !== 'payment') continue;
    if ((s.metadata || {}).kind === 'donation') { donations += s.amount_total || 0; gifts++; } else { sales += s.amount_total || 0; orders++; }
  }
  return { donations_cents: donations, gifts, sales_cents: sales, orders };
}
async function activeSubscriptions() {
  let n = 0;
  for await (const s of stripeAll('/subscriptions', { status: 'active' })) n++;
  return n;
}
async function lists() {
  const d = await LM.api('GET', '/lists?per_page=all');
  const by = {};
  for (const l of d.results) by[(l.tags && l.tags[0]) || l.name] = l.subscriber_count;
  const subs = await LM.api('GET', '/subscribers?per_page=1&query=' + encodeURIComponent("subscribers.status='enabled'"));
  return { total: subs.total, by_list: by };
}
async function visits(ym) {
  const base = (process.env.UMAMI_URL || '').replace(/\/$/, ''); if (!base) return { total: 0, by_site: {}, note: 'Umami is not connected' };
  const t = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.UMAMI_USER || 'admin', password: process.env.UMAMI_PASSWORD }) })).json();
  const ids = JSON.parse(process.env.UMAMI_IDS || '{}'); const { from, to } = monthRange(ym); const by = {}; let total = 0;
  for (const k of SITES) {
    if (!ids[k]) continue;
    const r = await fetch(`${base}/api/websites/${ids[k]}/stats?startAt=${from}&endAt=${to}`, { headers: { Authorization: 'Bearer ' + t.token } });
    const s = r.ok ? await r.json() : {};
    by[k] = s.visits?.value ?? s.visits ?? 0; total += Number(by[k]) || 0;
  }
  return { total, by_site: by };
}

async function build(ym) {
  const [m, mly, subs, ls, vs] = await Promise.all([money(ym), money(lastYear(ym)), activeSubscriptions(), lists(), visits(ym)]);
  return { month: ym, made: new Date().toISOString(), lists: ls, donations_cents: m.donations_cents, gifts: m.gifts, donations_last_year_cents: mly.donations_cents,
    subscriptions: subs, sales_cents: m.sales_cents, orders: m.orders, visits: vs.total, visits_by_site: vs.by_site, visits_note: vs.note || '' };
}

/** Targets and verdicts for one month, given the saved history. */
function judge(report, history) {
  const months = Object.keys(history.months || {}).filter((k) => k < report.month).sort();
  const prev = history.months?.[prevMonth(report.month)];
  const t = history.targets || null;
  const rows = [];
  const lt = prev ? Math.ceil(prev.lists.total * (1 + LISTS_MONTHLY)) : null;
  rows.push({ name: 'Email lists', unit: 'subscribers', value: report.lists.total, fmt: (v) => String(v), target: lt, basis: lt ? `+2.5% on last month's ${prev.lists.total}` : 'first month: this is the starting point', change: prev ? pct(report.lists.total, prev.lists.total) : '' });
  const dt = report.donations_last_year_cents ? Math.round(report.donations_last_year_cents * (1 + DONATIONS_YEARLY)) : null;
  rows.push({ name: 'Online donations', unit: 'this month', value: report.donations_cents, fmt: usd, target: dt, basis: dt ? `+15% on ${usd(report.donations_last_year_cents)} in the same month last year` : 'no gifts in the same month last year, so any gift is growth', change: report.donations_last_year_cents ? pct(report.donations_cents, report.donations_last_year_cents) : '' });
  const base = (key, label, fmt) => {
    const prior = months.map((k) => history.months[k][key]);
    const n = months.length + 1;
    let target = null, basis;
    if (t && t[key] != null) { target = t[key]; basis = 'average of the first 3 months'; }
    else if (n <= BASELINE_MONTHS) basis = `baseline month ${n} of ${BASELINE_MONTHS}; the target is set from these`;
    return { name: label, value: report[key], fmt, target, basis, change: months.length ? pct(report[key], history.months[months[months.length - 1]][key]) : '' };
  };
  rows.push(base('subscriptions', 'Subscriptions', (v) => String(v)));
  rows.push(base('sales_cents', 'Sales', usd));
  rows.push(base('visits', 'Visits', (v) => String(v)));
  for (const r of rows) r.verdict = r.target == null ? 'baseline' : (r.value >= r.target ? 'on target' : 'below target');
  return rows;
}

function bodyHtml(report, rows) {
  const tr = rows.map((r) => `<tr><th scope="row">${esc(r.name)}</th><td>${esc(r.fmt(r.value))}</td><td>${r.target == null ? '—' : esc(r.fmt(r.target))}</td><td>${esc(r.change)}</td><td><strong>${esc(r.verdict)}</strong><br><small>${esc(r.basis)}</small></td></tr>`).join('');
  const by = Object.entries(report.visits_by_site || {}).map(([k, v]) => `${esc(k)} ${v}`).join(' · ');
  const lists = Object.entries(report.lists.by_list || {}).map(([k, v]) => `${esc(k)} ${v}`).join(' · ');
  return `<h2>Growth report for ${esc(report.month)}</h2><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><thead><tr><th></th><th>This month</th><th>Target</th><th>Change</th><th>Verdict</th></tr></thead><tbody>${tr}</tbody></table>`
    + `<p><small>Lists: ${lists || '—'}<br>Visits by site: ${by || '—'} ${esc(report.visits_note)}<br>Gifts: ${report.gifts}; shop orders: ${report.orders}</small></p>`;
}

async function run({ month, dry, mail = true } = {}) {
  const ym = month || justEnded();
  const { value, version } = await STORE.load(KEY);
  const history = value && value.months ? value : { months: {}, targets: null };
  const report = await build(ym);
  const rows = judge(report, history);
  if (!dry) {
    history.months[ym] = report;
    const ks = Object.keys(history.months).sort();
    if (!history.targets && ks.length >= BASELINE_MONTHS) { // the baseline is complete: fix the targets from the first three months
      const first = ks.slice(0, BASELINE_MONTHS).map((k) => history.months[k]); const avg = (key) => Math.round(first.reduce((a, x) => a + x[key], 0) / first.length);
      history.targets = { subscriptions: avg('subscriptions'), sales_cents: avg('sales_cents'), visits: avg('visits'), set_from: ks.slice(0, BASELINE_MONTHS) };
    }
    await STORE.save(KEY, history, version);
    if (mail) {
      const NM = require('./notice-mail.cjs');
      if (NM.available()) await NM.sendNotice({ subject: `Growth report for ${ym}`, html: bodyHtml(report, rows), text: rows.map((r) => `${r.name}: ${r.fmt(r.value)} (target ${r.target == null ? 'baseline' : r.fmt(r.target)}, ${r.verdict})`).join('\n'), label: 'Growth report', from: 'Inkhorn reports <hello@terryheath.com>' });
    }
  }
  return { report, rows, history };
}

/** For the admin hub: the saved reports, newest first. */
async function html() {
  const { value } = await STORE.load(KEY);
  const history = value && value.months ? value : { months: {}, targets: null };
  const ks = Object.keys(history.months).sort().reverse();
  if (!ks.length) return '<h1>Growth report</h1><p>No report yet. The first one is made on the 1st of next month; <code>node inkhorn/growth-report.cjs --month YYYY-MM</code> makes one now.</p>';
  let out = '<h1>Growth report</h1><p>Targets: email lists +2.5% a month net; online donations +15% a year; subscriptions, sales and visits are set from the first three months of data' + (history.targets ? ` (set: ${history.targets.subscriptions} subscriptions, ${usd(history.targets.sales_cents)} sales, ${history.targets.visits} visits a month).` : ' (still in the baseline).') + '</p>';
  for (const k of ks.slice(0, 6)) {
    const past = { months: Object.fromEntries(Object.entries(history.months).filter(([m]) => m < k)), targets: history.targets };
    out += bodyHtml(history.months[k], judge(history.months[k], { ...past }));
  }
  return out;
}

module.exports = { run, html, build, judge };
if (require.main === module) {
  const a = process.argv; const mi = a.indexOf('--month');
  run({ month: mi > 0 ? a[mi + 1] : undefined, dry: a.includes('--dry'), mail: !a.includes('--no-mail') }).then(({ report, rows }) => { console.log(JSON.stringify(report, null, 1)); for (const r of rows) console.log(r.name, r.fmt(r.value), 'target', r.target == null ? 'baseline' : r.fmt(r.target), r.verdict); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
