// Every email the Life on Words guest system sends, in one place (2026-11-12). Edit the text here; the code only fills in the {placeholders}.
// Placeholders: {first} first name, {note} (invite only) the optional personal note from the Add guest form, placed after the greeting and before "I'd love to have a conversation" as its own paragraph (empty when there is no note), {when} the session date and time in the guest's own time zone (e.g. "Tuesday, December 8 at 9:00 a.m. PST"),
// {old_when} the session's former date, {agreement_url}, {deadline} (the agreement deadline, in their time zone), {deadline_notice} (agreement reminder only: the deadline sentence when they have a booking, else empty), {book_url} (personal booking link; works only once the agreement is signed),
// {studio_url} the Riverside studio, {reschedule_url}, {cancel_url}, {change_lines} (the reschedule and cancel links, or "reply to this email" for the sessions booked before Cal.com).
const STUDIO = 'https://riverside.com/studio/terry-heaths-studio?t=ed9e5caf23549199013b';
const SIGN = '— Terry';
const TIPS = `Click the link a few minutes before your scheduled time. Riverside runs in your browser; there is nothing to download.

Quick tips:
- Use Chrome or Edge (Safari can have issues)
- Headphones help but aren't required
- A quiet space with decent lighting; a window in front of you is ideal
- The conversation runs about one hour`;
const SESSION = `Your session: {when}
Recording link: {studio_url}

${TIPS}

{change_lines}`;

const EMAILS = {
  invite: {
    subject: 'An invitation to Life on Words',
    // Terry's final text (2026-11-12). Plain text: his bold headings and link are written out. {agreement_url} is each guest's own agreement.
    body: `Hi {first},

{note}I'd love to have a conversation with you about your work.

I host a podcast called Life on Words, where I sit down with people who make their living with words: novelists, poets, songwriters, playwrights, composers, and writers of all kinds.

And I'm not interested in asking you the same ten questions everyone else asks.

I want to get into the things that make your work yours.

Where your ideas come from. How you approach your craft. The choices you make. The things you've learned along the way. And perhaps a few things you've never been asked about before.

Think of it as an hour to talk about the work you love, with someone who's genuinely interested in hearing about it.

We've had some wonderful guests on the podcast, including a Grammy-nominated, multi-platinum songwriter, New York Times bestselling authors, a Newbery Honor author, a feature film composer, an off-Broadway playwright, and a television comedy writer.

I'd love to add you to that list.

A few details:

- The conversation takes about an hour.
- We record on video using Riverside, right in your browser. Nothing to install.
- We record on Tuesdays, and you choose a time that works for you.
- Your episode appears on YouTube, Apple Podcasts, and the major podcast platforms.
- Once it's published, I'll send you the links so you can share it.

How to get started:

There's just one thing to take care of first: a short guest agreement.

Sign the guest agreement here: {agreement_url}

It's non-exclusive, and you retain all rights to your work.

Once you've signed, I'll email you your personal booking link so you can choose a Tuesday that suits you.

That's it.

I'd love to have you on.

Terry

Terry Heath
Producer, Life on Words
Follow the Rabbit LLC`,
  },
  agreement_reminder: {
    subject: 'A reminder: your Life on Words guest agreement',
    body: `Hello {first},

A quick reminder that your Life on Words guest agreement is still waiting for your signature. Once it's signed, you can pick a time to record.

{deadline_notice}Sign here: {agreement_url}

${SIGN}`,
  },
  signed: {
    subject: 'Thank you. Now pick your time for Life on Words',
    body: `Hello {first},

Thank you for signing. Now pick a time that suits you; the booking page shows only the times I'm free, in your own time zone:

{book_url}

This link is yours alone, so please don't forward it. If you have questions, just reply to this email.

${SIGN}`,
  },
  booked: {
    subject: 'Your Life on Words session: {when}',
    body: `Hello {first},

You're booked. I'm looking forward to the conversation.

${SESSION}

If anything comes up, reply to this email.

${SIGN}`,
  },
  week_before: {
    subject: 'One week until your Life on Words session',
    body: `Hello {first},

A week from now we'll record your Life on Words conversation.

${SESSION}

${SIGN}`,
  },
  two_days: {
    subject: 'Your Life on Words session is in two days',
    body: `Hello {first},

Your Life on Words session is in two days.

${SESSION}

${SIGN}`,
  },
  morning_of: {
    subject: 'Today: your Life on Words session',
    body: `Good morning, {first},

Your Life on Words session is today.

${SESSION}

I'll be in the studio when you arrive.

${SIGN}`,
  },
  // Sent automatically when a booked session's agreement is still unsigned at the deadline (9:00 a.m. their time, 7 days before the session).
  cancelled_unsigned: {
    subject: 'Your Life on Words session has been cancelled',
    body: `Hello {first},

Your Life on Words session on {when} has been cancelled because the guest agreement wasn't signed in time.

I'd still love to have you on. Whenever you're ready, sign the agreement and pick a new Tuesday:
1. Sign: {agreement_url}
2. Pick a time: {book_url}

${SIGN}`,
  },
  // The five guests whose dates stand (Terry's teaching schedule did not change theirs): the agreement only.
  keep_date: {
    subject: 'Your Life on Words session on {when}: one short agreement first',
    body: `Hello {first},

Your Life on Words session on {when} stands. Before we record, I need you to sign a short guest agreement. It covers publishing the conversation as a podcast and in print, it's non-exclusive, and you keep all rights to your own work.

Please sign by {deadline}. If the agreement isn't signed by then, the session will be cancelled, and you can sign and pick a new time whenever you're ready.

Sign here: {agreement_url}

Your booking details are unchanged:

${SESSION}

${SIGN}`,
  },
  // The five guests whose sessions had to move because of Terry's teaching schedule.
  reschedule_notice: {
    subject: 'Life on Words: I need to move your session (my apologies)',
    body: `Hello {first},

I'm sorry. My teaching schedule changed, and I need to move your Life on Words session, which was set for {old_when}. I'd still love to have you on.

Two steps, in this order:
1. Sign the short guest agreement. It covers publishing the conversation as a podcast and in print, it's non-exclusive, and you keep all rights to your own work: {agreement_url}
2. Then pick a new time. Your personal booking link works as soon as you've signed: {book_url}

If none of the times work, reply and we'll find one together.

${SIGN}`,
  },
  // Sent by "Send updated agreement" (and scripts/send-updated-agreement.cjs) to every guest who has not signed, after the agreement text changes. The old link is archived first.
  agreement_updated: {
    subject: 'An updated Life on Words guest agreement',
    body: `Hi {first},

I've revised the Life on Words guest agreement to make it narrower. It now covers the episode, its promotion, and an edited transcript in Inkhorn Review. Anything else needs your permission, and anything you read stays yours.

Here's the updated agreement: {agreement_url}

The earlier link no longer works.

${SIGN}`,
  },
  // A guest who has already said yes by email: the agreement only (no full invitation). The booking link follows once it is signed.
  agreement_only_accepted: {
    subject: 'Your Life on Words guest agreement',
    body: `Hi {first},

Here's the short guest agreement: {agreement_url}

It's non-exclusive, and you keep all rights to your work. Once it's signed, I'll send your booking link so you can choose a Tuesday that suits you.

${SIGN}`,
  },
};

module.exports = { EMAILS, STUDIO };
