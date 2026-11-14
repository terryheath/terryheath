// lifeonwords.com and www.lifeonwords.com -> terryheath.com/podcast/ (2026-11-13).
// An episode slug anywhere in the path (/<slug>/, /podcast/<slug>/, /life-on-words/<slug>/) goes to
// that episode; everything else goes to the podcast index. Add new slugs here only if old links need them.
const SLUGS = new Set([
  "s-t-joshi-h-p-lovecraft-a-gateway-to-an-intellectual-life",
  "aleks-merilo-kicked-out-of-his-own-play",
  "allie-millington-i-tried-again-four-hundred-times",
  "maureen-mcquerry-the-girl-who-asked-questions",
  "elena-taylor-allowed-in-the-room",
  "sheila-roberts-no-problem-no-story",
  "kirby-larson-the-girl-who-wanted-to-be-dorothy",
  "alan-katz-forty-years-of-getting-paid-to-be-funny",
  "christina-braver-real-sex-real-stories",
  "ben-rockwood-the-publisher-who-rejected-the-question",
  "susan-wiggs-60-plus-novels-and-what-they-cost"
]);
export default {
  fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const slug = parts.find((p) => SLUGS.has(p));
    const target = 'https://terryheath.com/podcast/' + (slug ? slug + '/' : '');
    return Response.redirect(target, 301);
  },
};
