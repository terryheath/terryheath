# Migration log: WordPress Multisite + listmonk

Started 2026-11-17 from `~/Desktop/platform-migration-prompt.md` and `~/Desktop/inkhorn-family-mockups.zip` (12 `.dc.html` mockups: Main, Review, WhiteRabbit, Combined, Piece, Hub, Contributor, Account, Submit, TerryHeath, LifeOnWords, Episode).

## Status
- 2026-11-18 (approved by Terry: build everything, spending OK; memberships move to the shop service with Stripe subscriptions; White Rabbit add-on Ebook $7/yr, Print $14/yr; WR contributors who choose Print get WR Print free): Railway services created in project Shared Cron (`7865f281-...`): `Postgres` and `MySQL` (official Railway templates), `listmonk` (image `listmonk/listmonk:latest`, v6.2.0, installs idempotently on start; temp URL https://listmonk-production-b3fcccbe.up.railway.app, admin `terry`, password in Keychain `listmonk-admin-password`), `wordpress` (built from `wp/` in this repo, official `wordpress:6-php8.3-apache` plus wp-cli; first boot runs `wp core multisite-install`; temp URL https://wordpress-production-754b3e08.up.railway.app, admin `terry`, password in Keychain `wp-network-admin-password`; volume at `wp-content/uploads`). listmonk login verified.
- 2026-11-17: read the prompt and mockups, inventoried what depends on Ghost, wrote this log. **Nothing built or deployed yet.** Waiting on the two items under "Gate" below.

## Gate (needs Terry before anything is created on Railway)
1. **Spending money.** Adds a WordPress service, a MySQL database, a listmonk service and a Postgres database to Railway (and DocuSeal if it is moved). Railway bills by usage; a rough estimate is $25 to $40 a month extra, to be replaced by real numbers once the services run. Not yet approved.
2. **Paid memberships (not covered by the prompt).** Ghost on inkhorn.press has tiers Ebook ($20/yr) and Print ($48/yr), 1 paid member, 9 complimentary Print members (granted by signed agreements), and 175 members in all. terryheath.com Ghost has 1 paid member and tips. WordPress + listmonk has no memberships. Decision needed: what carries Ebook/Print/tips and the complimentary Print grants (for example the existing shop service plus Stripe subscriptions)? Until decided, no paying member is moved.

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
- **Memberships (Terry, 2026-11-18):** move to the shop service with Stripe subscriptions in the existing accounts (Inkhorn Press for inkhorn.press, Follow the Rabbit LLC for terryheath.com). Existing Stripe subscriptions keep billing unchanged: nobody re-subscribes, nothing cancels when Ghost disconnects. Stripe customer portal for self-service; membership status in the member account. White Rabbit add-on: Ebook $7/yr, Print $14/yr; White Rabbit contributors who choose Print get White Rabbit Print free, as Review contributors get Review Print.
- **Subscription in place of payment (Terry's correction, 2026-11-18):** when a signed agreement chooses a subscription, it is granted automatically on signing, as Ghost does now. The 9 existing complimentary members carry over with their Print membership intact (they are not turned into plain email subscribers). The contributor account shows it under Payments as the subscription taken in place of payment.
- None beyond the prompt's own defaults.
