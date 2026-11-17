// Shared page shell for every admin hub page (admin.terryheath.com): one stylesheet, one nav bar, phone-width layout (2026-11-17).
// Used by admin-hub.cjs (home, login, setup), payouts-lib.cjs (/payouts) and podcast-routes.cjs (/podcast).
//   - the nav is identical on every signed-in page; Sign out is a POST button (a GET to /logout never signs anyone out)
//   - tables sit in a .tw box that scrolls inside itself, and on a phone (<= 700px) tables marked class="cards" stack into one card per row
//     (each td carries data-label, shown as its caption), so no hub page is ever wider than the screen
//   - links and buttons are at least 40px tall
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `*{box-sizing:border-box}body{margin:0;font:16px/1.5 Georgia,serif;color:#222;background:#fff;overflow-wrap:anywhere}main{max-width:72rem;margin:0 auto;padding:1rem 1rem 4rem}
h1{font-size:1.5rem;font-weight:normal}h2{font-size:1.15rem;margin:1.8rem 0 .3rem;border-bottom:1px solid #ccc}h2 small,h3 small{font-size:.75rem;color:#666;font-weight:normal}h3{font-weight:normal;margin:1.2rem 0 .3rem}
ul{padding-left:1.2rem}li{margin:.2rem 0}li>a,p>a,td>a,summary{display:inline-flex;align-items:center;min-height:40px}summary{cursor:pointer}td>a{margin:.1rem 0}.why,.small,small{color:#555;font-size:.9rem}.status{background:#f4f1ea;border:1px solid #ccc;padding:.6rem 1rem}
.warn{background:#fdecea;border:1px solid #e0a09a;padding:.5rem 1rem;color:#7a1f18}.ok{color:#1a6b2a}.bad{color:#a33}.hint{color:#666;font-size:.85rem}.note{background:#f4f1ea;border:1px solid #ccc;padding:.5rem 1rem}
.hubnav{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:center;border-bottom:1px solid #ccc;margin:0 0 1rem}.hubnav a,.hubnav button.link{display:inline-flex;align-items:center;min-height:40px;padding:0 .4rem;color:#0b4f8a}
.hubnav a.here{font-weight:bold;color:#222;text-decoration:none}.hubnav form{display:inline;margin:0}.hubnav button.link{background:none;border:0;font:inherit;cursor:pointer;text-decoration:underline}
.tw{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #ddd;padding:.3rem .5rem;text-align:left;vertical-align:top;font-size:.9rem}th{background:#f4f1ea}
input,select,textarea{font:inherit;padding:.4rem;margin:.15rem 0;max-width:100%;min-height:40px}textarea{width:100%}input[type=file]{min-height:40px}
button{font:inherit;padding:.4rem .9rem;margin:.1rem;min-height:40px;cursor:pointer}button.ghost{background:#fff;color:#222;border:1px solid #888}
.pre,pre{white-space:pre-wrap;background:#f7f7f7;border:1px solid #ddd;padding:.5rem;font:13px/1.4 ui-monospace,Menlo,monospace;overflow-x:auto}details{margin:.3rem 0}
.bio{background:#fff;border:1px solid #ddd;padding:.7rem 1rem;margin:.6rem 0}.cols{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.cols p{margin:.2rem 0}.act{margin-top:.5rem}
.filters{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0}.filters button{border:1px solid #888;background:#fff;color:#222}.filters button.on{background:#222;color:#fff}
@media (max-width:700px){main{padding:.75rem .75rem 3rem}.cols{grid-template-columns:1fr}input,select{width:100%}
table.cards,table.cards tbody{display:block;width:100%}table.cards tr:first-child:has(th){display:none}table.cards tr{display:block;border:1px solid #ccc;margin:0 0 .8rem;background:#fff}
table.cards td{display:block;border:0;border-bottom:1px solid #eee;padding:.4rem .6rem}table.cards td[data-label]:not([data-label=""])::before{content:attr(data-label);display:block;font-size:.75rem;color:#666;text-transform:uppercase;letter-spacing:.03em}
table.cards td:empty{display:none}}`;

const nav = (here, { csrf = '' } = {}) => {
  const item = (href, label, key) => `<a href="${href}"${here === key ? ' class="here" aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="hubnav" aria-label="Admin">${item('/', 'Home', 'home')}${item('/payouts', 'Payouts', 'payouts')}${item('/podcast', 'Life on Words', 'podcast')}<form method="post" action="/logout"><button class="link">Sign out</button></form></nav>`;
};

// here: 'home' | 'payouts' | 'podcast' | '' (signed-out pages show no nav)
const page = (title, body, { here = '', extraHead = '', extraBody = '' } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}${here ? ' · Admin' : ''}</title>
<style>${CSS}</style>${extraHead}</head><body><main>${here ? nav(here) : ''}${body}</main>${extraBody}</body></html>`;

// Wrap a table so it scrolls inside its own box; `cards` also stacks it on a phone.
const table = (html, { cards = true, id = '' } = {}) => `<div class="tw"><table${cards ? ' class="cards"' : ''}${id ? ` id="${esc(id)}"` : ''}>${html}</table></div>`;

module.exports = { esc, CSS, nav, page, table };
