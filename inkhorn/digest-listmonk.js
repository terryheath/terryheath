#!/usr/bin/env node
// inkhorn/digest-listmonk.js — the weekly Inkhorn piece, rebuilt on WordPress + listmonk (replaces digest.js, which reads Ghost).
// Every Sunday at 7am Pacific, emails ONE piece from a print issue to the Inkhorn Review list as a listmonk campaign.
// Pool: published pieces of the Review that belong to a print issue (not online-only) and were not sent yet (GET /inkhorn/v1/digest-pool).
// WEEKLY_MODE: dry (default: print what would happen), test (draft campaign + test email to TEST_EMAIL, nothing marked), draft (create the draft campaign only), send (start it and mark the piece).
// FORCE=1 skips the Sunday-7am check. TEST_SLUGS=slug,slug sends test emails of named pieces to TEST_EMAIL only.
// Cron: "0 14,15 * * 0" (UTC); the run that is not 7am Pacific exits. Env: WP_URL, INKHORN_IMPORT_TOKEN, LISTMONK_URL, LISTMONK_API_USER, LISTMONK_API_TOKEN, TEST_EMAIL, NOTICE_EMAIL.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const require = createRequire(import.meta.url);
const LM = require('./listmonk.cjs');
const HERE = dirname(fileURLToPath(import.meta.url));
const MODE = (process.env.WEEKLY_MODE || 'dry').trim().toLowerCase();
const FORCE = process.env.FORCE === '1';
const TEST_EMAIL = process.env.TEST_EMAIL || 'hello@terryheath.com';
const WP = (process.env.WP_URL || '').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || '';
if (!['dry', 'test', 'draft', 'send'].includes(MODE)) { console.error(`WEEKLY_MODE must be dry, test, draft or send (got "${MODE}")`); process.exit(1); }
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wp = async (method, path, body) => {
  const r = await fetch(WP + '/wp-json/inkhorn/v1' + path, { method, headers: { 'X-Import-Token': TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`WordPress ${method} ${path}: ${r.status}`); return r.json();
};
function pacificNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour) % 24, date: `${p.year}-${p.month}-${p.day}` };
}
// Poems: one <p> per stanza with <br> between lines. Mail clients turn empty paragraphs into tall gaps, so they are removed and each stanza gets 1em after it.
const EMPTY_P = /<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/g;
function formatBody(body, isPoem) {
  let html = String(body).replace(EMPTY_P, '');
  html = html.replace(/<p(\s[^>]*)?>/g, `<p style="margin:0 0 1em 0;line-height:${isPoem ? '1.5' : '1.6'}">`);
  return html.replace(/<blockquote(\s[^>]*)?>/g, '<blockquote style="margin:0 0 1.25em 0;padding:0 0 0 12px;border-left:3px solid #ddd;font-size:15px;line-height:1.5;color:#555">');
}
function editorNotes(date) {
  let list = []; try { list = JSON.parse(readFileSync(join(HERE, 'data', 'digest-notes.json'), 'utf8')); } catch { return ''; }
  const day = process.env.NOTE_DATE || date;
  return list.filter((n) => n && n.date === day && n.html).map((n) => `<p style="margin:0 0 22px;padding:12px 14px;background:#f6f3ee;font-size:15px;line-height:1.45">${n.html}</p>`).join('\n');
}
function emailHtml(p, date) {
  const label = `Inkhorn Review · ${p.issue}`;
  return editorNotes(date) +
    `<p style="margin:0 0 6px;font-family:Karla,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#888">From ${esc(label)}</p>` +
    `<h1 style="margin:0 0 8px;font-size:28px;line-height:1.25;font-weight:400">${esc(p.title)}</h1>` +
    `<p style="margin:0 0 24px;font-size:16px;font-style:italic;color:#555">by ${esc(p.author)}</p>` +
    `<div style="font-size:19px">${formatBody(p.html, p.genre === 'poetry')}</div>` +
    `<p style="margin:28px 0 6px;font-family:Karla,Arial,sans-serif;font-size:15px"><a href="${esc(p.url)}" style="color:#5E7268">Read it on Inkhorn Review &rarr;</a></p>`;
}
async function notify(subject, html) { try { require('./notice-mail.cjs').sendNotice({ to: process.env.NOTICE_EMAIL || 'hello@terryheath.com', subject, html, label: 'Inkhorn digest' }); } catch (e) { console.error('notice failed:', e.message); } }

async function main() {
  const now = pacificNow();
  if (!FORCE && !(now.weekday === 'Sun' && now.hour === 7) && !process.env.TEST_SLUGS) { console.log('Not Sunday 7am Pacific: nothing to do.'); return; }
  const pool = await wp('GET', '/digest-pool');
  if (process.env.TEST_SLUGS) {
    for (const slug of process.env.TEST_SLUGS.split(',').map((s) => s.trim()).filter(Boolean)) {
      const p = pool.find((x) => x.url.replace(/\/$/, '').endsWith('/' + slug)); if (!p) { console.log('not eligible:', slug); continue; }
      const c = await LM.draftCampaign({ name: `[test] ${p.title}`, subject: `[TEST] ${p.title}`, listSlugs: ['inkhorn-review'], brand: 'review', html: emailHtml(p, now.date) });
      await LM.testSend(c.id, TEST_EMAIL, c); console.log(`Test of "${p.title}" sent to ${TEST_EMAIL}.`);
    }
    return;
  }
  const left = pool.filter((p) => !p.sent);
  if (!left.length) { console.log('No pieces left.'); if (MODE !== 'dry') await notify('Weekly Inkhorn piece: none left', '<p>Every eligible piece has been sent. Nothing went out this Sunday.</p>'); return; }
  const pick = left[Math.floor(Math.random() * left.length)];
  console.log(`Picked "${pick.title}" by ${pick.author} (${pick.issue}). ${left.length} unsent in the pool.`);
  if (MODE === 'dry') return;
  const c = await LM.draftCampaign({ name: `Weekly: ${pick.title} (${now.date})`, subject: pick.title, listSlugs: ['inkhorn-review'], brand: 'review', html: emailHtml(pick, now.date) });
  if (MODE === 'test') { await LM.testSend(c.id, TEST_EMAIL, c); console.log(`Draft campaign ${c.id}; test sent to ${TEST_EMAIL}.`); return; }
  if (MODE === 'draft') { console.log(`Draft campaign ${c.id} created. Start it in listmonk.`); return; }
  await LM.setStatus(c.id, 'running');
  await wp('POST', '/digest-sent', { id: pick.id });
  console.log(`Sent campaign ${c.id}: "${pick.title}"; marked as sent.`);
}
main().catch(async (e) => { console.error(e.message); await notify('Weekly Inkhorn piece FAILED', `<p>${esc(e.message)}</p>`); process.exit(1); });
