// sign-root-redirect — only the root of sign.terryheath.com (DocuSeal's public marketing page) goes to the sign-in page.
// The route pattern is exactly "sign.terryheath.com/" so signing links (/s/...), the API and every other path never reach this Worker.
export default {
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect('https://sign.terryheath.com/sign_in' + url.search, 301);
  },
};
