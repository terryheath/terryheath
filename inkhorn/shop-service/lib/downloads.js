'use strict';

const crypto = require('crypto');
const express = require('express');
const cfg = require('./config');
const links = require('./links');
const { openFile } = require('./storage');
const { rateLimit, esc, page } = require('./web');

const router = express.Router();

const EXPIRED = `<h1>This link has expired.</h1>
<p>Reply to your receipt and we'll send a new one.</p>`;

router.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  next();
});
router.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

function expired(res) {
  res.status(410).type('html').send(page('Link expired', EXPIRED));
}

function fileName(title) {
  const slug = String(title).replace(/\s*e-?book$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'ebook'}.epub`;
}

// Landing page. Opening it never uses up a download (mail scanners and link previews fetch URLs).
router.get('/:token', (req, res) => {
  const id = links.parseToken(req.params.token);
  const link = id && links.getLink(id);
  if (!link || links.state(link) !== 'ok') return expired(res);

  const left = link.max_downloads - links.downloadsUsed(link.id);
  const until = new Date(link.expires_at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' });
  res.type('html').send(page('Your ebook', `
<h1>${esc(link.title.replace(/\s*e-?book$/i, ''))}</h1>
<form method="post" action="/d/${esc(req.params.token)}/epub">
  <button type="submit">Download EPUB</button>
</form>
<p class="small">This link works until ${esc(until)} and for ${left} more download${left === 1 ? '' : 's'}.</p>
<p class="small">Ebooks can't be refunded once downloaded.</p>`));
});

// A plain GET of the file URL goes back to the landing page and counts nothing.
router.get('/:token/epub', (req, res) => res.redirect(303, `/d/${encodeURIComponent(req.params.token)}`));

router.post('/:token/epub', async (req, res) => {
  const id = links.parseToken(req.params.token);
  const link = id && links.getLink(id);
  if (!link || links.state(link) !== 'ok') return expired(res);

  const ipHash = crypto.createHash('sha256').update(cfg.linkSecret + '|' + req.ip).digest('hex').slice(0, 16);
  const rowId = links.claimDownload(id, { ipHash, userAgent: String(req.get('user-agent') || '').slice(0, 160) });
  if (!rowId) return expired(res);

  let file;
  try {
    file = await openFile(link.file_key);
  } catch (err) {
    console.error('storage read failed:', err.message);
  }
  if (!file) {
    links.releaseDownload(rowId);
    return res.status(503).type('html').send(page('Unavailable',
      `<h1>This download is not available right now.</h1><p>Please try again in a few minutes, or reply to your receipt and we'll help.</p>`));
  }

  res.set({
    'Content-Type': 'application/epub+zip',
    'Content-Disposition': `attachment; filename="${fileName(link.title)}"`,
  });
  if (file.size) res.set('Content-Length', String(file.size));

  res.on('finish', () => links.completeDownload(rowId));
  file.stream.on('error', (err) => {
    console.error('download stream error:', err.message);
    res.destroy(err);
  });
  file.stream.pipe(res);
});

module.exports = router;
