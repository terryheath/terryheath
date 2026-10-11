'use strict';

const cfg = require('./config');
const { db, tx, logEvent } = require('./db');
const links = require('./links');
const catalog = require('./catalog');
const { sendEmail } = require('./mail');

const REFUND_LINE = "Ebooks can't be refunded once downloaded.";

// ── Reading a Stripe session ────────────────────────────────────────────────

// session must be retrieved with expand: ['line_items', 'line_items.data.price.product']
function productLines(session) {
  const out = [];
  const data = (session.line_items && session.line_items.data) || [];
  data.forEach((li, index) => {
    const product = li.price && li.price.product;
    if (!product || typeof product === 'string') return;
    const { sku, format } = product.metadata || {};
    if (!sku || !format) return; // shipping line etc.
    out.push({ index, product, sku, format, quantity: li.quantity || 1, name: product.name });
  });
  return out;
}

// ── Recording an order and its ebook links ──────────────────────────────────

// Idempotent: a repeat webhook (or an import of an order already seen) changes nothing.
async function recordSession(session, { imported = false } = {}) {
  const lines = productLines(session);
  const ebooks = lines.filter((l) => l.format === 'ebook');

  // Release lookups can fail (Ghost down), so do them before touching the database
  for (const l of ebooks) {
    l.releaseAt = await catalog.releaseAt(l.sku, l.product.metadata.release_at);
  }

  const now = new Date().toISOString();
  tx(() => {
    db.prepare(`
      INSERT OR IGNORE INTO orders (session_id, payment_intent, email, name, livemode, ordered_at, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent && session.payment_intent.id,
      (session.customer_details && session.customer_details.email) || '',
      (session.customer_details && session.customer_details.name) || null,
      session.livemode ? 1 : 0,
      new Date(session.created * 1000).toISOString(),
      now,
    );

    for (const l of ebooks) {
      // One link per copy; the cart only allows 1, but an older order could have more
      for (let unit = 0; unit < l.quantity; unit++) {
        const id = links.createLink({
          sessionId: session.id,
          lineIndex: l.index * 100 + unit,
          productId: l.product.id,
          sku: l.sku,
          title: l.name,
          fileKey: l.product.metadata.file_epub,
          releaseAt: l.releaseAt,
          active: !l.releaseAt,
        });
        if (id && imported) {
          // Backfilled orders: the owner sends the email by hand, so keep the sweep from sending it
          db.prepare('UPDATE links SET emailed_at = ? WHERE id = ?').run(now, id);
          logEvent('imported', { sessionId: session.id, linkId: id });
        }
        if (id && !l.product.metadata.file_epub) {
          console.error(`order ${session.id}: product ${l.product.id} has no file_epub`);
        }
      }
    }
  });
}

// ── Email text ──────────────────────────────────────────────────────────────

function greeting(name) {
  const first = (name || '').trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hello,';
}

function purchaseEmail(session, lines, ebookLinks) {
  const name = session.customer_details && session.customer_details.name;
  let body = `${greeting(name)}\n\nThank you for your order from Inkhorn Review.\n\nOrder summary:\n`;
  for (const l of lines) {
    let note = '';
    if (l.format === 'ebook') {
      const pending = ebookLinks.find((k) => k.sku === l.sku && k.status === 'pending');
      if (pending) note = ` [Your ebook will be emailed to you on ${catalog.formatDate(new Date(pending.release_at))}]`;
    } else if (l.preorder) {
      note = ' [Preorder — ships on release]';
    }
    body += `  - ${l.name} (${l.format})${note} x${l.quantity}\n`;
  }
  body += `\nTotal: $${((session.amount_total || 0) / 100).toFixed(2)}\n`;

  if (lines.some((l) => l.format === 'ebook' && !ebookLinks.some((k) => k.sku === l.sku && k.status === 'pending'))) {
    body += `\nYour ebook download link is in a separate email from hello@inkhornreview.com.\n`;
  }
  if (lines.some((l) => l.format === 'print')) {
    body += `\nYour print order ships to U.S. addresses only. `;
    if (lines.some((l) => l.preorder && l.format === 'print')) body += `Preordered items ship on the release date.\n`;
  }
  body += `\nIf you have any questions, just reply to this email.\n\nInkhorn Review\n${cfg.siteUrl}`;
  return { subject: 'Your Inkhorn Review order', body };
}

function staffEmail(session, lines, ebookLinks, buyerEmail) {
  let body = `New order on Inkhorn Review\n\nSession: ${session.id}${session.livemode ? '' : ' (TEST MODE)'}\n\nItems:\n`;
  for (const l of lines) {
    body += `  - ${l.name} (${l.format})${l.preorder ? ' [PREORDER]' : ''} x${l.quantity}\n`;
  }
  for (const k of ebookLinks) {
    body += k.status === 'pending'
      ? `  ebook link for ${k.title}: held until ${new Date(k.release_at).toISOString()}\n`
      : `  ebook link for ${k.title}: sent\n`;
    if (!k.file_key) body += `  !! ${k.title} has no file configured (file_epub), so its link cannot download\n`;
  }
  body += `\nTotal: $${((session.amount_total || 0) / 100).toFixed(2)} ${(session.currency || '').toUpperCase()}\n`;
  const shipping = session.shipping_details;
  if (shipping && shipping.name) {
    const a = shipping.address || {};
    body += `\nShipping to:\n  ${shipping.name}\n  ${a.line1}${a.line2 ? ', ' + a.line2 : ''}\n  ${a.city}, ${a.state} ${a.postal_code}\n  ${a.country}\n`;
  }
  body += `\nBuyer: ${buyerEmail}\n\nhttps://dashboard.stripe.com/${session.livemode ? '' : 'test/'}payments/${session.payment_intent}`;
  return { subject: `New order — ${lines.map((l) => l.name).join(', ')}`, body };
}

const bookTitle = (t) => String(t).replace(/\s*e-?book$/i, '');

function deliveryEmail(name, linkRows) {
  const one = linkRows.length === 1;
  let body = `${greeting(name)}\n\nThank you for your order. ` +
    (one ? `Your ebook, ${bookTitle(linkRows[0].title)}, is ready:\n\n` : `Your ebooks are ready:\n\n`);
  for (const l of linkRows) {
    body += one ? `${links.urlFor(l.id)}\n` : `${bookTitle(l.title)}\n${links.urlFor(l.id)}\n\n`;
  }
  body += `\nThe link works for ${cfg.linkDays} days and for up to ${cfg.maxDownloads} downloads. ` +
    `If it stops working, reply to this email and we'll send a new one.\n\n${REFUND_LINE}\n\nInkhorn Review\n${cfg.siteUrl}`;
  return { subject: one ? 'Your Inkhorn Review ebook' : 'Your Inkhorn Review ebooks', body };
}

// ── Sending ─────────────────────────────────────────────────────────────────

async function sendPurchaseEmails(session) {
  const order = db.prepare('SELECT * FROM orders WHERE session_id = ?').get(session.id);
  if (!order || !order.email) return;
  const lines = productLines(session);
  for (const l of lines) {
    if (l.format === 'print') l.preorder = await catalog.isPreorder(l.sku, l.product.metadata);
  }
  const ebookLinks = db.prepare(`SELECT * FROM links WHERE session_id = ? AND original = 1`).all(session.id);

  if (!order.purchase_email_at) {
    const m = purchaseEmail(session, lines, ebookLinks);
    await sendEmail({ from: cfg.fromOrders, to: order.email, subject: m.subject, body: m.body });
    db.prepare('UPDATE orders SET purchase_email_at = ? WHERE session_id = ?').run(new Date().toISOString(), session.id);
  }
  if (!order.staff_email_at) {
    const m = staffEmail(session, lines, ebookLinks, order.email);
    await sendEmail({ from: cfg.fromOrders, to: cfg.staffTo, subject: m.subject, body: m.body });
    db.prepare('UPDATE orders SET staff_email_at = ? WHERE session_id = ?').run(new Date().toISOString(), session.id);
  }
}

// Emails every active link that has not been sent yet, one email per order.
// Also the retry path: anything that failed to send is picked up on the next call.
async function deliverPending() {
  const rows = db.prepare(`
    SELECT l.*, o.email AS buyer_email, o.name AS buyer_name, o.purchase_email_at
      FROM links l JOIN orders o ON o.session_id = l.session_id
     WHERE l.status = 'active' AND l.emailed_at IS NULL AND o.email != ''
     ORDER BY l.created_at
  `).all();
  const bySession = new Map();
  for (const r of rows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, []);
    bySession.get(r.session_id).push(r);
  }
  let sent = 0;
  for (const [sessionId, group] of bySession) {
    // The purchase email goes first so the buyer reads "order" before "download"
    if (!group[0].purchase_email_at) continue;
    try {
      const m = deliveryEmail(group[0].buyer_name, group);
      await sendEmail({ from: cfg.fromDelivery, to: group[0].buyer_email, subject: m.subject, body: m.body });
      const now = new Date().toISOString();
      for (const l of group) {
        db.prepare('UPDATE links SET emailed_at = ? WHERE id = ?').run(now, l.id);
        logEvent('link_emailed', { sessionId, linkId: l.id });
      }
      sent++;
    } catch (err) {
      console.error(`delivery email failed for ${sessionId}:`, err.message);
    }
  }
  return sent;
}

// Resend one link's email (admin). Same link, same expiry.
async function resendLink(id) {
  const link = links.getLink(id);
  const order = link && db.prepare('SELECT * FROM orders WHERE session_id = ?').get(link.session_id);
  if (!order) throw new Error('link not found');
  if (links.state(link) !== 'ok') throw new Error('link is not usable, so reissue it instead');
  const m = deliveryEmail(order.name, [link]);
  await sendEmail({ from: cfg.fromDelivery, to: order.email, subject: m.subject, body: m.body });
  logEvent('link_resent', { sessionId: link.session_id, linkId: id });
}

// Replace a link with a fresh one (new 30 days, new 5 downloads) and email it.
async function reissueLink(id, { send = true } = {}) {
  const old = links.getLink(id);
  const order = old && db.prepare('SELECT * FROM orders WHERE session_id = ?').get(old.session_id);
  if (!order) throw new Error('link not found');
  if (old.status === 'pending') throw new Error('this ebook has not been released yet');

  const newId = tx(() => {
    const created = links.createLink({
      sessionId: old.session_id, lineIndex: old.line_index, original: 0,
      productId: old.product_id, sku: old.sku, title: old.title, fileKey: old.file_key,
      releaseAt: null, active: true,
    });
    if (old.status !== 'revoked') links.revoke(old.id, created);
    else db.prepare('UPDATE links SET replaced_by = ? WHERE id = ?').run(created, old.id);
    return created;
  });
  if (send) {
    const fresh = links.getLink(newId);
    const m = deliveryEmail(order.name, [fresh]);
    await sendEmail({ from: cfg.fromDelivery, to: order.email, subject: m.subject, body: m.body });
    db.prepare('UPDATE links SET emailed_at = ? WHERE id = ?').run(new Date().toISOString(), newId);
    logEvent('link_emailed', { sessionId: old.session_id, linkId: newId });
  } else {
    db.prepare('UPDATE links SET emailed_at = ? WHERE id = ?').run(new Date().toISOString(), newId);
  }
  return newId;
}

// Webhook entry point. Throws on failure so Stripe retries; repeating is harmless.
async function handleCompletedSession(session) {
  if (session.payment_status !== 'paid') {
    console.log(`session ${session.id}: payment_status ${session.payment_status}, nothing to do`);
    return;
  }
  const buyerEmail = session.customer_details && session.customer_details.email;
  if (!buyerEmail) {
    console.warn('No buyer email on session', session.id);
    return;
  }
  await recordSession(session);
  await sendPurchaseEmails(session);
  await deliverPending();
}

module.exports = {
  bookTitle, productLines, recordSession, sendPurchaseEmails, deliverPending, resendLink, reissueLink,
  handleCompletedSession, deliveryEmail, REFUND_LINE,
};
