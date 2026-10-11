'use strict';

const cfg = require('./config');
const { db } = require('./db');
const links = require('./links');
const catalog = require('./catalog');
const orders = require('./orders');
const { sendEmail } = require('./mail');

let running = false;

// Releases held (preorder) links whose title has reached its release time, and sends
// every link email still waiting (which is also the retry path for failed sends).
async function runRelease() {
  if (running) return { released: 0, sent: 0 };
  running = true;
  try {
    const pending = db.prepare(`SELECT * FROM links WHERE status = 'pending'`).all();
    const bySku = new Map();
    for (const p of pending) {
      if (!bySku.has(p.sku)) bySku.set(p.sku, []);
      bySku.get(p.sku).push(p);
    }

    const released = [];
    for (const [sku, rows] of bySku) {
      let stillFuture;
      try {
        stillFuture = await catalog.releaseAt(sku, rows[0].release_at);
      } catch (err) {
        console.error(`release check for ${sku} failed:`, err.message);
        continue; // never release early on an error
      }
      if (stillFuture) continue;
      for (const row of rows) {
        links.activate(row.id);
        released.push(row);
      }
    }

    const sent = await orders.deliverPending();

    if (released.length) {
      const titles = [...new Set(released.map((r) => orders.bookTitle(r.title)))].join(', ');
      try {
        await sendEmail({
          from: cfg.fromOrders, to: cfg.staffTo,
          subject: `Ebook released — ${titles}`,
          body: `${released.length} preorder ebook link(s) released for ${titles}.\n${sent} delivery email(s) sent.\n`,
        });
      } catch (err) {
        console.error('release summary email failed:', err.message);
      }
      console.log(`released ${released.length} link(s) for ${titles}; ${sent} email(s) sent`);
    }
    return { released: released.length, sent };
  } finally {
    running = false;
  }
}

function startReleaseJob() {
  const tick = () => runRelease().catch((err) => console.error('release job error:', err.message));
  setTimeout(tick, 10 * 1000);
  setInterval(tick, 60 * 1000);
}

module.exports = { runRelease, startReleaseJob };
