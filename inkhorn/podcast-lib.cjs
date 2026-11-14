// Life on Words guest system (2026-11-12): guests, agreements, bookings, reminders. Shared by podcast.cjs (hourly Railway cron),
// the admin hub (/podcast) and the Cal.com webhook, all served from the agreements-accept service. See CLAUDE.md ("Life on Words guests").
//
// Guests live in a private draft Ghost page `podcast-guests` (JSON in codeinjection_head), like the contributor agreement tracker.
const crypto = require('crypto');
const L = require('./agreements-lib.cjs');
const { EMAILS, STUDIO } = require('./podcast-emails.cjs');

const PAGE = 'podcast-guests';
const HUB = 'https://admin.terryheath.com';
const TEMPLATE_NAME = 'Life on Words — Guest Agreement';
const PACIFIC = 'America/Los_Angeles';
// Bump when the guest agreement text changes. 2026-11-13: producer is Follow the Rabbit LLC; the Inkhorn Review transcript right (2(c)) is gone.
const AGREEMENT_VERSION = '2026-11-13';

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

// ---- the agreement deadline ---------------------------------------------------------------------------------------------------
// A booked session goes ahead only if the agreement is signed before the one-week reminder would go out: 9:00 a.m. in the guest's time zone,
// 7 days before the session date. (If the first email only just went out, they get 3 days from it, so nobody is cancelled before they could read it.)
function deadlineFor(g) {
  const b = g.booking;
  if (!b || b.status !== 'booked' || !b.start) return null;
  const tz = b.tz || PACIFIC;
  const week = zonedInstant(shiftYmd(localYmd(new Date(b.start), tz), -7), 9, 0, tz);
  const grace = g.invited_at ? new Date(new Date(g.invited_at).getTime() + 3 * 86400000) : new Date(0);
  return week > grace ? week : grace;
}

