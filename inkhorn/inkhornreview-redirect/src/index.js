// inkhornreview-redirect — every inkhornreview.com (and www) request goes to the same path on inkhorn.press,
// query string kept. GET/HEAD get 301; other methods get 308 so a POST is not turned into a GET.
// Subdomains (address., admin., agreements., download., muse., sign.) are separate DNS records and never reach this Worker.
export default {
  async fetch(request) {
    const u = new URL(request.url);
    const dest = 'https://inkhorn.press' + u.pathname + u.search;
    return Response.redirect(dest, request.method === 'GET' || request.method === 'HEAD' ? 301 : 308);
  },
};
