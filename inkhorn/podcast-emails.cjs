// Every email the Life on Words guest system sends, in one place (2026-11-12). Edit the text here; the code only fills in the {placeholders}.
// Placeholders: {first} first name, {note} (invite only) the optional personal note from the Add guest form, placed above the opening line as its own paragraph (empty when there is no note), {when} the session date and time in the guest's own time zone (e.g. "Tuesday, December 8 at 9:00 a.m. PST"),
// {old_when} the session's former date, {agreement_url}, {book_url} (personal booking link; works only once the agreement is signed),
// {studio_url} the Riverside studio, {reschedule_url}, {cancel_url}.
const STUDIO = 'https://riverside.com/studio/terry-heaths-studio?t=ed9e5caf23549199013b';
const SIGN = '— Terry\nProduced by Terry Heath and Follow the Rabbit LLC';
const TIPS = `Click the link a few minutes before your scheduled time. Riverside runs in your browser; there is nothing to download.

Quick tips:
- Use Chrome or Edge (Safari can have issues)
- Headphones help but aren't required
- A quiet space with decent lighting; a window in front of you is ideal
- The conversation runs about one hour`;
const SESSION = `Your session: {when}
Recording link: {studio_url}

${TIPS}

Need to change it? Reschedule: {reschedule_url}
Can't make it? Cancel: {cancel_url}`;

const EMAILS = {
  invite: {
    subject: 'An invitation to Life on Words',
    body: `Hello {first},

{note}I'd love to have you as a guest on Life on Words, a long-form conversation with writers about their work. I'm the host and guide; you're the expert. We talk for about an hour (I block 90 minutes so nothing feels rushed). It's a video conversation, recorded in your browser through Riverside, so there's nothing to install.

Two steps:
1. Sign the short guest agreement: {agreement_url}
2. Then pick a time that suits you. Your booking link arrives by email as soon as the agreement is signed.

If you have questions, just reply to this email.

${SIGN}`,
  },
  agreement_reminder: {
    subject: 'A reminder: your Life on Words guest agreement',
    body: `Hello {first},

A quick reminder that your Life on Words guest agreement is still waiting for your signature. Once it's signed, you can pick a time to record.

Sign here: {agreement_url}

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
  // The five guests whose dates stand (Terry's teaching schedule did not change theirs): the agreement only.
  keep_date: {
    subject: 'Your Life on Words session on {when}: one short agreement first',
    body: `Hello {first},

Your Life on Words session on {when} stands. Before we record I need you to sign a short guest agreement; it covers the recording, publishing it, and possible future print collections, and it's non-exclusive and transfers nothing in your own work.

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
1. Sign the short guest agreement (it covers the recording, publishing it, and possible future print collections; it's non-exclusive and transfers nothing in your own work): {agreement_url}
2. Then pick a new time. Your personal booking link works as soon as you've signed: {book_url}

If none of the times work, reply and we'll find one together.

${SIGN}`,
  },
};

module.exports = { EMAILS, STUDIO };