// ---- email ------------------------------------------------------------------------------------------------------------------
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
function varsFor(g) {
  const b = g.booking;
  const tz = (b && b.tz) || PACIFIC;
  const v = { first: firstName(g.name), note: g.note ? `${g.note.trim()}\n\n` : '', studio_url: STUDIO, agreement_url: g.agreement ? g.agreement.url : '', book_url: `${HUB}/podcast/book?token=${g.token}`, old_when: g.old_when || '' };
  if (b && b.start) v.when = when(new Date(b.start), tz);
  if (b && b.status === 'booked' && !String(b.uid).startsWith('imported-')) { v.reschedule_url = `https://cal.com/reschedule/${b.uid}`; v.cancel_url = `https://cal.com/booking/${b.uid}?cancel=true`; }
  v.change_lines = v.reschedule_url ? `Need to change it? Reschedule: ${v.reschedule_url}\nCan't make it? Cancel: ${v.cancel_url}` : "Need to change it, or can't make it? Just reply to this email.";
  const dl = deadlineFor(g);
  v.deadline = dl ? when(dl, tz) : '';
  v.deadline_notice = dl ? `Please sign by ${v.deadline}. If the agreement isn't signed by then, the session will be cancelled, and you can sign and pick a new time whenever you're ready.\n\n` : '';
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
  await transport.sendMail({ from: process.env.PODCAST_FROM || 'Life on Words <hello@inkhornreview.com>', replyTo: 'hello@terryheath.com', to, subject, text });
}
// Sends an email kind to a guest and records it (never twice for the same key).
async function sendKind(g, kind, key = kind, extra = {}) {
  if (g.reminders[key]) return false;
  // Any email that carries the agreement link carries the CURRENT agreement: an unsigned guest still on an older version gets a fresh submission first.
  if (EMAILS[kind] && /\{agreement_url\}/.test(EMAILS[kind].body) && kind !== 'agreement_updated') {
    const oldId = g.agreement && g.agreement.submission_id;
    if (await upgradeAgreement(g) && key.endsWith(`:${oldId}`)) key = key.replace(`:${oldId}`, `:${g.agreement.submission_id}`); // record the send under the new submission id
  }
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
  g.agreement = { submission_id: s.submission_id, url: `${L.DOCUSEAL_URL}/s/${s.slug}`, status: 'sent', sent_at: new Date().toISOString(), version: AGREEMENT_VERSION };
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
// Which first email a guest gets: the invitation, the two notices to the imported guests, or (already said yes) the agreement only.
const firstKind = (g) => (g.kind === 'keep_date' ? 'keep_date' : g.kind === 'reschedule' ? 'reschedule_notice' : g.kind === 'accepted' ? 'agreement_only_accepted' : 'invite');
// New guest: create the DocuSeal agreement and send the first email (the invitation with the optional personal note on top, or for a guest who already said yes the agreement only).
async function invite(g) {
  if (!g.agreement) await createAgreement(g);
  const kind = firstKind(g);
  await sendKind(g, kind, `${kind}:${g.agreement.submission_id}`);
  g.invited_at = new Date().toISOString();
}
// The five whose dates stand and the five who must reschedule get their own first email (not the invite).
async function sendFirst(g) { return invite(g); }
// The agreement text changed: archive the guest's unsigned agreement (the old link stops working), create a new one from the current template
// and send agreement_updated. The original sent_at, invited_at, booking and the agreement-reminder record are kept, so the sign-by deadline and the
// reminder schedule do not move. Never touches a signed agreement. Returns 'sent', or throws.
async function sendUpdatedAgreement(g) {
  await refreshAgreement(g);
  if (g.agreement && g.agreement.status === 'signed') throw new Error('already signed; left alone');
  const old = g.agreement;
  await createAgreement(g); // sets g.agreement to the new submission
  if (old) {
    g.agreement.sent_at = old.sent_at || g.agreement.sent_at; // keep the reminder clock
    g.agreement.replaces = [...(old.replaces || []), old.submission_id];
    const oldRem = g.reminders[`agreement_reminder:${old.submission_id}`];
    if (oldRem) g.reminders[`agreement_reminder:${g.agreement.submission_id}`] = oldRem;
    try { await L.ds('DELETE', `/submissions/${old.submission_id}`); } catch (e) { g.log.push(`${new Date().toISOString().slice(0, 16)} archiving old agreement #${old.submission_id} FAILED: ${e.message}`); throw e; }
  }
  await sendKind(g, 'agreement_updated', `agreement_updated:${g.agreement.submission_id}`);
  return 'sent';
}
// Silent upgrade (no email of its own): archives an unsigned guest's old-version submission, creates a new one from the current template, keeps the
// original sent_at (so the deadline and reminder clock do not move) and moves the reminder records to the new submission id.
// Called from sendKind just before an email that carries the agreement link. Signed agreements are never touched.
async function upgradeAgreement(g) {
  if (!g.agreement || g.agreement.status === 'signed' || g.agreement.version === AGREEMENT_VERSION) return false;
  const old = g.agreement;
  await createAgreement(g);
  g.agreement.sent_at = old.sent_at || g.agreement.sent_at;
  g.agreement.replaces = [...(old.replaces || []), old.submission_id];
  for (const k of Object.keys(g.reminders)) if (k.endsWith(`:${old.submission_id}`)) g.reminders[k.replace(`:${old.submission_id}`, `:${g.agreement.submission_id}`)] = g.reminders[k];
  try { await L.ds('DELETE', `/submissions/${old.submission_id}`); } catch (e) { g.log.push(`${new Date().toISOString().slice(0, 16)} archiving old agreement #${old.submission_id} FAILED: ${e.message}`); }
  g.log.push(`${new Date().toISOString().slice(0, 16)} agreement upgraded to ${AGREEMENT_VERSION}: #${old.submission_id} -> #${g.agreement.submission_id}`);
  return true;
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
    if (g.booking && g.booking.uid === p.uid && g.booking.status === 'cancelled') return 'already cancelled'; // e.g. our own automatic cancellation
    if (g.booking && g.booking.uid === p.uid) { g.booking.status = 'cancelled'; g.cancelled = true; g.log.push(`${new Date().toISOString().slice(0, 16)} cancelled`); }
    await save(store);
    await notifyTerry(`Life on Words: ${g.name} cancelled`, `${g.name} cancelled the session on ${when(new Date(p.startTime), PACIFIC)} (Pacific). See ${HUB}/podcast`);
    return 'cancelled';
  }
  if (trig !== 'BOOKING_CREATED' && trig !== 'BOOKING_RESCHEDULED') return 'ignored';
  const re = trig === 'BOOKING_RESCHEDULED' || (g.booking && g.booking.status === 'booked' && g.booking.uid !== p.uid);
  g.booking = { uid: p.uid, start: new Date(p.startTime).toISOString(), end: new Date(p.endTime).toISOString(), tz: att.timeZone || PACIFIC, status: 'booked', created_at: new Date().toISOString() };
  g.cancelled = false; g.cancel_reason = '';
  if (re) g.reschedules = (g.reschedules || 0) + 1;
  g.pipeline = g.pipeline === 'new' || !g.pipeline ? 'booked' : g.pipeline;
  g.log.push(`${new Date().toISOString().slice(0, 16)} ${re ? 'rescheduled' : 'booked'} ${g.booking.start}`);
  await sendKind(g, 'booked', `booked:${p.uid}`);
  if (!g.agreement || g.agreement.status !== 'signed') await notifyTerry(`Life on Words: ${g.name} booked WITHOUT a signed agreement`, `${g.name} <${g.email}> booked ${when(new Date(p.startTime), PACIFIC)} (Pacific) but the agreement is not signed. ${HUB}/podcast`);
  await save(store);
  return re ? 'rescheduled' : 'booked';
}

