<?php
namespace Inkhorn;

/**
 * Network Admin > Services: one place to start. Direct links to every service (and every link the admin hub had), plus the "How to change things" note,
 * which is linked from the top of every Network Admin screen.
 */

function svc_env($k, $d = '') { $v = getenv($k); return $v ? rtrim($v, '/') : $d; }
function services_list() {
  $hub = 'https://admin.terryheath.com';
  $lm = svc_env('LISTMONK_URL', 'https://lists.inkhorn.press'); $um = svc_env('UMAMI_URL', 'https://stats.inkhorn.press'); $shop = svc_env('SHOP_SERVICE_URL', 'https://shop.inkhorn.press');
  return [
    'Email and analytics' => [
      ['listmonk', $lm . '/admin', 'Lists, subscribers, campaigns and email templates (the newsletter, sign-up confirmations and the issue announcement).', 'link'],
      ['Umami', $um . '/', 'Visits and pages for every site; self-hosted, no cookies.', 'link'],
      ['Growth report', $hub . '/growth', 'Each month against its target: email lists, donations, subscriptions, sales and visits.', 'link'],
    ],
    'Agreements and payments' => [
      ['DocuSeal', 'https://sign.terryheath.com/sign_in', 'Agreement templates, every sent and signed agreement, the API token.', 'link'],
      ['Profile changes', $hub . '/profiles', 'Contributor headshot, bio and website changes waiting for approval.', 'link'],
      ['Payouts', $hub . '/payouts', 'Signed or not, pay and subscription choices, bios to apply or ignore, print mailing lists.', 'link'],
      ['Life on Words guests', $hub . '/podcast', 'Guest agreements, bookings and reminders; add a guest and send the invitation.', 'link'],
      ['Contributor confirm page', 'https://agreements.inkhornreview.com/accept', 'What the Duosuma acceptance letter links to. Public.', 'link'],
      ['Admin hub', $hub . '/', 'The agreements and payouts hub these links came from.', 'link'],
    ],
    'Shop and money' => [
      ['Stripe: Inkhorn Press (nonprofit)', 'https://dashboard.stripe.com/', 'Shop checkout, donations, Duosuma fees, subscriptions. Prices live here. Switch to the Inkhorn Press account in the dashboard menu.', 'link'],
      ['Stripe: Follow the Rabbit LLC', 'https://dashboard.stripe.com/', 'terryheath.com tips and donations. Switch to the Follow the Rabbit LLC account.', 'link'],
      ['Shop service admin (ebook downloads)', $shop . '/admin', 'Resend or revoke download links, download history, file check.', 'link'],
      ['Shop (products and wording)', admin_url_hub('admin.php?page=ih-shop'), 'Product pages and the shop and subscription wording, inside this dashboard.', 'here'],
    ],
    'Submissions' => [
      ['Duosuma manage', 'https://duotrope.com/duosuma/manage/?ac=l14PM', 'Submissions, templates (the acceptance letter), calls and dates, team.', 'link'],
      ['Duotrope listing', 'https://duotrope.com/duosuma/submit/inkhorn-review-iGX4p', 'The public page where writers submit to Inkhorn Review.', 'link'],
      ['Chill Subs editor portal', 'https://editor.chillsubs.com/listings', 'Edit the Chill Subs listing and its stats.', 'link'],
    ],
    'Other sites' => [
      ['Muse (gomuse.io) admin', 'https://gomuse.io/admin', 'Issues, people, email, flagged pieces. Muse is a separate publication of Follow the Rabbit LLC.', 'link'],
      ['Ghost Admin (inkhorn.press, until cutover)', 'https://inkhorn.press/ghost/', 'The current Ghost site: posts, pages, members, newsletters, themes.', 'link'],
      ['shelves.page news list (listmonk)', 'https://lists.shelves.page/admin', 'The shelves.page news & updates list.', 'link'],
    ],
    'Hosting and accounts' => [
      ['Railway: Shared Cron (WordPress, listmonk, DocuSeal, Umami, shop service)', 'https://railway.com/project/7865f281-fb8b-46e7-90bd-ffb6babf849d', 'Deploys, logs and variables for the services above.', 'link'],
      ['Railway: Muse', 'https://railway.com/project/9a9c6ef8-f93a-439a-b0f1-e6595a1d2a0d', 'Muse API, web and database.', 'link'],
      ['PikaPods', 'https://www.pikapods.com/pods', 'Ghost and the old DocuSeal pod until they are shut down.', 'link'],
      ['Cloudflare', 'https://dash.cloudflare.com/', 'DNS for every domain, the redirect Workers.', 'link'],
      ['AWS SES console', 'https://us-east-2.console.aws.amazon.com/ses/home?region=us-east-2', 'Sending identities, DKIM, SMTP credentials.', 'link'],
    ],
  ];
}
function admin_url_hub($path) { return get_admin_url(get_main_site_id(), $path); }

