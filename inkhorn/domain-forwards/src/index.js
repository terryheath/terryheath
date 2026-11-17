// domain-forwards — old festival domains forward to their page on Inkhorn Press (301, whole site, no path).
// weirdfriday.org is in a different Cloudflare account; add it there with the same Worker when needed.
const TARGETS = {
  'bookfolk.org': 'https://inkhorn.press/bookfolk/',
  'weirdfriday.com': 'https://inkhorn.press/weird-friday/',
  'weirdfriday.org': 'https://inkhorn.press/weird-friday/',
};
export default {
  async fetch(request) {
    const host = new URL(request.url).hostname.replace(/^www\./, '');
    return Response.redirect(TARGETS[host] || 'https://inkhorn.press/', 301);
  },
};
