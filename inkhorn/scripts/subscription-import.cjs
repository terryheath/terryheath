#!/usr/bin/env node
/**
 * Copies Ghost's paid and complimentary members into the shop service's subscription store (idempotent).
 *   node inkhorn/scripts/subscription-import.cjs [--dry]
 * Paid members keep their existing Stripe subscription (nothing is re-subscribed or cancelled); complimentary Print/Ebook members keep their tier and expiry.
 * Env: SHOP_SERVICE_URL (default the Railway address). Keychain: inkhorn-member-api-token plus the Ghost items.
 */
const { execSync } = require('child_process');
const L = require('../agreements-lib.cjs');
const DRY = process.argv.includes('--dry');
const SHOP = (process.env.SHOP_SERVICE_URL || 'https://inkhorn-shop-service-production.up.railway.app').replace(/\/$/, '');
const TOKEN = process.env.MEMBER_API_TOKEN || execSync('security find-generic-password -s inkhorn-member-api-token -w').toString().trim();
(async () => {
  const out = [];
  for (const status of ['paid', 'comped']) {
    const r = await L.gfetch('GET', `/members/?limit=all&filter=${encodeURIComponent('status:' + status)}&include=tiers,subscriptions`);
    for (const m of r.members) {
      const subs = (m.subscriptions || []).filter((s) => ['active', 'trialing', 'past_due'].includes(s.status) && String(s.id).startsWith('sub_')); // complimentary ones have an empty id
      const tiers = (m.tiers || []).filter((t) => /^(Ebook|Print)$/i.test(t.name));
      for (const t of tiers) {
        const kind = t.name.toLowerCase();
        const sub = subs.find((s) => s.tier && s.tier.id === t.id) || subs[0] || null;
        out.push({ email: m.email, name: m.name, publication: 'review', kind, source: sub ? 'stripe' : 'comp', status: 'active',
          until: sub ? (sub.current_period_end || null) : (t.expiry_at || ((m.subscriptions || [])[0] || {}).current_period_end || null), stripe_subscription: sub ? sub.id : null, stripe_customer: sub && sub.customer ? sub.customer.id : null,
          ref: sub ? null : 'ghost:' + m.id, note: sub ? null : 'Subscription taken in place of payment (carried over from Ghost)' });
      }
      if (!tiers.length) console.log('no Ebook/Print tier:', m.email, status, (m.tiers || []).map((t) => t.name).join(','));
    }
  }
  console.log(out.length, 'subscriptions:', out.map((o) => `${o.email} ${o.kind} ${o.source} ${o.until || ''}`).join('\n  '));
  if (DRY) return;
  const res = await fetch(SHOP + '/subscription/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Member-Token': TOKEN }, body: JSON.stringify({ members: out }) });
  console.log(res.status, await res.text());
})().catch((e) => { console.error(e.message); process.exit(1); });
