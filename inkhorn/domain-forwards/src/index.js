// domain-forwards — old festival domains forward to their page on Inkhorn Press (301, whole site, no path).
const TARGETS = {
  'bookfolk.org': 'https://inkhorn.press/bookfolk/',
  'weirdfriday.com': 'https://inkhorn.press/weird-friday/',
};
export default {
  async fetch(request) {
    const host = new URL(request.url).hostname.replace(/^www\./, '');
    return Response.redirect(TARGETS[host] || 'https://inkhorn.press/', 301);
  },
};
