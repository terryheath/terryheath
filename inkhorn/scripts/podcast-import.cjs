#!/usr/bin/env node
// One-time import of Life on Words sessions into the private podcast-guests page (2026-11-12). The guest list is NOT in this repo (it is public
// and the list holds guests' email addresses): pass the path of a JSON file kept outside the repo:
//   node inkhorn/scripts/podcast-import.cjs /path/to/guests.json
// The file is { "keep": [{name,email,start,created}], "move": [{name,email,old_when}] }:
//   keep = the date stands: start is the session's ISO time (with offset), created is when the calendar event was made (reminders run as normal);
//   move = the session must be rescheduled: old_when is the former date, written as text.
// Guests are created marked pending_send: NOTHING IS SENT. They appear on admin.terryheath.com/podcast under "Ready to send".
const fs = require('fs');
const P = require('../podcast-lib.cjs');

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error('usage: podcast-import.cjs /path/to/guests.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const store = await P.load();
  let added = 0;
  for (const k of data.keep || []) {
    const email = k.email.toLowerCase();
    if (store.guests.find((g) => g.email === email)) continue;
    const g = P.newGuest({ name: k.name, email, kind: 'keep_date' });
    const s = new Date(k.start);
    g.booking = { uid: `imported-${g.id}`, start: s.toISOString(), end: new Date(s.getTime() + 90 * 60000).toISOString(), tz: P.PACIFIC, status: 'booked', created_at: new Date(k.created).toISOString(), imported: true };
    g.pipeline = 'booked';
    g.pending_send = true;
    store.guests.push(g);
    added++;
  }
  for (const m of data.move || []) {
    const email = m.email.toLowerCase();
    if (store.guests.find((g) => g.email === email)) continue;
    const g = P.newGuest({ name: m.name, email, kind: 'reschedule', old_when: m.old_when });
    g.pending_send = true;
    store.guests.push(g);
    added++;
  }
  await P.save(store);
  console.log(`imported ${added} guests (nothing sent); total ${store.guests.length}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
