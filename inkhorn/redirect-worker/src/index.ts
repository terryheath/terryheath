export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();

    // Submission-related paths → inkhornreview.com/submissions
    if (
      path === "/submission" ||
      path === "/submissions" ||
      path.startsWith("/submission/") ||
      path.startsWith("/submissions/") ||
      path.startsWith("/apply/journal") ||
      path.startsWith("/apply")
    ) {
      return Response.redirect("https://inkhornreview.com/submissions", 301);
    }

    // Everything else → inkhornreview.com root
    return Response.redirect("https://inkhornreview.com/", 301);
  },
};
