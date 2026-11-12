// Automatic refund of the Duosuma submission fee when a contributor agreement is signed (2026-11-12).
//
// How Duosuma charges look in Stripe (Inkhorn Review account): every charge has metadata {SubToken}, the payer's email in billing_details.email,
// and a description "Fee for Inkhorn Review: <call>" (the required submission fee) or "Tip for Inkhorn Review: <call>" (the optional tip).
// The description prefix is the ONLY thing that tells them apart (a $5 fee and a $5 tip look the same otherwise), so only charges whose description
// starts with "Fee for " are ever refunded, and a tip is never touched. Matching is by the contributor's email.
//
// Rules: one refund per Stripe charge (idempotency key + a fresh check that nothing has been refunded), full amount of that fee only, no email to the
// writer. Anything not certain (no charge, several candidates, odd amount, already refunded, failed charge) is flagged on the payouts page with a
// "Refund fee" button instead of guessed. Needs STRIPE_SECRET_KEY (Railway variable; locally Keychain `stripe-inkhorn-press`).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FEE_AMOUNTS = new Set([300, 400, 500]); // cents: every fee Duosuma has charged so far, and the new $5 fee
const stripeKey = () => process.env.STRIPE_SECRET_KEY || execSync('security find-generic-password -s stripe-inkhorn-press -w', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();

async function stripe(method, p, body, idem) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idem) headers['Idempotency-Key'] = idem;
  const res = await fetch('https://api.stripe.com/v1' + p, { method, headers, body: body ? new URLSearchParams(body).toString() : undefined });
  const j = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${p} -> ${res.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// All Duosuma charges (those with a SubToken), newest first.
async function duosumaCharges() {
  const out = []; let after = '';
  for (let i = 0; i < 50; i++) {
    const j = await stripe('GET', `/charges?limit=100${after}`);
    out.push(...j.data);
    if (!j.has_more) break;
    after = `&starting_after=${j.data[j.data.length - 1].id}`;
  }
  return out.filter((c) => c.metadata && c.metadata.SubToken).map((c) => ({
    id: c.id, amount: c.amount, status: c.status, refunded: c.amount_refunded || 0, created: c.created, desc: c.description || '', token: c.metadata.SubToken,
    email: String((c.billing_details && c.billing_details.email) || c.receipt_email || '').trim().toLowerCase(),
    kind: /^Fee for /.test(c.description || '') ? 'fee' : /^Tip for /.test(c.description || '') ? 'tip' : 'unknown',
  }));
}

// Which kind of call a fee charge belongs to, for narrowing several candidates (the call name is in the description).
const callType = (desc) => (/Poetry/i.test(desc) ? 'poetry' : /Micro|Prose|Fiction/i.test(desc) ? 'fiction' : /Artwork/i.test(desc) ? 'art' : /Nonfiction/i.test(desc) ? 'nonfiction' : '');
let editions = null;
function pieceGenre(rec) {
  try {
    editions = editions || JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'editions-2026.json'), 'utf8')).pieces;
    const p = editions.find((x) => x.edition === rec.issue && x.title === rec.title);
    return p ? String(p.genre || '').toLowerCase() : '';
  } catch { return ''; }
}
const genreToCall = (g) => (/poe/.test(g) ? 'poetry' : /fiction|micro|flash|prose/.test(g) ? 'fiction' : /art/.test(g) ? 'art' : /nonfiction|essay/.test(g) ? 'nonfiction' : '');

// Decides what to do for one tracker record. Returns { state, charge?, candidates?, reason }:
//   done      already refunded (record.refund exists)
//   refund    exactly one certain fee charge: safe to refund
//   flag      not certain: show the "Refund fee" button on the payouts page (candidates listed)
function evaluate(rec, charges) {
  if (rec.refund) return { state: 'done', reason: 'already refunded' };
  const email = String(rec.email || '').trim().toLowerCase();
  const mine = charges.filter((c) => c.email === email);
  const fees = mine.filter((c) => c.kind === 'fee');
  if (!fees.length) return { state: 'flag', kind: 'nocharge', candidates: [], reason: mine.length ? `only tips found for ${email} (no fee charge); likely a free call` : `no Duosuma charge found for ${email}; likely a free call, or the fee was paid from another email` };
  let cand = fees;
  const want = genreToCall(pieceGenre(rec));
  if (cand.length > 1 && want) { const n = cand.filter((c) => callType(c.desc) === want); if (n.length) cand = n; }
  if (cand.length > 1) return { state: 'flag', candidates: cand, reason: `${cand.length} fee charges for ${email}; pick the right one` };
  const c = cand[0];
  if (c.status !== 'succeeded') return { state: 'flag', candidates: [c], reason: `fee charge ${c.id} did not succeed (${c.status})` };
  if (c.refunded > 0) return { state: 'flag', candidates: [c], reason: `fee charge ${c.id} already has $${(c.refunded / 100).toFixed(2)} refunded in Stripe` };
  if (!FEE_AMOUNTS.has(c.amount)) return { state: 'flag', candidates: [c], reason: `fee charge ${c.id} is $${(c.amount / 100).toFixed(2)}, which is not a known fee amount` };
  const dupToken = charges.filter((x) => x.token === c.token && x.kind === 'fee').length > 1;
  if (dupToken) return { state: 'flag', candidates: charges.filter((x) => x.token === c.token && x.kind === 'fee'), reason: `two fee charges share submission token ${c.token}` };
  return { state: 'refund', charge: c, reason: 'one fee charge matches' };
}