add_action('network_admin_menu', function () {
  add_menu_page('Services', 'Services', 'manage_network', 'ih-services', __NAMESPACE__ . '\\services_page', 'dashicons-admin-links', 3);
  add_submenu_page('ih-services', 'Services', 'All services', 'manage_network', 'ih-services', __NAMESPACE__ . '\\services_page');
  add_submenu_page('ih-services', 'How to change things', 'How to change things', 'manage_network', 'ih-howto', __NAMESPACE__ . '\\howto_page');
});
add_action('network_admin_notices', function () {
  echo '<div class="notice notice-info" style="border-left-color:#0A2454"><p><b><a href="' . esc_url(network_admin_url('admin.php?page=ih-howto')) . '">How to change things &rarr;</a></b> where each kind of text lives, how to add a plugin, how to reach each service. &nbsp;·&nbsp; <a href="' . esc_url(network_admin_url('admin.php?page=ih-services')) . '">Services</a></p></div>';
});
add_action('admin_notices', function () {
  if (!is_network_admin()) { echo '<div class="notice notice-info" style="border-left-color:#0A2454"><p><a href="' . esc_url(network_admin_url('admin.php?page=ih-howto')) . '">How to change things</a> · <a href="' . esc_url(network_admin_url('admin.php?page=ih-services')) . '">Services</a></p></div>'; }
});

function services_page() {
  echo '<div class="wrap"><h1>Services</h1><p>Start here. Each link opens the service in a new tab. Plugin integrations are listed at the bottom: none met every requirement, so each service is a link.</p>';
  foreach (services_list() as $group => $items) {
    echo '<h2>' . esc_html($group) . '</h2><table class="widefat striped" style="max-width:980px"><tbody>';
    foreach ($items as $it) {
      echo '<tr><td style="width:34%"><a href="' . esc_url($it[1]) . '"' . ($it[3] === 'link' ? ' target="_blank" rel="noopener"' : '') . '><b>' . esc_html($it[0]) . '</b></a></td><td>' . esc_html($it[2]) . '</td></tr>';
    }
    echo '</tbody></table>';
  }
  echo '</div>';
}

