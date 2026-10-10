// inkhorn/digest-html.js — inline-styled HTML helpers shared by the digest and the welcome step

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const HR = '<hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0 24px">';

export function sectionHeading(label) {
  return (
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px"><tr>` +
    `<td style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;` +
    `color:#888;padding-bottom:6px;border-bottom:2px solid #1a1a1a">` +
    `${esc(label)}</td></tr></table>\n`
  );
}

export function itemRow(post, opts = {}) {
  const titleLink = `<a href="${esc(post.url)}" style="color:#1a1a1a;font-weight:600;text-decoration:none">${esc(post.title || 'Untitled')}</a>`;
  const byline    = post.custom_excerpt
    ? `<br><span style="font-size:14px;font-style:italic;color:#555">${esc(post.custom_excerpt)}</span>`
    : '';

  if (opts.thumb && post.feature_image) {
    return (
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px"><tr>\n` +
      `<td width="72" valign="top" style="padding-right:12px">\n` +
      `<img src="${esc(post.feature_image)}" width="72" height="72" alt="" ` +
      `style="display:block;object-fit:cover;border-radius:3px">\n` +
      `</td>\n` +
      `<td valign="middle" style="font-size:15px;line-height:1.4">${titleLink}${byline}</td>\n` +
      `</tr></table>\n`
    );
  }

  return `<p style="margin:0 0 10px;font-size:15px;line-height:1.4">${titleLink}${byline}</p>\n`;
}
