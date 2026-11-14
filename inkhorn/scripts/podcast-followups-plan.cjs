// Dry-run list of the Life on Words follow-up tracks: for every guest, the track, the status and the next email with its date (Pacific).
// Read-only: reads the guest tracker and DocuSeal status, sends nothing, saves nothing.  Run: railway run --service podcast node inkhorn/scripts/podcast-followups-plan.cjs
const P = require('../podcast-lib.cjs');
(async () => {
  const store = await P.load();
  for (const g of store.guests) { try { await P.refreshAgreement(g); } catch {} }
  const now = new Date();
  const rows = P.followUpPlan(store.guests, now);
  const fmt = (d) => new Intl.DateTimeFormat('en-US', { timeZone: P.PACIFIC, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
  console.log(`Now: ${fmt(now)}.  Guests on the list: ${store.guests.length} (${store.guests.filter((g) => g.pending_send).length} waiting for their first send, left alone)\n`);
  console.log('Guest'.padEnd(22), 'Track'.padEnd(12), 'Status'.padEnd(12), 'Next email'.padEnd(20), 'When');
  for (const r of rows) {
    const g = r.guest;
    const when = r.next ? fmt(r.next.at) + (r.send ? '  <- DUE NOW' : r.hold ? '  (held 48h)' : '') : '';
    console.log(g.name.slice(0, 21).padEnd(22), (r.track || (P.hasBooking(g) ? 'booked' : '-')).padEnd(12), r.status.padEnd(12), (r.next ? r.next.kind : '-').padEnd(20), when);
  }
  const did = await P.runHourly({ dry: true, now });
  console.log(`\nWhat an hourly run would do right now: ${did.length ? did.join('; ') : 'nothing'}`);
})().catch((e) => { console.error(e); process.exit(1); });