function howto_page() {
  $site = admin_url_hub('');
  echo '<div class="wrap" style="max-width:860px"><h1>How to change things</h1>
<p>One page. If something is not here, it needs a code change (last section).</p>
<h2>Where each kind of text lives</h2>
<table class="widefat striped"><thead><tr><th>What</th><th>Where to change it</th></tr></thead><tbody>
<tr><td>Page text: About, Donate, Events, Submit, Privacy, Terms and other pages</td><td>Each site’s dashboard &rarr; <b>Pages</b> &rarr; edit (block editor). Page titles are the browser-tab titles.</td></tr>
<tr><td>Header, footer, menus, the home pages and the issue layout, and their fixed wording</td><td>Each site’s dashboard &rarr; <b>Appearance &rarr; Editor</b>. Open <i>Patterns &rarr; Template parts</i> and pick <code>header-&lt;site&gt;</code>, <code>footer-&lt;site&gt;</code> or <code>home-&lt;site&gt;</code>; <i>Templates</i> has Front page, Issue and Page. Menu links use tokens that follow the domain: <code>{hub}</code> <code>{review}</code> <code>{whiterabbit}</code> <code>{terryheath}</code> <code>{lifeonwords}</code> <code>{home}</code>; images use <code>{img}</code>. Keep them in links you add for other pages of the network.</td></tr>
<tr><td>Every other sentence, label, button and message (sign-up, sign-in, newsletter, account, search, 404, confirmations, errors, browser titles, emails we send)</td><td>Each site’s dashboard &rarr; <b>Settings &rarr; Site text</b>. Find a sentence with the search box, change it, Save. Clear a box to return to the original. <code>{name}</code> marks a value the site fills in.</td></tr>
<tr><td>Shop: product pages, subscription and shop wording</td><td>Press hub dashboard &rarr; <b>Shop</b>. Product name, description and cover are edited on the product. <b>Prices are in Stripe</b> (Product catalog), not WordPress.</td></tr>
<tr><td>Newsletter and sign-up emails (design and wrapper)</td><td><a href="' . esc_url(svc_env('LISTMONK_URL', 'https://lists.inkhorn.press') . '/admin/campaigns/templates') . '" target="_blank" rel="noopener">listmonk &rarr; Campaigns &rarr; Templates</a>. Lists and subscribers: listmonk &rarr; Lists. The confirmation and sign-in emails themselves are under Site text &rarr; Emails we send.</td></tr>
<tr><td>Agreements (what contributors and guests sign)</td><td><a href="https://sign.terryheath.com/sign_in" target="_blank" rel="noopener">DocuSeal</a> &rarr; Templates for names, fields and who signs. The agreement wording is in the PDFs, which are built by a script (see below).</td></tr>
<tr><td>Search and sharing: page titles, descriptions, share images</td><td>Each page’s editor has an SEO box (The SEO Framework); site-wide defaults under <b>SEO</b> in each site’s dashboard.</td></tr>
</tbody></table>
<h2>Add a plugin or theme</h2>
<p><b>Network Admin &rarr; Plugins &rarr; Add New</b> (themes: <b>Themes &rarr; Add New</b>), then <i>Network Activate</i>. What you install is kept on a volume, so it stays after every redeploy. Updates: <b>Dashboard &rarr; Updates</b>. WordPress core updates from the dashboard last until the next redeploy; a redeploy brings the current core with it.</p>
<p>Install only plugins that are free with no nags, from wordpress.org, GPL, updated in the last six months, 10,000+ installs and 4 stars or better, multisite-ready, without known security issues, and that send nothing to outside services.</p>
<h2>Reach each service</h2>
<p><a href="' . esc_url(network_admin_url('admin.php?page=ih-services')) . '"><b>Network Admin &rarr; Services</b></a> has a link to listmonk, DocuSeal, Umami, Stripe, the shop service, the admin hub and everything else the admin hub linked to.</p>
<h2>Still needs code</h2>
<ul style="list-style:disc;margin-left:22px">
<li>Shipping rates ($4 first print copy, $1 each additional): <code>inkhorn/shop-service/index.js</code>.</li>
<li>Agreement wording: <code>inkhorn/scripts/build-agreement-pdfs.cjs</code> builds the DocuSeal PDFs; changing the words means rebuilding and re-uploading them.</li>
<li>Accounts, subscriptions, double opt-in and other behavior (not wording): the <code>inkhorn-network</code> plugin.</li>
<li>Adding a new site to the network, a new content type, or a new kind of page.</li>
<li>Muse (gomuse.io) is separate software with its own admin.</li>
<li>Domain changes at cutover (DNS, mapped domains).</li>
</ul></div>';
}
