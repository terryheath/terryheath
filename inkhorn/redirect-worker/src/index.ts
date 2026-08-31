export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();

    // Submission-related paths → inkhornjournal.com/submissions
    if (
      path === "/submission" ||
      path === "/submissions" ||
      path.startsWith("/submission/") ||
      path.startsWith("/submissions/") ||
      path.startsWith("/apply/journal") ||
      path.startsWith("/apply")
    ) {
      return Response.redirect("https://inkhornjournal.com/submissions", 301);
    }

    // Everything else → inkhornreview.com (preserve path)
    return Response.redirect(`https://inkhornreview.com${url.pathname}`, 301);
  },
};
