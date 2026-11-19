'use strict';

// Subscriptions: Stripe subscriptions (Inkhorn Press account) plus complimentary grants from signed agreements.
//   Review Ebook $20/yr, Review Print $48/yr (Print includes the ebook). White Rabbit add-on: Ebook $7/yr, Print $14/yr.
// Prices are looked up by Stripe lookup_key (created by scripts/stripe-subscription-setup.cjs): review-ebook-yearly, review-print-yearly,
// whiterabbit-ebook-yearly, whiterabbit-print-yearly.
const express = require('express');
const crypto = require('crypto');
const cfg = require('./config');
const { db, tx, logEvent } = require('./db');

const KEYS = {
  'review-ebook': ['review', 'ebook', 'review-ebook-yearly'],
  'review-print': ['review', 'print', 'review-print-yearly'],
  'whiterabbit-ebook': ['whiterabbit', 'ebook', 'whiterabbit-ebook-yearly'],
  'whiterabbit-print': ['whiterabbit', 'print', 'whiterabbit-print-yearly'],
};
const BY_LOOKUP = Object.fromEntries(Object.entries(KEYS).map(([id, [pub, kind, lk]]) => [lk, { id, pub, kind }]));
const iso = () => new Date().toISOString();
const norm = (e) => String(e || '').trim().toLowerCase();

function upsertMember(email, name, customer) {
  email = norm(email);
  const ex = db.prepare('SELECT * FROM members WHERE email = ?').get(email);
  if (!ex) db.prepare('INSERT INTO members (email, name, stripe_customer, created_at) VALUES (?, ?, ?, ?)').run(email, name || null, customer || null, iso());
  else db.prepare('UPDATE members SET name = COALESCE(?, name), stripe_customer = COALESCE(?, stripe_customer) WHERE email = ?').run(name || null, customer || null, email);
  return email;
}

/** Records or updates the subscriptions a Stripe subscription carries (one per publication it has an item for). */
function recordSubscription(sub, email) {
  const when = sub.status === 'active' || sub.status === 'trialing' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'canceled';
  const end = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  upsertMember(email, null, typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id);
  let n = 0;
  for (const it of (sub.items && sub.items.data) || []) {
    const lk = it.price && it.price.lookup_key;
    let t = BY_LOOKUP[lk];
    if (!t) { // subscriptions made by Ghost have no lookup key: match by amount (Ebook $20/yr or $2/mo, Print $48/yr or $6/mo)
      const amt = it.price && it.price.unit_amount, iv = it.price && it.price.recurring && it.price.recurring.interval;
      if ((iv === 'year' && amt === 2000) || (iv === 'month' && amt === 200)) t = { id: 'review-ebook', pub: 'review', kind: 'ebook' };
      else if ((iv === 'year' && amt === 4800) || (iv === 'month' && amt === 600)) t = { id: 'review-print', pub: 'review', kind: 'print' };
      else continue;
    }
    const ex = db.prepare('SELECT id FROM subscriptions WHERE stripe_subscription = ? AND publication = ?').get(sub.id, t.pub);
    if (ex) db.prepare('UPDATE subscriptions SET kind = ?, status = ?, period_end = ?, updated_at = ? WHERE id = ?').run(t.kind, when, end, iso(), ex.id);
    else db.prepare('INSERT INTO subscriptions (email, publication, kind, source, stripe_subscription, status, period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(norm(email), t.pub, t.kind, 'stripe', sub.id, when, end, iso(), iso());
    n++;
  }
  return n;
}

/** Complimentary subscription, for a contributor whose signed agreement chose a subscription instead of payment. */
function grantComp({ email, name, publication, kind = 'print', months = 12, ref, note }) {
  if (!['review', 'whiterabbit'].includes(publication) || !['ebook', 'print'].includes(kind)) throw new Error('bad publication or kind');
  const e = upsertMember(email, name);
  const end = new Date(); end.setMonth(end.getMonth() + Number(months));
  return tx(() => {
    const ex = ref ? db.prepare("SELECT id FROM subscriptions WHERE source = 'comp' AND ref = ? AND publication = ?").get(String(ref), publication) : null;
    if (ex) return { id: ex.id, existed: true };
    const r = db.prepare("INSERT INTO subscriptions (email, publication, kind, source, status, period_end, note, ref, created_at, updated_at) VALUES (?, ?, ?, 'comp', 'active', ?, ?, ?, ?, ?)")
      .run(e, publication, kind, end.toISOString(), note || 'Subscription taken in place of payment', ref ? String(ref) : null, iso(), iso());
    logEvent('subscription_comp', { detail: `${e} ${publication} ${kind} until ${end.toISOString().slice(0, 10)}` });
    return { id: Number(r.lastInsertRowid), existed: false, expires: end.toISOString().slice(0, 10) };
  });
}

// ---- Print mailing addresses (U.S. only) ------------------------------------------------------------------------------------------
const STATES = /^(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])$/;
function cleanAddress(a) {
  const t = (x) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const out = { name: t(a.name), line1: t(a.line1 || a.addr1), line2: t(a.line2 || a.addr2), city: t(a.city), state: t(a.state).toUpperCase(), zip: t(a.zip || a.postal_code), country: 'US' };
  if (!out.name || !out.line1 || !out.city || !STATES.test(out.state) || !/^\d{5}(-\d{4})?$/.test(out.zip)) throw new Error('A U.S. address needs a name, street, city, 2-letter state and 5-digit ZIP.');
  return out;
}
function saveAddress(email, a, source) {
  const e = upsertMember(email);
  db.prepare('INSERT INTO addresses (email, json, source, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET json = excluded.json, source = excluded.source, updated_at = excluded.updated_at').run(e, JSON.stringify(cleanAddress(a)), source, iso());
}
const getAddress = (email) => { const r = db.prepare('SELECT json, source, updated_at FROM addresses WHERE email = ?').get(norm(email)); return r ? { ...JSON.parse(r.json), source: r.source, updated_at: r.updated_at } : null; };

