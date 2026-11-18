#!/usr/bin/env node
// inkhorn/scheduler-check-wp.js — watches WordPress and listmonk (replaces scheduler-check.js, which watches Ghost) and emails hello@terryheath.com
// (never only a log line) when something is stuck:
//   1. a post scheduled in the past (more than 15 minutes ago) that WordPress did not publish
//   2. a listmonk campaign "running" with no progress for more than STUCK_MINUTES, or one that was cancelled/errored while sending
// Each problem is emailed ONCE: reported ids live in the store `scheduler-alerts` (WordPress network). Cron */10 * * * * on Railway. Exits 1 when anything is stuck.
// Env: WP_URL, INKHORN_IMPORT_TOKEN, LISTMONK_URL, LISTMONK_API_USER, LISTMONK_API_TOKEN, SMTP_USERNAME/SMTP_PASSWORD (alert mail), NOTICE_EMAIL, STUCK_MINUTES (15), DRY=1.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const LM = require('./listmonk.cjs');
const NM = require('./notice-mail.cjs');
const STORE = require('./store.cjs');
process.env.STORE_MODE = 'wp';
const STUCK = Number(process.env.STUCK_MINUTES || 15), DRY = process.env.DRY === '1';
const WP = (process.env.WP_URL || '').replace(/\/$/, ''), H = { 'X-Import-Token': process.env.INKHORN_IMPORT_TOKEN || '' };
const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
(async () => {
  const problems = [];
  const late = await (await fetch(WP + '/wp-json/inkhorn/v1/scheduled-late', { headers: H })).json();
  for (const p of late) problems.push({ id: `post:${p.site}:${p.id}`, text: `Scheduled post "${p.title}" (${p.site}) was due ${p.at} UTC and is not published.` });
  const now = Date.now();
  for (const c of await LM.campaigns()) {
    const idle = (now - new Date(c.updated_at).getTime()) / 60000;
    if (c.status === 'running' && idle > STUCK) problems.push({ id: `campaign:${c.id}:running`, text: `Campaign "${c.name}" is running but has not moved for ${Math.round(idle)} minutes (${c.sent}/${c.to_send} sent).` });
    if (c.status === 'cancelled' && c.sent < c.to_send && idle < 24 * 60) problems.push({ id: `campaign:${c.id}:cancelled`, text: `Campaign "${c.name}" was cancelled after ${c.sent} of ${c.to_send} sends.` });
  }
  let seen = []; try { seen = (await STORE.load('scheduler-alerts')).value || []; } catch { seen = []; }
  const fresh = problems.filter((p) => !seen.includes(p.id));
  console.log(`${problems.length} problem(s), ${fresh.length} new.`);
  if (fresh.length && !DRY) {
    await NM.sendNotice({ to: process.env.NOTICE_EMAIL || 'hello@terryheath.com', subject: 'Inkhorn: something is stuck', html: '<ul>' + fresh.map((p) => `<li>${esc(p.text)}</li>`).join('') + '</ul>', label: 'Inkhorn scheduler check' });
    const cur = await STORE.load('scheduler-alerts').catch(() => ({ version: '' }));
    await STORE.save('scheduler-alerts', [...seen, ...fresh.map((p) => p.id)].slice(-200), cur.version);
  }
  if (problems.length) process.exit(1);
})().catch((e) => { console.error(e.message); process.exit(1); });