// Refunds one fee charge in full. Idempotent: the Stripe idempotency key is per charge, the charge is re-read first, and tips are refused.
async function refundCharge(chargeId, meta = {}) {
  const c = await stripe('GET', `/charges/${chargeId}`);
  if (!/^Fee for /.test(c.description || '')) throw new Error(`${chargeId} is not a fee charge (description "${c.description}"); tips are never refunded`);
  if (!c.metadata || !c.metadata.SubToken) throw new Error(`${chargeId} is not a Duosuma charge`);
  if (c.status !== 'succeeded') throw new Error(`${chargeId} did not succeed`);
  if (c.amount_refunded > 0 || c.refunded) throw new Error(`${chargeId} is already refunded`);
  const r = await stripe('POST', '/refunds', { charge: chargeId, reason: 'requested_by_customer', 'metadata[source]': 'inkhorn-fee-refund', 'metadata[sub_token]': c.metadata.SubToken, 'metadata[how]': meta.how || 'auto' }, `inkhorn-fee-refund-${chargeId}`);
  return { charge: chargeId, refund_id: r.id, amount: r.amount, date: new Date().toISOString().slice(0, 10), by: meta.how || 'auto', status: r.status };
}

const sameSubmission = (a, b) => a.submission_id === b.submission_id; // pieces sent on one agreement are one submission

// Processes the records in `todo` (signed, no refund yet). Mutates records (refund / refund_flag / refund_dismissed); the caller saves the tracker.
// opts.dry: decide only. Returns one result row per record: { rec, action: 'refunded'|'would refund'|'covered'|'flagged'|'skipped', detail }.
async function processRecords(records, todo, { dry = false, charges } = {}) {
  charges = charges || (await duosumaCharges());
  const out = [];
  for (const rec of todo) {
    if (rec.refund || rec.refund_dismissed) { out.push({ rec, action: 'skipped', detail: rec.refund ? 'already refunded' : 'dismissed' }); continue; }
    const sib = records.find((x) => x !== rec && sameSubmission(x, rec) && x.refund && !x.refund.covered_by);
    if (sib) { if (!dry) rec.refund = { ...sib.refund, covered_by: sib.title }; out.push({ rec, action: 'covered', detail: `same submission as "${sib.title}", refunded once (${sib.refund.refund_id})` }); continue; }
    const ev = evaluate(rec, charges);
    if (ev.state === 'refund') {
      // another record of the same contributor may already have claimed this very charge
      const claimed = records.find((x) => x !== rec && x.refund && x.refund.charge === ev.charge.id);
      if (claimed) { if (!dry) rec.refund = { ...claimed.refund, covered_by: claimed.title }; out.push({ rec, action: 'covered', detail: `charge ${ev.charge.id} already refunded for "${claimed.title}"` }); continue; }
      if (dry) { out.push({ rec, action: 'would refund', detail: `${ev.charge.id} $${(ev.charge.amount / 100).toFixed(2)} ${ev.charge.desc}` }); continue; }
      try { rec.refund = await refundCharge(ev.charge.id, { how: 'auto' }); delete rec.refund_flag; out.push({ rec, action: 'refunded', detail: `${rec.refund.refund_id} $${(rec.refund.amount / 100).toFixed(2)} (${ev.charge.id})` }); }
      catch (e) { rec.refund_flag = { kind: 'check', reason: e.message, candidates: [ev.charge.id], at: new Date().toISOString().slice(0, 10) }; out.push({ rec, action: 'flagged', detail: e.message }); }
    } else {
      if (!dry) rec.refund_flag = { kind: ev.kind || 'check', reason: ev.reason, candidates: ev.candidates.map((c) => c.id), at: new Date().toISOString().slice(0, 10) };
      out.push({ rec, action: 'flagged', detail: ev.reason });
    }
  }
  return out;
}

const needsCheck = (r) => r.status === 'signed' && !r.refund && !r.refund_dismissed && !r.refund_flag;

module.exports = { stripe, duosumaCharges, evaluate, refundCharge, processRecords, needsCheck, FEE_AMOUNTS };
