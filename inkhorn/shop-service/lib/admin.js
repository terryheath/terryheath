'use strict';

const crypto = require('crypto');
const express = require('express');
const cfg = require('./config');
const { db } = require('./db');
const links = require('./links');
const orders = require('./orders');
const { runRelease } = require('./release');
const { headFile } = require('./storage');
const { esc, page, rateLimit } = require('./web');

function pt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// Failed logins only: 10 per 15 minutes per IP
const failures = new Map();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  return f && Date.now() - f.start < 15 * 60 * 1000 && f.n >= 10;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.start >= 15 * 60 * 1000) failures.set(ip, { start: Date.now(), n: 1 });
  else f.n++;
}

function adminRouter({ stripe, listEbookProducts }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    if (!cfg.adminPassword) return res.status(404).type('text/plain').send('Not found');
    if (tooManyFailures(req.ip)) return res.status(429).type('text/plain').send('Too many attempts. Try again later.');
    const header = req.get('authorization') || '';
    const m = /^Basic (.+)$/.exec(header);
    const given = m ? Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':') : null;
    if (given === null || !safeEqual(given, cfg.adminPassword)) {
      if (m) recordFailure(req.ip);
      res.set('WWW-Authenticate', 'Basic realm="Inkhorn shop admin", charset="UTF-8"');
      return res.status(401).type('text/plain').send('Authentication required');
    }
    next();
  });
  router.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));
  router.use(express.urlencoded({ extended: false }));

  // Browsers attach Basic credentials to cross-site form posts, so only accept same-origin posts.
  router.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const site = req.get('sec-fetch-site');
    const origin = req.get('origin');
    const ok = site ? ['same-origin', 'none'].includes(site) : (origin && new URL(origin).host === req.get('host'));
    if (!ok) return res.status(403).type('text/plain').send('Cross-site request refused');
    next();
  });

  const back = (res, sessionId, note) => res.redirect(303, `/admin/order/${encodeURIComponent(sessionId)}${note ? '?note=' + encodeURIComponent(note) : ''}`);

  function orderRows(where, params) {
    return db.prepare(`
      SELECT o.*, (SELECT COUNT(*) FROM links l WHERE l.session_id = o.session_id) AS n_links,
             (SELECT COUNT(*) FROM downloads d JOIN links l ON l.id = d.link_id WHERE l.session_id = o.session_id) AS n_downloads
        FROM orders o ${where} ORDER BY o.ordered_at DESC LIMIT 50`).all(...params);
  }

  function orderTable(rows) {
    if (!rows.length) return '<p class="small">No orders.</p>';
    return `<table>${'<tr><th>Ordered</th><th>Buyer</th><th>Ebook links</th><th>Downloaded</th></tr>'}${rows.map((o) =>
      `<tr><td>${esc(pt(o.ordered_at))}</td><td><a href="/admin/order/${encodeURIComponent(o.session_id)}">${esc(o.email)}</a>${o.livemode ? '' : ' <em>(test)</em>'}</td>` +
      `<td>${o.n_links}</td><td>${o.n_downloads ? 'yes (' + o.n_downloads + ')' : 'no'}</td></tr>`).join('')}</table>`;
  }

  const LAYOUT_CSS = `<style>table{border-collapse:collapse;width:100%;font:15px sans-serif}td,th{border-bottom:1px solid #d6cdbd;padding:6px 8px;text-align:left;vertical-align:top}
  main{max-width:860px!important}input[type=text],textarea{font:14px monospace;width:100%;box-sizing:border-box}form.inline{display:inline}
  button{margin:2px 4px 2px 0;padding:7px 14px!important;font-size:14px!important}.warn{background:#fff3cd;padding:10px 14px;font:15px sans-serif}.ok{background:#e4f1e4;padding:10px 14px;font:15px sans-serif}</style>`;

  router.get('/', (req, res) => {
    res.type('html').send(page('Shop admin', `${LAYOUT_CSS}
<h1>Ebook orders</h1>
<form method="get" action="/admin/search"><input type="text" name="q" placeholder="Buyer email or Stripe session id" autofocus> <button>Search</button></form>
<h2>Recent</h2>${orderTable(orderRows('', []))}
<h2>Import an order from Stripe</h2>
<p class="small">For an order the webhook never recorded. It creates the links but sends no email.</p>
<form method="post" action="/admin/import"><input type="text" name="session_id" placeholder="cs_live_… or cs_test_…"> <button>Import</button></form>
<h2>Ebook files</h2>
<p class="small"><a href="/admin/files">Check that every ebook's file is readable</a> (does not count a download).</p>
<h2>Release check</h2>
<form method="post" action="/admin/release-run"><button>Run release check now</button></form>`));
  });

  router.get('/files', async (req, res) => {
    let rows = '';
    try {
      for (const p of await listEbookProducts()) {
        let status;
        if (!p.file_epub) status = '<strong>no file_epub set</strong>';
        else {
          try {
            const h = await headFile(p.file_epub);
            status = h ? `readable (${(h.size / 1048576).toFixed(2)} MB, ${esc(pt(h.modified))})` : '<strong>NOT FOUND</strong>';
          } catch (err) { status = `<strong>error: ${esc(err.name)}</strong>`; }
        }
        rows += `<tr><td>${esc(p.name)}</td><td>${esc(p.file_epub || '')}</td><td>${status}</td></tr>`;
      }
    } catch (err) { rows = `<tr><td colspan="3">Could not load products: ${esc(err.message)}</td></tr>`; }
    res.type('html').send(page('Ebook files', `${LAYOUT_CSS}<p><a href="/admin">&larr; Admin</a></p><h1>Ebook files</h1><table><tr><th>Product</th><th>File key</th><th>Status</th></tr>${rows}</table>`));
  });

  router.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    const rows = q ? orderRows('WHERE o.email LIKE ? OR o.session_id = ?', [`%${q}%`, q]) : [];
    res.type('html').send(page('Search', `${LAYOUT_CSS}<p><a href="/admin">&larr; Admin</a></p><h1>Search: ${esc(q)}</h1>${orderTable(rows)}`));
  });

  router.get('/order/:session', (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE session_id = ?').get(req.params.session);
    if (!o) return res.status(404).type('html').send(page('Not found', `${LAYOUT_CSS}<p><a href="/admin">&larr; Admin</a></p><h1>Order not found</h1>`));
    const rows = db.prepare('SELECT * FROM links WHERE session_id = ? ORDER BY line_index, original DESC, created_at').all(o.session_id);
    const anyDownloaded = rows.some((l) => links.downloadsUsed(l.id) > 0);

    const blocks = rows.map((l) => {
      const st = links.state(l);
      const dls = db.prepare('SELECT * FROM downloads WHERE link_id = ? ORDER BY at').all(l.id);
      const dlText = dls.length
        ? `<strong>Downloaded: yes</strong><br>${dls.map((d) => `${esc(pt(d.at))}${d.completed_at ? '' : ' (did not finish)'}`).join('<br>')}`
        : '<strong>Downloaded: no</strong>';
      const live = st === 'ok';
      const m = live ? orders.deliveryEmail(o.name, [l]) : null;
      return `<section style="border-top:2px solid #2b2722;margin-top:24px;padding-top:8px">
<h3>${esc(orders.bookTitle(l.title))} <small>(${esc(l.original ? 'original link' : 'reissued link')})</small></h3>
<table>
<tr><td>Status</td><td>${esc(st)}${l.status === 'pending' ? ` — held until ${esc(pt(l.release_at))}` : ''}${l.replaced_by ? ' — replaced by a newer link' : ''}</td></tr>
<tr><td>Issued / expires</td><td>${esc(pt(l.issued_at))}${l.expires_at ? ' → ' + esc(pt(l.expires_at)) : ''}</td></tr>
<tr><td>Downloads used</td><td>${links.downloadsUsed(l.id)} of ${l.max_downloads}</td></tr>
<tr><td>Emailed</td><td>${l.emailed_at ? esc(pt(l.emailed_at)) : 'not yet'}</td></tr>
<tr><td>Download history</td><td>${dlText}</td></tr>
${live ? `<tr><td>Link</td><td><input type="text" readonly value="${esc(links.urlFor(l.id))}" onclick="this.select()"></td></tr>` : ''}
</table>
${l.status !== 'pending' ? `<form class="inline" method="post" action="/admin/link/${l.id}/resend"><button ${live ? '' : 'disabled'}>Resend this link</button></form>
<form class="inline" method="post" action="/admin/link/${l.id}/reissue" onsubmit="return confirm('Issue a new link (30 days, 5 downloads) and email it? The old link stops working.')"><button>Reissue (new link, emailed)</button></form>
<form class="inline" method="post" action="/admin/link/${l.id}/reissue-quiet" onsubmit="return confirm('Issue a new link without emailing it?')"><button>Reissue without emailing</button></form>
${l.status === 'active' ? `<form class="inline" method="post" action="/admin/link/${l.id}/revoke" onsubmit="return confirm('Stop this link from working?')"><button>Revoke</button></form>` : ''}` : ''}
${live ? `<details><summary>Email text to copy</summary><textarea rows="12" readonly>Subject: ${esc(m.subject)}\n\n${esc(m.body)}</textarea></details>` : ''}
</section>`;
    }).join('');

    const events = db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY id').all(o.session_id);
    const stripeUrl = `https://dashboard.stripe.com/${o.livemode ? '' : 'test/'}payments/${o.payment_intent}`;
    const note = req.query.note ? `<p class="ok">${esc(req.query.note)}</p>` : '';
    res.type('html').send(page('Order', `${LAYOUT_CSS}
<p><a href="/admin">&larr; Admin</a></p>
<h1>${esc(o.email)}${o.livemode ? '' : ' <em>(test)</em>'}</h1>
${note}
<p class="${anyDownloaded ? 'warn' : 'ok'}">${anyDownloaded
  ? "Downloaded. Ebooks can't be refunded once downloaded."
  : 'Not downloaded yet.'}</p>
<p class="small">Ordered ${esc(pt(o.ordered_at))} · <a href="${esc(stripeUrl)}">Stripe payment</a> · ${esc(o.session_id)}</p>
${blocks || '<p>No ebook links on this order.</p>'}
<h3>History</h3>
<table>${events.map((e) => `<tr><td>${esc(pt(e.at))}</td><td>${esc(e.kind)}</td><td>${esc(e.detail || '')}</td></tr>`).join('')}</table>`));
  });

  router.post('/link/:id/resend', async (req, res) => {
    const l = links.getLink(req.params.id);
    if (!l) return res.status(404).send('Not found');
    try {
      await orders.resendLink(l.id);
      back(res, l.session_id, 'Link re-sent.');
    } catch (err) {
      back(res, l.session_id, `Could not resend: ${err.message}`);
    }
  });

  async function reissue(req, res, send) {
    const l = links.getLink(req.params.id);
    if (!l) return res.status(404).send('Not found');
    try {
      await orders.reissueLink(l.id, { send });
      back(res, l.session_id, send ? 'New link issued and emailed.' : 'New link issued (not emailed).');
    } catch (err) {
      back(res, l.session_id, `Could not reissue: ${err.message}`);
    }
  }
  router.post('/link/:id/reissue', (req, res) => reissue(req, res, true));
  router.post('/link/:id/reissue-quiet', (req, res) => reissue(req, res, false));

  router.post('/link/:id/revoke', (req, res) => {
    const l = links.getLink(req.params.id);
    if (!l) return res.status(404).send('Not found');
    if (l.status === 'active') links.revoke(l.id);
    back(res, l.session_id, 'Link revoked.');
  });

  router.post('/import', async (req, res) => {
    const id = String(req.body.session_id || '').trim();
    try {
      const session = await stripe.checkout.sessions.retrieve(id, { expand: ['line_items', 'line_items.data.price.product'] });
      if (session.payment_status !== 'paid') throw new Error('that session is not paid');
      await orders.recordSession(session, { imported: true });
      back(res, session.id, 'Order imported. No email was sent.');
    } catch (err) {
      res.status(400).type('html').send(page('Import failed', `${LAYOUT_CSS}<p><a href="/admin">&larr; Admin</a></p><h1>Import failed</h1><p>${esc(err.message)}</p>`));
    }
  });

  router.post('/release-run', async (req, res) => {
    const out = await runRelease();
    res.type('html').send(page('Release check', `${LAYOUT_CSS}<p><a href="/admin">&larr; Admin</a></p><h1>Release check</h1><p>${out.released} link(s) released, ${out.sent} email(s) sent.</p>`));
  });

  return router;
}

module.exports = adminRouter;
