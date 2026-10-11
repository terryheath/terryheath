'use strict';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Minimal in-memory limiter, per IP. Resets on restart, which is fine here.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, v] of hits) if (v.start < cutoff) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const h = hits.get(req.ip);
    if (!h || now - h.start > windowMs) {
      hits.set(req.ip, { start: now, n: 1 });
      return next();
    }
    h.n++;
    if (h.n > max) return res.status(429).type('text/plain').send('Too many requests. Please try again in a minute.');
    next();
  };
}

const STYLE = `body{font:18px/1.6 Georgia,serif;color:#2b2722;background:#f7f3ea;margin:0;padding:48px 20px}
main{max-width:560px;margin:0 auto}h1{font-weight:500;font-size:1.6rem}
button,.btn{font:600 16px sans-serif;background:#8f1d1d;color:#fff;border:0;padding:12px 22px;cursor:pointer;text-decoration:none;display:inline-block}
.small{font-size:.9rem;color:#5b544a}a{color:#8f1d1d}`;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Inkhorn Review</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;
}

module.exports = { esc, rateLimit, page };
