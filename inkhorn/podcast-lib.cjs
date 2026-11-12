// Life on Words guest system (2026-11-12): guests, agreements, bookings, reminders. Shared by podcast.cjs (hourly Railway cron),
// the admin hub (/podcast) and the Cal.com webhook, all served from the agreements-accept service. See CLAUDE.md ("Life on Words guests").
//
// Guests live in a private draft Ghost page `podcast-guests` (JSON in codeinjection_head), like the contributor agreement tracker.
const crypto = require('crypto');
const L = require('./agreements-lib.cjs');
const { EMAILS, STUDIO } = require('./podcast-emails.cjs');

const PAGE = 'podcast-guests';
const HUB = 'https://admin.inkhornreview.com';
const TEMPLATE_NAME = 'Life on Words — Guest Agreement';
const PACIFIC = 'America/Los_Angeles';

// ---- store ------------------------------------------------------------------------------------------------------------------
async function load(api = L.ghost()) {
  const r = await api.pages.browse({ filter: `slug:${PAGE}`, limit: 1, fields: 'id,codeinjection_head,updated_at' });
  if (!r.length) return { page: null, guests: [] };
  let guests = [];
  try { guests = JSON.parse(r[0].codeinjection_head || '[]'); } catch { guests = []; }
  return { page: r[0], guests };
}
async function save(store, api = L.ghost()) {
  const json = JSON.stringify(store.guests, null, 1);
  if (!store.page) store.page = await api.pages.add({ title: 'Life on Words guests (private)', slug: PAGE, status: 'draft', codeinjection_head: json });
  else store.page = await api.pages.edit({ id: store.page.id, updated_at: store.page.updated_at, codeinjection_head: json });
}
const newGuest = (o) => ({
  id: crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(18).toString('base64url'),
  name: o.name, email: o.email.toLowerCase(), note: o.note || '', kind: o.kind || 'invite', old_when: o.old_when || '', created_at: new Date().toISOString(),
  agreement: null, booking: null, reminders: {}, reschedules: 0, pipeline: 'new', cancelled: false, log: [],
});
const firstName = (n) => String(n).replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || 'there';

// ---- time zones --------------------------------------------------------------------------------------------------------------
// The UTC instant at which it is `hour`:`min` on calendar date `ymd` (YYYY-MM-DD) in time zone `tz`.
function zonedInstant(ymd, hour, min, tz) {
  let guess = new Date(`${ymd}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`);
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess).map((p) => [p.type, p.value]));
    const got = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    const want = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), hour, min);
    if (got === want) break;
    guess = new Date(guess.getTime() + (want - got));
  }
  return guess;
}
const localYmd = (date, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const localHour = (date, tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: 'numeric' }).format(date));
const shiftYmd = (ymd, days) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
// "Tuesday, December 8 at 9:00 a.m. PST"
function when(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.month} ${p.day} at ${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase().replace(/^(a|p)m$/, '$1.m.')} ${p.timeZoneName}`;
}

// ---- the reminder schedule ---------------------------------------------------------------------------------------------------
// Returns { week, two_days, morning } as UTC Dates (or null when that reminder is skipped) for a booking, in the guest's own time zone.
//   week      9:00 a.m. local, 7 days before the session date; skipped if the booking was made less than 7 days ahead.
//   two_days  9:00 a.m. local, 2 days before; skipped if the booking was made after that moment.
//   morning   7:00 a.m. local on the day; if the session starts before 9:00 a.m. local, 6:00 p.m. the evening before instead.
function reminderTimes(startIso, tz, createdIso) {
  const start = new Date(startIso), created = new Date(createdIso || 0);
  const day = localYmd(start, tz);
  const week = zonedInstant(shiftYmd(day, -7), 9, 0, tz);
  const two = zonedInstant(shiftYmd(day, -2), 9, 0, tz);
  const early = localHour(start, tz) < 9;
  const morning = early ? zonedInstant(shiftYmd(day, -1), 18, 0, tz) : zonedInstant(day, 7, 0, tz);
  const skipWeek = created > new Date(start.getTime() - 7 * 86400000) || created > week;
  return { week: skipWeek ? null : week, two_days: created > two ? null : two, morning: created > morning ? null : morning };
}

// ---- email ------------------------------------------------------------------------------------------------------------------
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
function varsFor(g) {
  const b = g.booking;
  const tz = (b && b.tz) || PACIFIC;
  const v = { first: firstName(g.name), note: g.note ? `${g.note.trim()}\n\n` : '', studio_url: STUDIO, agreement_url: g.agreement ? g.agreement.url : '', book_url: `${HUB}/podcast/book?token=${g.token}`, old_when: g.old_when || '' };
  if (b && b.status === 'booked') { v.when = when(new Date(b.start), tz); v.reschedule_url = `https://cal.com/reschedule/${b.uid}`; v.cancel_url = `https://cal.com/booking/${b.uid}?cancel=true`; }
  return v;
}
function render(kind, g, extra = {}) {
  const e = EMAILS[kind];
  const v = { ...varsFor(g), ...extra };
  return { subject: fill(e.subject, v), text: fill(e.body, v) };
}
let transport = null;
async function sendMail(to, subject, text) {
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'email-smtp.us-east-2.amazonaws.com', port: 587, secure: false, auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } });
  }
  await transport.sendMail({ from: 'Life on Words <hello@inkhornreview.com>', replyTo: 'hello@terryheath.com', to, subject, text });
}
// Sends an email kind to a guest and records it (never twice for the same key).
async function sendKind(g, kind, key = kind, extra = {}) {
  if (g.reminders[key]) return false;
  const m = render(kind, g, extra);
  await sendMail(g.email, m.subject, m.text);
  g.reminders[key] = new Date().toISOString();
  g.log.push(`${g.reminders[key].slice(0, 16)} sent ${key}`);
  return true;
}

