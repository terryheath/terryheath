// DocuSeal moved from sign.lifeonwords.com to sign.inkhornreview.com (2026-11-11).
// Permanent redirect that keeps path and query so old signing links keep working.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'sign.inkhornreview.com';
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  },
};
