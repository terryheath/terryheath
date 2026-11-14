// DocuSeal now lives at sign.terryheath.com (moved 2026-11-14; before that sign.inkhornreview.com, and
// sign.lifeonwords.com before 2026-11-11). Permanent redirect that keeps path and query so every old
// signing link (contributors and guests) keeps working.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'sign.terryheath.com';
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  },
};