// ---- DocuSeal ---------------------------------------------------------------------------------------------------------------
async function templateId() {
  const t = (await L.ds('GET', '/templates?limit=100')).data.filter((x) => x.name === TEMPLATE_NAME).sort((a, b) => b.id - a.id)[0];
  if (!t) throw new Error(`DocuSeal template "${TEMPLATE_NAME}" not found`);
  return t.id;
}
// Creates the agreement (no DocuSeal email; we send our own invite with the link).
async function createAgreement(g) {
  const subs = await L.ds('POST', '/submissions', { template_id: await templateId(), send_email: false, submitters: [{ role: 'Guest', email: g.email, name: g.name, values: { 'Full name': g.name, Email: g.email } }] });
  const s = subs[0];
  g.agreement = { submission_id: s.submission_id, url: `${L.DOCUSEAL_URL}/s/${s.slug}`, status: 'sent', sent_at: new Date().toISOString() };
}
// Refreshes agreement status from DocuSeal (sent / viewed / signed).
async function refreshAgreement(g) {
  if (!g.agreement || g.agreement.status === 'signed') return;
  try {
    const sub = await L.ds('GET', `/submissions/${g.agreement.submission_id}`);
    const s = sub.submitters && sub.submitters[0];
    if (!s) return;
    if (s.status === 'completed') { g.agreement.status = 'signed'; g.agreement.signed_at = s.completed_at; }
    else if (s.opened_at) { g.agreement.status = 'viewed'; g.agreement.viewed_at = s.opened_at; }
  } catch (e) { console.error('agreement refresh failed', g.email, e.message); }
}
async function signedPdfUrl(g) {
  if (!g.agreement) return null;
  const sub = await L.ds('GET', `/submissions/${g.agreement.submission_id}`);
  return (sub.documents && sub.documents[0] && sub.documents[0].url) || null;
}

// ---- inviting ---------------------------------------------------------------------------------------------------------------
const CAL_EVENT_URL = process.env.CAL_EVENT_URL || 'https://cal.com/terry-heath-gpfyhn/life-on-words-recording';
const notifyTerry = (subject, text) => sendMail('hello@terryheath.com', subject, text).catch((e) => console.error('notify failed', e.message));
// New guest: create the DocuSeal agreement and send the invite (with the optional personal note on top).
async function invite(g) {
  if (!g.agreement) await createAgreement(g);
  await sendKind(g, 'invite', `invite:${g.agreement.submission_id}`);
  g.invited_at = new Date().toISOString();
}
// The five whose dates stand and the five who must reschedule get their own first email (not the invite).
async function sendFirst(g) {
  if (!g.agreement) await createAgreement(g);
  const kind = g.kind === 'keep_date' ? 'keep_date' : g.kind === 'reschedule' ? 'reschedule_notice' : 'invite';
  await sendKind(g, kind, `${kind}:${g.agreement.submission_id}`);
  g.invited_at = new Date().toISOString();
}
const link = (g) => `${HUB}/podcast/book?token=${g.token}`;

