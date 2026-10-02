'use strict';

/**
 * release-ebook.js — Deliver a preorder ebook to all buyers who haven't received it.
 *
 * Usage: node release-ebook.js <sku>
 *
 * Requires:
 *   STRIPE_SECRET_KEY   — Inkhorn Press restricted key (stripe-inkhorn-press keychain)
 *   AWS_ACCESS_KEY_ID   — SES sender credentials
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION          — e.g. us-east-2
 *
 * Permissions needed on the Stripe restricted key:
 *   - checkout_session_read  (Checkout Sessions: Read)
 *   - payment_intent_write   (Payment Intents: Write — covers read+write)
 *   - products_read          (Products: Read — already present)
 */

const readline = require('readline');
const Stripe = require('stripe');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const sku = process.argv[2];
if (!sku) {
  console.error('Usage: node release-ebook.js <sku>');
  process.exit(1);
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function main() {
  // ── 1. Find the product for this sku + format=ebook ─────────────────────
  console.log(`Looking up ebook product for sku: ${sku}`);
  const products = await stripe.products.list({ active: true, limit: 100 });
  const ebookProduct = products.data.find(
    p => p.metadata.sku === sku && p.metadata.format === 'ebook'
  );

  if (!ebookProduct) {
    console.error(`No active ebook product found for sku "${sku}".`);
    process.exit(1);
  }

  const download_url = ebookProduct.metadata.download_url;
  if (!download_url) {
    console.error(`Product "${ebookProduct.id}" has no download_url. Set it in Stripe before running this script.`);
    process.exit(1);
  }

  const deliveredKey = `ebook_delivered_${sku}`;
  console.log(`Product: ${ebookProduct.name} (${ebookProduct.id})`);
  console.log(`Download URL: ${download_url}`);

  // ── 2. Page through all paid checkout sessions ───────────────────────────
  console.log('\nScanning paid checkout sessions...');
  const pending = []; // { email, sessionId, paymentIntentId }

  let hasMore = true;
  let startingAfter = undefined;

  while (hasMore) {
    const params = {
      limit: 100,
      payment_status: 'paid',
      expand: ['data.line_items', 'data.line_items.data.price.product'],
    };
    if (startingAfter) params.starting_after = startingAfter;

    const page = await stripe.checkout.sessions.list(params);

    for (const session of page.data) {
      // Does this session contain the ebook sku?
      const lineItems = (session.line_items && session.line_items.data) || [];
      const hasEbook = lineItems.some(li => {
        const prod = li.price && li.price.product;
        return prod && typeof prod === 'object' &&
          prod.metadata.sku === sku && prod.metadata.format === 'ebook';
      });

      if (!hasEbook) continue;

      // Check if already delivered via payment intent metadata
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent && session.payment_intent.id;

      if (!paymentIntentId) continue;

      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.metadata[deliveredKey] === 'true') continue; // already sent

      const email = session.customer_details && session.customer_details.email;
      if (!email) continue;

      pending.push({
        email,
        sessionId: session.id,
        paymentIntentId,
        name: session.customer_details.name || email,
      });
    }

    hasMore = page.has_more;
    if (hasMore && page.data.length > 0) {
      startingAfter = page.data[page.data.length - 1].id;
    }
  }

  // ── 3. Show list and wait for confirmation ───────────────────────────────
  if (pending.length === 0) {
    console.log('\nNo pending deliveries found. Everyone has already received the file.');
    process.exit(0);
  }

  console.log(`\n${pending.length} buyer(s) to receive the ebook:\n`);
  for (const b of pending) {
    console.log(`  ${b.email}  (session ${b.sessionId})`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.question('\nSend download links to all of the above? Type "go" to confirm: ', resolve);
  });
  rl.close();

  if (answer.trim().toLowerCase() !== 'go') {
    console.log('Aborted.');
    process.exit(0);
  }

  // ── 4. Email each buyer and mark as delivered ────────────────────────────
  let sent = 0;
  let failed = 0;

  for (const buyer of pending) {
    try {
      const body = `Hi ${buyer.name},\n\nThank you for preordering from Inkhorn Review. Your ebook is now ready.\n\nDownload it here:\n${download_url}\n\nThis link is for your personal use. If you have any trouble, reply to this email.\n\nInkhorn Review\nhttps://inkhornreview.com`;

      await ses.send(new SendEmailCommand({
        Source: 'Inkhorn Review <hello@inkhornreview.com>',
        Destination: { ToAddresses: [buyer.email] },
        Message: {
          Subject: { Data: 'Your Inkhorn Review ebook is ready', Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }));

      // Mark as delivered
      await stripe.paymentIntents.update(buyer.paymentIntentId, {
        metadata: { [deliveredKey]: 'true' },
      });

      console.log(`  ✓ Sent to ${buyer.email}`);
      sent++;
    } catch (err) {
      console.error(`  ✗ Failed for ${buyer.email}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${sent} sent, ${failed} failed.`);
  if (failed > 0) {
    console.log('Re-run the script to retry failed deliveries — already-sent orders are skipped.');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
