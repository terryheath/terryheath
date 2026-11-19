# Migration log: WordPress Multisite + listmonk

Started 2026-11-17 from `~/Desktop/platform-migration-prompt.md` and `~/Desktop/inkhorn-family-mockups.zip` (12 `.dc.html` mockups: Main, Review, WhiteRabbit, Combined, Piece, Hub, Contributor, Account, Submit, TerryHeath, LifeOnWords, Episode).

## Status
- 2026-11-18 (approved by Terry: build everything, spending OK; subscriptions move to the shop service with Stripe subscriptions; White Rabbit add-on Ebook $7/yr, Print $14/yr; WR contributors who choose Print get WR Print free): Railway services created in project Shared Cron (`7865f281-...`): `Postgres` and `MySQL` (official Railway templates), `listmonk` (image `listmonk/listmonk:latest`, v6.2.0, installs idempotently on start; temp URL https://listmonk-production-b3fcccbe.up.railway.app, admin `terry`, password in Keychain `listmonk-admin-password`), `wordpress` (built from `wp/` in this repo, official `wordpress:6-php8.3-apache` plus wp-cli; first boot runs `wp core multisite-install`; temp URL https://wordpress-production-754b3e08.up.railway.app, admin `terry`, password in Keychain `wp-network-admin-password`; volume at `wp-content/uploads`). listmonk login verified.
- 2026-11-18: **WordPress Multisite is up** at the temporary address: network installed (subdirectory), sites created on boot: `/` (press hub), `/review/`, `/whiterabbit/`, `/muse/`, `/terryheath/`, `/lifeonwords/` (the last two get their own domains at cutover). All return 200; the theme is still a placeholder, so pages are blank. Lessons: the stock image needs a single Apache MPM; wp-cli evals `wp-config.php` so the multisite flag uses an absolute path on the uploads volume; PHP mysqli is used for DB checks (MariaDB client cannot talk to MySQL 8 auth). Entrypoint writes the multisite `.htaccess` on every boot.
- 2026-11-18 (later): **Built and working on the temporary address:** block theme `wp/themes/inkhorn` + plugin `wp/plugins/inkhorn-network` (Issue/Piece/Contributor/Book/Episode/Guest types, views for every page type in the mockups, signup, shop pages via the old `shop.js`, accounts); import from Ghost (`inkhorn/scripts/wp-import.cjs`: 2 issues, 66 pieces, 64 contributors, pages, 2 books; `wp-import-terryheath.cjs`: 11 episodes, guests, 1 post, 4 pages); **podcast feed** at `/terryheath/podcast/rss/` has the same 11 GUIDs and pubDates as the live Ghost feed; **redirect map** `wp/mu-plugins/inkhorn-redirects.json` with `inkhorn/scripts/test-wp-redirects.cjs` (191 live Ghost URLs tested); **subscriptions** in the shop service (`lib/subscriptions.js`: Stripe subscriptions on the existing Ebook/Print prices, White Rabbit add-on prices `price_1UczndCItY7iMaUPNSAxHMdj` ($7) and `price_1UczneCItY7iMaUPGPzVFkir` ($14), comps, portal; the paid member and the 9 complimentary members imported with Print intact; shop webhook now also receives subscription events); agreements grant the subscription through the shop on signing (Review Print, or White Rabbit Print for White Rabbit); contributor account created on signing; admin hub `/profiles` approves headshot, bio and website changes; private Ghost-page stores moved behind `inkhorn/store.cjs` (`STORE_MODE=wp`, copy with `scripts/store-migrate.cjs`); listmonk has the 8 lists and 6 brand templates (`scripts/listmonk-setup.cjs`).
- **Waiting on a password/2FA:** AWS sign-in (SES SMTP user for listmonk and for WordPress mail) — the sign-in page is open in Chrome; `aws login --profile ftr` finishes when it is completed.
- **Next, in order:** (1) block theme + Inkhorn network plugin from the mockups; (2) listmonk: SES, lists, templates, preferences page; (3) content export/import and the 301 map; (4) shop-service subscriptions (Stripe subscriptions, comps from agreements, White Rabbit add-on); (5) contributor accounts and magic links; (6) rewrite the Ghost-dependent scripts; (7) heuristics audit loop; (8) cutover (wait for Terry).
- 2026-11-17: read the prompt and mockups, inventoried what depends on Ghost, wrote this log. **Nothing built or deployed yet.** Waiting on the two items under "Gate" below.

## Gate (needs Terry before anything is created on Railway)
1. **Spending money.** Adds a WordPress service, a MySQL database, a listmonk service and a Postgres database to Railway (and DocuSeal if it is moved). Railway bills by usage; a rough estimate is $25 to $40 a month extra, to be replaced by real numbers once the services run. Not yet approved.
2. **Paid subscriptions (not covered by the prompt).** Ghost on inkhorn.press has tiers Ebook ($20/yr) and Print ($48/yr), 1 paid member, 9 complimentary Print members (granted by signed agreements), and 175 members in all. terryheath.com Ghost has 1 paid member and tips. WordPress + listmonk has no subscriptions. Decision needed: what carries Ebook/Print/tips and the complimentary Print grants (for example the existing shop service plus Stripe subscriptions)? Until decided, no paying member is moved.

## Inventory: files that talk to Ghost (each is rewritten; new versions get listed here)
- Agreements and payouts: `agreements-lib.cjs` (tracker lives in the Ghost page `agreements-tracker`; complimentary Print grants; post pulls), `agreements.cjs`, `agreements-accept.cjs`, `payouts-lib.cjs`, `bios-lib.cjs`, `scripts/send-agreement.cjs`, `send-updated-agreement.cjs`, `bios-and-garvey.cjs`, `refund-backfill.cjs`
- Admin hub and podcast: `admin-hub.cjs`, `admin-setup.cjs`, `podcast-lib.cjs`, `podcast-routes.cjs`, `podcast.cjs`, `notice-mail.cjs`, root `riverside-to-ghost.js`, `imported-guids.json`
- Newsletters: `digest.js`, root `terryheath-digest.js`, `subscribe-newsletter.js`, `scheduler-check.js`, `reschedule.js`, `scripts/schedule-drip.js`, `scripts/export-mailing-list.js`
- Publishing and builds: `scripts/build-editions.cjs`, `check-editions.cjs`, `catalog-pages.cjs`, `archive-report.js`, `setup-build.js`, `gen-routes.cjs`, `ghost-fetch.cjs`, `tag-*.cjs/js`, `build-ebook.js`, `build-shelves.cjs`, `poem-wrap.js`, `set-og-images.js`, `update-bios.js`, `og-webhook/`
- Other services: `shop-service/lib/{catalog,config,orders}.js`, `address-service/index.js`, `patreon-sync.js`, `scripts/backup-ghost.cjs`
- Theme and routing: `inkhorn/theme/` (Handlebars; replaced by the block theme), `inkhorn/redirect-worker/`, `terryheath/redirects.yaml`, `inkhorn/data/issues.json`

## Data to carry over
- inkhorn.press Ghost: 92 posts, pages, tags (contributors, genres, issues), 175 members, newsletters `inkhorn-review-digest` (active), `white-rabbit`, `events` (inactive), plus archived ones.
- terryheath.com Ghost and the 11 podcast episodes (feed URL and GUIDs must not change).
- Agreements tracker (30 records) and DocuSeal (sign.terryheath.com, templates 3, 5, 6, 12, 13, 15).

## Decisions made so far
- **Subscriptions (Terry, 2026-11-18):** move to the shop service with Stripe subscriptions in the existing accounts (Inkhorn Press for inkhorn.press, Follow the Rabbit LLC for terryheath.com). Existing Stripe subscriptions keep billing unchanged: nobody re-subscribes, nothing cancels when Ghost disconnects. Stripe customer portal for self-service; subscription status in the member account. White Rabbit add-on: Ebook $7/yr, Print $14/yr; White Rabbit contributors who choose Print get White Rabbit Print free, as Review contributors get Review Print.
- **Subscription in place of payment (Terry's correction, 2026-11-18):** when a signed agreement chooses a subscription, it is granted automatically on signing, as Ghost does now. The 9 existing complimentary members carry over with their Print subscription intact (they are not turned into plain email subscribers). The contributor account shows it under Payments as the subscription taken in place of payment.
- None beyond the prompt's own defaults.


## Ghost-dependent code: new versions (2026-11-18)
Switch-over is by environment variable or by pointing the Railway cron at the new file at cutover; nothing live changes before then.
| Old (Ghost) | New (WordPress / listmonk) | How it is switched on |
|---|---|---|
| `agreements-lib.cjs` tracker, `podcast-lib.cjs` guests, `podcast-routes.cjs` headshots, `admin-hub.cjs` login | same files, private stores via `inkhorn/store.cjs` + `wp/.../includes/store.php`; copy with `scripts/store-migrate.cjs` | `STORE_MODE=wp` |
| `agreements.cjs` (pull to draft, schedule signed pieces, running order), `bios-lib.cjs`, `payouts-lib.cjs` | same files, WordPress branch; endpoints `post-status`, `piece-bio`, `bio` in `includes/tools.php` | `CMS=wp` |
| `agreements.cjs` Ghost comps | grant in the shop service (`/subscription/grant`), White Rabbit contributors get White Rabbit Print | on now; Ghost comps off with `GHOST_COMPS=off` |
| `digest.js` | `digest-listmonk.js` (campaign on the Inkhorn Review list) | cron command at cutover |
| `terryheath-digest.js` | `terryheath-digest-wp.js` | cron command at cutover |
| `scheduler-check.js` | `scheduler-check-wp.js` (WordPress scheduled posts + listmonk campaigns) | cron command at cutover |
| `patreon-sync.js` | `patreon-sync-wp.js` (store `patreon-supporters`, shown on the hub Support page) | cron command at cutover |
| `shop-service/lib/catalog.js` | WordPress catalog endpoint | `CATALOG_SOURCE=wp` + `WP_URL` |
| `build-ebook.js`, `build-shelves.cjs` | same files, WordPress branch (`issue-pieces`, `contributor-meta`) | `CMS=wp` |
| `scripts/backup-ghost.cjs` | `scripts/backup-network.cjs` (to `~/inkhorn-backups`) | run by hand / cron |
| `og-webhook`, `scripts/set-og-images.js` | retired: Open Graph tags come from the theme (`includes/blocks.php`) | n/a |
| `subscribe-newsletter.js`, `scripts/export-mailing-list.js` | retired: listmonk import/export (`scripts/listmonk-import.cjs`) | n/a |
| `build-editions.cjs`, `check-editions.cjs`, `catalog-pages.cjs`, `archive-report.js`, `gen-edition-partials.cjs`, `gen-routes.cjs`, `setup-build.js`, `tag-*.cjs/js`, `poem-wrap.js`, `update-bios.js`, `reschedule.js`, `schedule-drip.js`, `ghost-fetch.cjs`, `inkhorn/theme/` | retired: issues, pieces, positions, bios and covers are records in WordPress (`wp-import.cjs` did the one-time copy) | n/a |
| `riverside-to-ghost.js`, `podcast-import` service | still to rewrite (episodes: WordPress `ih_episode` via the import endpoint) | open |
| `address-service`, `shop-service` Ghost-member address page | Print addresses come from Stripe Checkout (shipping address) and from the signed agreement; `/address/` redirects to `/account/` | open: confirm the address-service is no longer needed |
| `routes.yaml` / `redirects.yaml` generation | `wp/mu-plugins/inkhorn-redirects.json`; `scripts/test-wp-redirects.cjs`: 191 live Ghost URLs, 0 failing | done |

## Heuristics audit
- Pass 1 (2026-11-18, automated part): contrast of every text/background pair in the palette is 4.5:1 or better (ink 13.7, muted 5.7, accents 4.9 to 6.7, accents on tints 4.5 to 6.0); all buttons and fields are 44px tall; focus outlines on; one `main` landmark per page; skip link from the block theme; phone breakpoint at 640px. Still to do: full pass over every page type, the email templates, preferences and account on a phone-width screen, keyboard walkthrough; repeat until a fresh pass finds nothing.

## Not done yet
- SES: needs the AWS console sign-in (password / 2FA). After it: `scripts/ses-smtp-user.cjs` creates the SMTP user, listmonk and WordPress get the SMTP settings, test send to Terry only.
- DocuSeal move from PikaPods to Railway (needs the pod's data; see below).
- Mapped domains, cross-domain sign-in cookie, DNS, SSL: cutover only, after Terry's go-ahead.
- Shutdown list and costs: after cutover, for Terry's explicit yes.


## 2026-11-19 update
- **SES is live.** IAM user `inkhorn-mail-smtp` (SES us-east-2, identities inkhorn.press and terryheath.com), credentials in Keychain (`inkhorn-mail-smtp-user`, `-pass`). listmonk (`scripts/listmonk-settings.cjs`) and WordPress (`wp/mu-plugins/inkhorn-mail.php`) send through it. A test email to hello@terryheath.com arrived (brand template, footer, unsubscribe link).
- **Names (Terry):** bar says Newsletter and Donate; "Subscribe"/"Subscription" are only for the paid Ebook and Print plans, which live at `/shop/subscriptions/`; no "membership" anywhere (code, text and database renamed). Signup heading "Get News & Updates by Email" and button "Sign Up" on all six sites; footers "Inkhorn Press is a 501(c)(3) nonprofit press." on the four Inkhorn Press sites, the Follow the Rabbit LLC lines on terryheath.com and lifeonwords.com.
- **Donations:** `/donate/` with $10/$25/$50/$100 buttons to the shop service (`/donate/checkout`, Stripe Checkout, one-time).
- **Podcast importer:** `riverside-to-wp.js` (root) writes episodes to WordPress (`ih_episode`, number and GUID kept, headshot from the hub, guest created and linked, draft by default). Switch the `podcast-import` cron command and set `WP_URL` / `INKHORN_IMPORT_TOKEN` at cutover.
- **Address service replaced:** Print addresses are saved from Stripe Checkout (shipping address), or typed on the account page; the shop service lists Print subscribers with addresses (`/subscription/print-list`). The old `address-service` stays running until cutover and is then retired. `/address/` redirects to `/account/`.
- **White Rabbit Print rule:** it is granted only when a signed agreement takes a subscription in place of payment, and only for White Rabbit agreements (`scripts/test-comp-rules.cjs`); the Ghost comp path is skipped for White Rabbit; paid add-ons are separate Stripe purchases.
- **PR #1 / shop.db:** there is no pull request; the file was committed to `main` in `1a71824`. It contained only the empty schema (0 orders, 0 links, 0 events, no emails, no Stripe ids), so the history was left as it is. It is untracked and ignored now.
- **Heuristics audit, pass 2 (automated, phone width 390px, 38 pages across the six sites):** every page has one h1, one `main`, a skip link, labelled fields, alt text, no horizontal scroll, 44px targets, 4.5:1 text contrast, a focus ring on every control, and the agreed words; fixed along the way: missing h1 on home pages, 18px bar links, small checkboxes, missing genre/books/episodes/guests pages, empty-state pages for White Rabbit and Muse, a Search link in every header. `/muse/` could not be loaded in the audit frame (the page itself is 200 and uses the same template as White Rabbit); check it by eye.
- **DocuSeal:** a fresh DocuSeal runs on Railway (`docuseal`, temporary address https://docuseal-production-43dca1b9.up.railway.app, volume `/data/docuseal`), empty. Waiting for the PikaPods login to export the pod's data and environment (the PikaPods login page is open in Chrome).