function status(email) {
  email = norm(email);
  const now = iso();
  const rows = db.prepare('SELECT * FROM subscriptions WHERE email = ? ORDER BY id').all(email);
  const live = rows.filter((r) => (r.status === 'active' || r.status === 'past_due') && (!r.period_end || r.period_end > now));
  // Print includes the ebook of the same publication
  const has = (pub, kind) => live.some((r) => r.publication === pub && (r.kind === kind || (kind === 'ebook' && r.kind === 'print')));
  return {
    email,
    entitlements: { review_ebook: has('review', 'ebook'), review_print: has('review', 'print'), whiterabbit_ebook: has('whiterabbit', 'ebook'), whiterabbit_print: has('whiterabbit', 'print') },
    subscriptions: rows.map((r) => ({ publication: r.publication, kind: r.kind, source: r.source, status: r.status, until: r.period_end, note: r.note })),
    customer: (db.prepare('SELECT stripe_customer FROM members WHERE email = ?').get(email) || {}).stripe_customer || null,
  };
}

/** Server-to-server auth for WordPress, the agreements cron and the hub: shared token in MEMBER_API_TOKEN. */
function auth(req, res, next) {
  const t = process.env.MEMBER_API_TOKEN;
  const got = String(req.headers['x-member-token'] || '');
  if (!t || got.length !== t.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(t))) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function router(stripe) {
  const r = express.Router();
  const priceFor = async (lookup) => {
    const p = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
    if (!p.data.length) throw new Error('price not set up: ' + lookup);
    return p.data[0].id;
  };

  // Public: start a subscription Checkout. { tier: 'review-ebook'|'review-print', whiterabbit: null|'ebook'|'print', email? }
  r.post('/checkout', async (req, res) => {
    try {
      const { tier, whiterabbit, email } = req.body || {};
      if (!['review-ebook', 'review-print'].includes(tier) && !(tier === 'whiterabbit-ebook' || tier === 'whiterabbit-print')) return res.status(400).json({ error: 'unknown tier' });
      const items = [{ price: await priceFor(KEYS[tier][2]), quantity: 1 }];
      if (whiterabbit && !tier.startsWith('whiterabbit')) {
        if (!['ebook', 'print'].includes(whiterabbit)) return res.status(400).json({ error: 'unknown add-on' });
        items.push({ price: await priceFor(KEYS['whiterabbit-' + whiterabbit][2]), quantity: 1 });
      }
      const wantsPrint = tier.endsWith('print') || whiterabbit === 'print';
      const params = {
        mode: 'subscription', line_items: items, billing_address_collection: 'auto',
        success_url: `${cfg.siteUrl}/account/?subscription=ok`, cancel_url: `${cfg.siteUrl}/shop/subscriptions/`,
        subscription_data: { metadata: { tier, whiterabbit: whiterabbit || '' } },
      };
      if (email) params.customer_email = email;
      if (wantsPrint) { params.shipping_address_collection = { allowed_countries: ['US'] }; params.custom_text = { shipping_address: { message: 'Print copies ship to U.S. addresses only. Outside the U.S., choose the ebook.' } }; }
      if (cfg.automaticTax) params.automatic_tax = { enabled: true };
      const s = await stripe.checkout.sessions.create(params);
      res.json({ url: s.url });
    } catch (err) { console.error('subscription checkout:', err.message); res.status(500).json({ error: 'Checkout failed' }); }
  });

  // Token: Stripe customer portal for a member { email, return_url }
  r.post('/portal', auth, async (req, res) => {
    try {
      const st = status(req.body.email);
      if (!st.customer) return res.status(404).json({ error: 'no Stripe customer for this email' });
      const s = await stripe.billingPortal.sessions.create({ customer: st.customer, return_url: req.body.return_url || `${cfg.siteUrl}/account/` });
      res.json({ url: s.url });
    } catch (err) { console.error('subscription portal:', err.message); res.status(500).json({ error: 'Portal failed' }); }
  });

  r.get('/address', auth, (req, res) => res.json({ address: getAddress(req.query.email) }));
  r.put('/address', auth, (req, res) => { try { saveAddress(req.body.email, req.body.address || {}, 'account'); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
  // Everyone with a live Print subscription for a publication, with the address on file (the print mailing list)
  r.get('/print-list', auth, (req, res) => {
    const pub = req.query.publication === 'whiterabbit' ? 'whiterabbit' : 'review';
    const rows = db.prepare("SELECT DISTINCT s.email, m.name FROM subscriptions s JOIN members m ON m.email = s.email WHERE s.publication = ? AND s.kind = 'print' AND s.status IN ('active','past_due') AND (s.period_end IS NULL OR s.period_end > ?)").all(pub, iso());
    res.json(rows.map((r) => ({ email: r.email, name: r.name, address: getAddress(r.email) })));
  });
  r.get('/status', auth, (req, res) => res.json(status(req.query.email)));
  r.post('/grant', auth, (req, res) => { try { res.json(grantComp(req.body)); } catch (e) { res.status(400).json({ error: e.message }); } });
  r.post('/import', auth, (req, res) => { // body: { members: [{ email, name, publication, kind, source, until, ref, note, stripe_subscription, stripe_customer }] }
    let n = 0;
    for (const m of (req.body && req.body.members) || []) {
      upsertMember(m.email, m.name, m.stripe_customer);
      const ex = db.prepare('SELECT id FROM subscriptions WHERE email = ? AND publication = ? AND kind = ? AND source = ? AND COALESCE(ref, \'\') = ?').get(norm(m.email), m.publication, m.kind, m.source, m.ref || '');
      if (ex) continue;
      db.prepare('INSERT INTO subscriptions (email, publication, kind, source, stripe_subscription, status, period_end, note, ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(norm(m.email), m.publication, m.kind, m.source, m.stripe_subscription || null, m.status || 'active', m.until || null, m.note || null, m.ref || null, iso(), iso());
      n++;
    }
    res.json({ imported: n });
  });
  return r;
}

/** Webhook side: returns true when the event was a subscription event (so the order code leaves it alone). */
async function handleEvent(stripe, event) {
  if (event.type === 'checkout.session.completed' && event.data.object.mode === 'subscription') {
    const s = event.data.object;
    const sub = await stripe.subscriptions.retrieve(s.subscription, { expand: ['items.data.price'] });
    const em = (s.customer_details && s.customer_details.email) || s.customer_email;
    recordSubscription(sub, em);
    const ship = s.shipping_details || (s.collected_information && s.collected_information.shipping_details);
    if (ship && ship.address && em) { try { saveAddress(em, { name: ship.name, line1: ship.address.line1, line2: ship.address.line2, city: ship.address.city, state: ship.address.state, zip: ship.address.postal_code }, 'checkout'); } catch (e) { console.error('address from checkout not saved:', e.message); } }
    return true;
  }
  if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
    const sub = await stripe.subscriptions.retrieve(event.data.object.id, { expand: ['items.data.price'] });
    const c = await stripe.customers.retrieve(typeof sub.customer === 'string' ? sub.customer : sub.customer.id);
    if (c && c.email) recordSubscription(sub, c.email);
    return true;
  }
  return false;
}

module.exports = { saveAddress, getAddress, router, handleEvent, grantComp, status, recordSubscription, upsertMember };
