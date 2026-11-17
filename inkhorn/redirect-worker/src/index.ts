// inkhorn-press-redirect — after the 2026-11 switch inkhorn.press is the Ghost site itself.
// This Worker now only serves www.inkhorn.press, sending it to the bare domain (path and query kept).
export default {
  async fetch(request: Request): Promise<Response> {
    const u = new URL(request.url);
    return Response.redirect("https://inkhorn.press" + u.pathname + u.search, request.method === "GET" || request.method === "HEAD" ? 301 : 308);
  },
};
