#!/usr/bin/env node
// inkhorn/podcast.cjs: the hourly Life on Words job (Railway cron service "podcast", cron "0 * * * *"). Idempotent: every send is recorded
// on the guest (reminders map) and never repeated. Each run: refreshes agreement status from DocuSeal; sends "signed" (thanks + booking link);
// runs the follow-up tracks for guests with no booking (no response: day 3 reminder, day 10 last note; accepted: day 3, day 10; signed but unbooked:
// day 5, day 14; then No response / Needs Terry and one line to Terry; see podcast-lib.cjs); sends the day-3 agreement reminder to booked guests who have not
// signed; sends the one-week, two-days and morning-of reminders from each guest's booking (the Cal.com webhook keeps bookings current); marks a guest
// "published" when the feed carries their name.
// Env: GHOST_API_URL, GHOST_ADMIN_KEY, DOCUSEAL_TOKEN, SMTP_USERNAME, SMTP_PASSWORD. PODCAST_MODE=dry prints what it would do.
const P = require('./podcast-lib.cjs');
(async () => {
  const dry = (process.env.PODCAST_MODE || '').toLowerCase() === 'dry';
  const did = await P.runHourly({ dry });
  console.log(did.length ? `${dry ? 'would do' : 'did'}: ${did.join('; ')}` : 'nothing due');
})().catch((e) => { console.error(e.message); process.exit(1); });