// ---- Cal.com webhook (BOOKING_CREATED / BOOKING_RESCHEDULED / BOOKING_CANCELLED) ----------------------------------------------------
async function handleCal(event) {
  const trig = event.triggerEvent, p = event.payload || {};
  const att = (p.attendees || [])[0];
  if (!att || !att.email) return 'no attendee';
  const store = await load();
  const g = store.guests.find((x) => x.email === String(att.email).toLowerCase());
  if (!g) { await notifyTerry('Life on Words: a booking from someone not in the guest list', `${att.name} <${att.email}> booked (${trig}) ${p.startTime}. They are not in /podcast; add them there.`); return 'unknown guest'; }
  await refreshAgreement(g);
  if (trig === 'BOOKING_CANCELLED') {
    if (g.booking && g.booking.uid === p.uid) { g.booking.status = 'cancelled'; g.cancelled = true; g.log.push(`${new Date().toISOString().slice(0, 16)} cancelled`); }
    await save(store);
    await notifyTerry(`Life on Words: ${g.name} cancelled`, `${g.name} cancelled the session on ${when(new Date(p.startTime), PACIFIC)} (Pacific). See ${HUB}/podcast`);
    return 'cancelled';
  }
  if (trig !== 'BOOKING_CREATED' && trig !== 'BOOKING_RESCHEDULED') return 'ignored';
  const re = trig === 'BOOKING_RESCHEDULED' || (g.booking && g.booking.status === 'booked' && g.booking.uid !== p.uid);
  g.booking = { uid: p.uid, start: new Date(p.startTime).toISOString(), end: new Date(p.endTime).toISOString(), tz: att.timeZone || PACIFIC, status: 'booked', created_at: new Date().toISOString() };
  g.cancelled = false;
  if (re) g.reschedules = (g.reschedules || 0) + 1;
  g.pipeline = g.pipeline === 'new' || !g.pipeline ? 'booked' : g.pipeline;
  g.log.push(`${new Date().toISOString().slice(0, 16)} ${re ? 'rescheduled' : 'booked'} ${g.booking.start}`);
  await sendKind(g, 'booked', `booked:${p.uid}`);
  if (!g.agreement || g.agreement.status !== 'signed') await notifyTerry(`Life on Words: ${g.name} booked WITHOUT a signed agreement`, `${g.name} <${g.email}> booked ${when(new Date(p.startTime), PACIFIC)} (Pacific) but the agreement is not signed. ${HUB}/podcast`);
  await save(store);
  return re ? 'rescheduled' : 'booked';
}

// ---- the hourly job --------------------------------------------------------------------------------------------------------------
async function feedTitles() {
  try { const r = await fetch('https://inkhornreview.com/podcast/rss/', { signal: AbortSignal.timeout(15000) }); const x = await r.text(); return [...x.matchAll(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)].map((m) => m[1]); } catch { return []; }
}
async function runHourly({ dry = false, now = new Date() } = {}) {
  const store = await load();
  const titles = (await feedTitles()).map((t) => t.toLowerCase());
  const did = [];
  for (const g of store.guests) {
    if (g.pending_send) continue; // imported guests are untouched until Terry sends their first email from /podcast
    await refreshAgreement(g);
    // signed: thank them and send the booking link (not to the five whose dates already stand)
    if (g.agreement && g.agreement.status === 'signed' && g.kind !== 'keep_date' && !g.booking && !g.reminders[`signed:${g.agreement.submission_id}`]) {
      if (!dry) await sendKind(g, 'signed', `signed:${g.agreement.submission_id}`); did.push(`signed ${g.name}`);
    }
    // one reminder if the agreement is still unsigned 3 days after it went out
    if (g.agreement && g.agreement.status !== 'signed' && g.agreement.sent_at && now - new Date(g.agreement.sent_at) > 3 * 86400000 && !g.reminders[`agreement_reminder:${g.agreement.submission_id}`]) {
      if (!dry) await sendKind(g, 'agreement_reminder', `agreement_reminder:${g.agreement.submission_id}`); did.push(`agreement reminder ${g.name}`);
    }
    // session reminders: one week before, two days before, the morning of (each at most once per booking)
    const b = g.booking;
    if (b && b.status === 'booked' && !g.cancelled && new Date(b.start) > now) {
      const t = reminderTimes(b.start, b.tz || PACIFIC, b.created_at);
      for (const [key, kind] of [['week', 'week_before'], ['two_days', 'two_days'], ['morning', 'morning_of']]) {
        const due = t[key];
        if (!due || due > now || g.reminders[`${key}:${b.uid}`]) continue;
        if (!dry) await sendKind(g, kind, `${key}:${b.uid}`); did.push(`${key} ${g.name}`);
      }
    }
    // published: an episode in the feed carries the guest's name (Terry can override on /podcast)
    if (!g.pipeline_manual && g.pipeline !== 'published' && g.name.length > 3 && titles.some((t) => t.includes(g.name.toLowerCase()))) { g.pipeline = 'published'; did.push(`published ${g.name}`); }
  }
  if (!dry) await save(store);
  return did;
}

module.exports = { invite, sendFirst, link, handleCal, runHourly, CAL_EVENT_URL, notifyTerry, PAGE, HUB, PACIFIC, load, save, newGuest, firstName, zonedInstant, localYmd, localHour, shiftYmd, when, reminderTimes, render, fill, varsFor, sendMail, sendKind, createAgreement, refreshAgreement, signedPdfUrl, TEMPLATE_NAME };