// ---- the hourly job --------------------------------------------------------------------------------------------------------------
// Cancels a real Cal.com booking (so the slot reopens) through Cal's public cancel endpoint (it needs a CSRF cookie handshake).
async function calCancel(uid, email) {
  const c = await fetch('https://cal.com/api/csrf'); // the endpoint Cal's own cancel page uses
  const cookie = (c.headers.getSetCookie ? c.headers.getSetCookie() : []).map((x) => x.split(';')[0]).join('; ');
  const { csrfToken } = await c.json();
  const r = await fetch('https://cal.com/api/cancel', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ uid, allRemainingBookings: false, cancellationReason: 'The guest agreement was not signed by the deadline.', cancelledBy: email, internalNote: null, csrfToken }) });
  if (!r.ok) throw new Error(`Cal.com cancel ${r.status}: ${(await r.text()).slice(0, 120)}`);
}
async function cancelUnsigned(g) {
  const b = g.booking;
  const notes = [];
  if (b.uid && !String(b.uid).startsWith('imported-')) { try { await calCancel(b.uid, g.email); notes.push('Cal.com booking cancelled'); } catch (e) { notes.push(`Cal.com cancel FAILED (${e.message})`); } }
  else notes.push('Google-only booking: its Google Calendar event must be deleted (guest notified)');
  const whenText = when(new Date(b.start), b.tz || PACIFIC);
  b.status = 'cancelled'; g.cancelled = true; g.cancel_reason = 'unsigned'; g.cancelled_at = new Date().toISOString();
  g.log.push(`${g.cancelled_at.slice(0, 16)} cancelled: agreement unsigned at the deadline`);
  await sendKind(g, 'cancelled_unsigned', `cancelled_unsigned:${b.uid}`, { when: whenText });
  await notifyTerry(`Life on Words: ${g.name}'s session was cancelled (agreement unsigned)`, `${g.name} <${g.email}> had not signed by the deadline, so the session on ${whenText} was cancelled and they were emailed.\n${notes.join('\n')}\n${HUB}/podcast`);
  return notes;
}

async function feedTitles() {
  try { const r = await fetch('https://terryheath.com/podcast/rss/', { signal: AbortSignal.timeout(15000) }); const x = await r.text(); return [...x.matchAll(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)].map((m) => m[1]); } catch { return []; }
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
    // an unsigned guest whose deadline has passed loses the session (rule: signed before the one-week reminder time)
    const dl = deadlineFor(g);
    if (dl && dl <= now && g.agreement && g.agreement.status !== 'signed' && new Date(g.booking.start) > now) {
      if (!dry) await cancelUnsigned(g); did.push(`cancelled unsigned ${g.name}`);
      continue;
    }
    // session reminders: one week before, two days before, the morning of (each at most once per booking); only guests who have signed
    const b = g.booking;
    if (b && b.status === 'booked' && !g.cancelled && new Date(b.start) > now && g.agreement && g.agreement.status === 'signed') {
      const t = reminderTimes(b.start, b.tz || PACIFIC, b.created_at);
      for (const [key, kind] of [['week', 'week_before'], ['two_days', 'two_days'], ['morning', 'morning_of']]) {
        const due = t[key];
        if (!due || due > now || now - due > 48 * 3600e3 || g.reminders[`${key}:${b.uid}`]) continue; // never send one that is more than 2 days stale
        if (!dry) await sendKind(g, kind, `${key}:${b.uid}`); did.push(`${key} ${g.name}`);
      }
    }
    // published: an episode in the feed carries the guest's name (Terry can override on /podcast)
    if (!g.pipeline_manual && g.pipeline !== 'published' && g.name.length > 3 && titles.some((t) => t.includes(g.name.toLowerCase()))) { g.pipeline = 'published'; did.push(`published ${g.name}`); }
  }
  if (!dry) await save(store);
  return did;
}

module.exports = { firstKind, sendUpdatedAgreement, deadlineFor, cancelUnsigned, calCancel, invite, sendFirst, link, handleCal, runHourly, CAL_EVENT_URL, notifyTerry, PAGE, HUB, PACIFIC, load, save, newGuest, firstName, zonedInstant, localYmd, localHour, shiftYmd, when, reminderTimes, render, fill, varsFor, sendMail, sendKind, createAgreement, refreshAgreement, signedPdfUrl, TEMPLATE_NAME };
