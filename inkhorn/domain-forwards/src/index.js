// domain-forwards — old festival domains forward to their page on Inkhorn Press (301, whole site, no path);
// weirdfriday.org (Terry's, in the hello@terryheath.com Cloudflare account c153c3d5a893fb0e1361e594880f6c96) forwards to weirdfriday.com, path and query kept.
const TARGETS = {
  'bookfolk.org': 'https://inkhorn.press/bookfolk/',
  'weirdfriday.com': 'https://inkhorn.press/weird-friday/',
};
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'weirdfriday.org') { return Response.redirect('https://weirdfriday.com' + url.pathname + url.search, 301); }
    return Response.redirect(TARGETS[host] || 'https://inkhorn.press/', 301);
  },
};
