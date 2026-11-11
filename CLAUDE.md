# terryheath repo

Scripts and config for Terry Heath's Ghost sites. Scripts are run on demand locally or triggered via Railway cron (for scheduled jobs) or GitHub Actions dispatch (manual fallback).

## Scope

**This repo is the only place to work for Inkhorn Review operations.** The whiterabbit monorepo is being retired and is not relevant to Inkhorn. Do not read, audit, or modify anything there for Inkhorn work.

Inkhorn Review's stack:
- **Publishing** — Ghost at inkhornreview.com (PikaPods). Posts, pages, and routing all managed there.
- **Submissions** — Duosuma. No submission code lives in this repo.
- **This repo** — `inkhorn/routes.yaml`, `inkhorn/contributors.json`, `inkhorn/build-shelves.js`, `inkhorn/shelves.json`, `inkhorn/ghost-footer-injection.html`, `inkhorn/set-og-images.js`, `inkhorn/patreon-sync.js`, and issue scripts. Nothing else.
- **Scheduler** — Railway project "Inkhorn Cron" runs four cron services against this repo. GitHub Actions workflows are manual-dispatch fallbacks only; they no longer run on a schedule.

## The sites

- **lifeonwords.com** — Domain only. Its old Ghost pod (`silky-mushroom`) is empty and is not a publishing target. Life on Words is a **column of Inkhorn Review**, living at `inkhornreview.com/life-on-words/`; the podcast import pipeline publishes there. Do not treat lifeonwords.com as a site that holds episodes.
- **inkhornreview.com** — Inkhorn Review, a quarterly literary magazine (4 issues/year, released on the 1st at noon Pacific: autumn/September, winter/December, spring/March, summer/June). Ghost instance on PikaPods. Routes, contributor shelves, and code injection in this repo support it. Autumn 2026's pieces are dated Sep 1, 2026 (a minute apart, in print order); Winter 2026's are Dec 1, 2026.
- **terryheath.com** — Personal site. Ghost on PikaPods (`smoky-hyena.pikapod.net`). The weekly digest in this repo feeds it.

## What's in here

- **terryheath-digest.js** — Monthly letter draft builder for terryheath.com. Runs on the 1st of each month via Railway (terryheath-digest service, `0 16 1 * *`). Creates a draft post titled "Letter — [Month Year]" tagged `#letter-draft`, containing plain titled links for the previous calendar month: terryheath.com posts, the newest Inkhorn founder's letter, and all Inkhorn podcast episodes. Always creates the draft (even if lists are empty). Idempotent — skips if a draft for that month already exists. Never publishes or emails. Requires `TH_GHOST_API_URL`, `TH_GHOST_ADMIN_KEY`; Inkhorn cross-site sections via `INKHORN_API_URL` + `INKHORN_CONTENT_KEY` (Content API, read-only).
- **riverside-to-ghost.js** — Converts Riverside podcast recordings into Ghost posts with embedded audio, show notes, and book cards. Scheduled daily via Railway (podcast-import service). Reads/writes `imported-guids.json` and `.book-cache.json` from `STATE_DIR` (Railway volume on Railway; `process.cwd()` locally). Looks up ISBNs via ISBNdb → Google Books → Open Library.
- **inkhorn/digest.js** — Sends ONE print-issue piece a week (replaced the multi-section digest on 2026-11-11). Railway `digest` service, cron `0 14,15 * * 0` UTC; the script runs only when it is Sunday 7am Pacific (14:00Z in summer time, 15:00Z in winter time) and exits otherwise. Pool: published public posts tagged `inkhorn-N` plus a genre tag (cross-checked against `data/editions-2026.json`, the print running order); online-only pieces are never sent. Picks at random from pieces not tagged `#sent-weekly`, emails the full piece (issue label and a link to it on the site) as an email-only post through the `inkhorn-review-digest` newsletter, then tags the piece `#sent-weekly`; the email post carries `#weekly-email` and the piece's URL as canonical_url (a second guard against repeats). When none are left it sends nothing and emails a notice to NOTICE_EMAIL. `WEEKLY_MODE` env var: unset/`dry` (default, changes nothing), `test` (test email to TEST_EMAIL, nothing tagged), `send`. `FORCE=1` skips the Sunday-7am check. `TEST_SLUGS=slug,slug:also` sends test emails of named pieces (plain = current layout, `:also` = with the "Also at Inkhorn" section) to TEST_EMAIL only. `ALSO=1` turns the "Also at Inkhorn" section on (live since 2026-11-11): one row per department with its latest item and a NEW flag, plus Muse. If Muse (api.gomuse.io/issues) released an issue after the previous weekly email, the section leads once with "New from Muse: the <name> issue" instead of the Muse row; `MUSE_FAKE_ISSUE="Winter 2027|winter-2027"` fakes a release for test samples only (never set it in production). Dear Inkhorn is added when its first column runs. The welcome step was removed 2026-11-11.
- **Contributor agreements (DocuSeal, 2026-11-11)** — DocuSeal runs on PikaPods at `https://sign.inkhornreview.com` (pod "FTR DocuSeal", custom domain set in the pod's Domain tab; `sign.lifeonwords.com` 301-redirects to it through the Cloudflare Worker `sign-lifeonwords-redirect`, source in `inkhorn/sign-redirect/`). Mail goes through SES us-east-2 (identity `inkhornreview.com`, IAM user `docuseal-ftr-smtp`), set in the pod's Env Vars tab (SMTP_ADDRESS/PORT/USERNAME/PASSWORD/FROM); sender "Inkhorn Review <hello@inkhornreview.com>". Two templates: "Inkhorn Review Contributor Agreement (Paid)" and "Inkhorn Review Contributor Agreement" (unpaid). DocuSeal's free edition ignores PDF field tags and has no HTML/PDF template API, so the PDFs and the field boxes are generated by `inkhorn/scripts/build-agreement-pdfs.cjs` (output and field maps in `inkhorn/agreements/`); to change the agreement text, rebuild the PDFs, upload one in DocuSeal, and apply the `*.fields.json` through the editor's save call (PUT `/templates/:id`, see the history of this section's commit). Locked fields (legal name, pieces, issue, release date, amount, deadline) are prefilled through the submission's `values`. Rules: no piece is published without a signed agreement 30 days before the issue's release date; Winter 2026 and the Autumn 2026 paid offer use 14 days from sending. Paid contributors choose cash or a one-year Print subscription (shown only in the agreement). Pay: $25 per poem and per prose piece up to 1,000 words; flash and micro are always $25; $40 per prose piece over 1,000 words; printed artwork is paid $40 (same as prose over 1,000 words); online-only work, art included, is not paid. Paid on release day by Zelle or PayPal (US) or Wise (elsewhere). `send-agreement.cjs --work "poem|prose:1200|art"` (add `online` to any entry, e.g. `art:online`) works out the amount; `--amount` overrides it.
  - `inkhorn/scripts/send-agreement.cjs --name --email --titles "A|B" --issue winter-2026 --amount 25 [--deadline-days 14] [--no-pull] [--dry]` sends the right template (amount 0 = unpaid) with deadline = release − 30 days (or `--deadline-days`) and adds one record per piece. Needs Keychain `docuseal-inkhorn-token` (DocuSeal Settings → API token) plus the usual Ghost Keychain items.
  - Records: a private draft Ghost page `agreements-tracker` (JSON in `codeinjection_head`): issue, slug, contributor, email, template, amount, submission id, sent date, deadline, status (sent/signed/expired), choice (cash/subscription/cash by default), `on_deadline` (`pull` or `record-cash-default`).
  - `inkhorn/agreements.cjs`, Railway `agreements` service (cron `0 15,16 * * *` UTC; runs only at 8am Pacific): updates statuses from DocuSeal; 3 days before a deadline emails hello@terryheath.com the unsigned list; after a deadline sets unsigned `pull` pieces to draft in Ghost (never publishes anything) and records `record-cash-default` pieces as "cash by default" (Autumn 2026 paid offer: already published, nothing is unpublished); a signed agreement choosing the subscription gets a complimentary Print membership for one year and an email so Terry can add them to the print mailing list. `AGREEMENTS_MODE=dry` and `FORCE=1` exist for tests. Emails go through Ghost's email preview (GHOST_STAFF_TOKEN, shared from the `digest` service by reference).
  - **The cron cannot change the running order** (that is the theme zip, which needs a git push and an Admin upload). When it pulls a piece it says so in the email; run `node inkhorn/scripts/apply-pulls.cjs` (edits `data/editions-2026.json`, renumbers, regenerates the partials), then check-editions, push, and upload the theme.
  - **Acceptance link (Duosuma letter → agreement).** `inkhorn/agreements-accept.cjs`, Railway service `agreements-accept`, `https://agreements.inkhornreview.com/accept` (Cloudflare CNAME to the Railway domain, DNS only, plus the `_railway-verify` TXT; same variables as `agreements`, shared by reference from `digest`). **Duosuma does not URL-encode placeholders**, so a link breaks at the first space in any value; only `{{TrackingLink}}` arrives intact. Duotrope's tracking page (`https://duotrope.com/duosuma/submissions/?tok=…`) shows the submitter, piece, call and the acceptance message in a browser, but sits behind a Cloudflare challenge, so a server cannot read it (do not try to get around that). The letter link is therefore `https://agreements.inkhornreview.com/accept?track={{TrackingLink}}&note={{Comments}}` (`track` first). `{{Comments}}` survives only when typed without spaces (`Spring2027`, `Spring2027-40`, `Spring2027-online`; anything after the first space is lost, harmlessly). The page asks the contributor for legal name, piece title, email and the issue (dropdown of the next four issues, preselected from the comment). On Confirm it sends the agreement through `sendAgreement()` in `agreements-lib.cjs` (same code as `send-agreement.cjs`), adds the tracker record (with `duosuma_tok`, the duplicate key together with piece + issue), and emails hello@terryheath.com one line with a link to the Duosuma page so Terry can check name, piece, call and pay. Pay comes from the comment (`40`, `25`, `online`, `art`); with nothing there it is $25 and the email says so. Deadline: release − 30 days, else 14 days from now (Terry is told); an already-released issue uses the "Already Published" template. No issue chosen: nothing is sent and Terry gets the one-line `send-agreement.cjs … --allow-unknown` command. Guards: honeypot field, 12 posts/hour/IP, 60 confirmations/day. Pieces for future issues aren't in `editions-2026.json`, so their records have `slug: null` until someone adds them; the cron's automatic pull needs the slug to take a piece out of the running order. To get name, piece and call prefilled, Duosuma would have to encode its placeholders or give a machine-readable way to read the tracking page.
  - **Pay rules (all paths):** default $25; poems $25; flash and micro always $25; prose over 1,000 words $40; printed artwork $40; online-only work, art included, is unpaid (no pay section; the unpaid template). In the acceptance comment, `$40` sets $40, `online` means unpaid, and an art call is $40.
  - **Never archive a DocuSeal template that has pending submissions.** Archiving breaks every unsigned agreement sent from it ("the form has been deleted"; it hit Michele Catalano and Karen Walker on 2026-11-11 when the old paid templates were replaced). New wording = upload a new template with the same name (`send-agreement.cjs` uses the newest template of a name) and leave the old one active until its submissions are signed; `node inkhorn/scripts/archive-template.cjs <id>` refuses while any are pending.
- **inkhorn/scheduler-check.js** — Checks for Ghost posts stuck in scheduled state. Scheduled daily via Railway (scheduler-check service). Exits 1 if any overdue posts found (Railway logs as failure).
- **inkhorn/patreon-sync.js** — Fetches active paid Patreon supporters and writes names + anonymous count to the Ghost page at slug `patreon-supporters`. Scheduled daily at 0 6 * * * UTC via Railway (patreon-sync service). Requires `PATREON_CREATOR_TOKEN`, `GHOST_API_URL`, `GHOST_ADMIN_KEY`. Stores data as JSON in the page's `codeinjection_head` (Ghost 5.x lexical editor silently drops the `html` field on PUT, so the body is not used). The home page footer injection reads this page via Content API and renders the supporter list below the issue cover image.
- **.github/workflows/import-podcast.yml** — Manual dispatch fallback for the podcast importer. No schedule.
- **.github/workflows/inkhorn-digest.yml** — Manual dispatch fallback for the digest. No schedule.
- **.github/workflows/inkhorn-scheduler-check.yml** — Manual dispatch fallback for the scheduler check. No schedule.
- **headshots/** — Guest headshot images referenced by podcast posts.
- **inkhorn/routes.yaml** — Ghost custom routes for Inkhorn Review. Defines seasonal collection URLs (`/autumn-2026/`, `/winter-2027/`, `/spring-2027/`, `/summer-2027/`, etc.) and genre channel routes (poetry, fiction, nonfiction per issue). Uploaded via Ghost Settings → Labs. The backup `inkhorn/routes.yaml.bimonthly.bak` preserves the previous bimonthly layout.
- **inkhorn/contributors.json** — Hand-maintained list of Inkhorn contributors and their book ISBNs. Add entries here to populate the book shelf.
- **inkhorn/shelves.json** — Generated output of `build-shelves.js`. Served from `raw.githubusercontent.com` and fetched client-side by the book shelf script. Commit and push after regenerating.
- **inkhorn/build-shelves.cjs** — Resolves ISBNs in `contributors.json` to titles, authors, and cover images. Writes `shelves.json`. Run with `ISBNDB_KEY` env var. Uses `.cjs` extension to bypass the root `"type":"module"` setting (file uses CommonJS `require()`).
- **inkhorn/ghost-footer-injection.html** — JavaScript block pasted into Ghost's Site Footer code injection for Inkhorn Review. Renders a "Books by [Name]" shelf on contributor post pages.
- **inkhorn/set-og-images.js** — Sets `og_image` on every post in an issue to the issue tag's cover art. Run once per issue after publishing. See Recurring tasks below.

## Recurring tasks

### Adding a contributor's books

1. Edit `inkhorn/contributors.json` — add the contributor's name and ISBN array.
2. Run the build:
   ```
   ISBNDB_KEY=$(security find-generic-password -s "isbndb-inkhorn" -w) \
     node inkhorn/build-shelves.cjs
   ```
3. Check the output — every ISBN should show `OK` with title, author, and cover.
4. Commit and push `inkhorn/shelves.json` (and `contributors.json`). The shelf appears automatically on the next page load.

### Building the issue ebook (.docx for Vellum)

**Prerequisite:** none — conversion uses the `html-to-docx` npm package already installed.

Run:
```
INKHORN_ADMIN_API_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w) \
  node inkhorn/build-ebook.js <issue-slug>
```
Example: `node inkhorn/build-ebook.js september-2026`

Uses the Ghost **Admin** API (not Content API) so it works on scheduled posts before the issue goes live. Prints a warning when any posts are still scheduled so you know it's a pre-release build.

Optional flags:
- `--by-genre` — groups pieces under Poetry / Fiction / Nonfiction headings instead of web order
- `--status=published,scheduled` — default; use `--status=published` after release to exclude scheduled posts

Output lands in `inkhorn/build/` (gitignored):
- `<issue-slug>.docx` — import into Vellum
- `<issue-slug>.html` — intermediate; inspect to verify poem line breaks before importing

Bylines come from each post's custom excerpt. The Ghost author field is not used (every post is authored by the Inkhorn Review account, not the contributor).

### Setting OG images for an issue (social sharing previews)

Run once per issue, after the issue tag's cover art is uploaded in Ghost Admin → Tags:

```
node inkhorn/set-og-images.js <issue-slug>
```
Example: `node inkhorn/set-og-images.js autumn-2026`

Sets the `og_image` field on every post tagged with the issue slug to the tag's `feature_image` URL, and also sets the site-level `og_image` setting so the bare domain shows the current issue cover. Post values are stored permanently — future issue runs only touch their own posts and never overwrite earlier ones. The site-level setting is replaced each issue.

**Prerequisite:** the issue tag must have a `feature_image` set in Ghost Admin → Tags before running. If it doesn't, the script exits with an error.

Safe to re-run: posts already set to the correct image are skipped.

### Rescheduling posts for an issue

Run:
```
node inkhorn/reschedule.js <YYYY-MM-DD> <HH:MM>
```
Example: `node inkhorn/reschedule.js 2026-11-04 00:00`

Fetches all scheduled posts, sorts them by current published_at order, and spaces them one minute apart from the given start time (UTC). Credentials come from Keychain automatically.

### Extending routes.yaml with more issues

Inkhorn publishes **4 issues per year** on a quarterly schedule. Seasons and their release months:
- **autumn** — September
- **winter** — December
- **spring** — March
- **summer** — June

An issue's pieces share its release date (the 1st, noon Pacific = 19:00 UTC in summer time, 20:00 UTC in winter time), a minute apart in print order. Every print piece lives at `/{season}-{year}/<slug>/` (primary tag = the season tag); a piece that is also tagged `micro` still gets the season tag FIRST. Free reading periods open four months before each release (Autumn May 1, Winter Aug 1, Spring Nov 1, Summer Feb 1).

Issue slugs are `{season}-{year}` in lowercase, where year is the calendar year the issue releases (e.g. `autumn-2026`, `winter-2026`, `spring-2027`, `summer-2027`). Always use "autumn", never "fall".

An issue's **release date is its catalog page's `published_at`**, not the season's nominal month and not any post's own date. Autumn 2026's catalog page published 2026-10-01, so that is Autumn's release date. Anything date-driven (the paywall window below) reads it from there.

For each new issue, add to `routes.yaml`:

1. Three channel routes (in the `routes:` section):
   ```yaml
   /{season}-{year}/poetry/:
     controller: channel
     filter: tag:{season}-{year}+tag:poetry
     order: published_at asc
   /{season}-{year}/fiction/:
     controller: channel
     filter: tag:{season}-{year}+tag:fiction
     order: published_at asc
   /{season}-{year}/nonfiction/:
     controller: channel
     filter: tag:{season}-{year}+tag:nonfiction
     order: published_at asc
   ```

2. One collection block (in the `collections:` section, before `/micro/`). Edition pages use `edition.hbs` (`template: edition`), not `tag.hbs`:
   ```yaml
   /{season}-{year}/:
     permalink: /{season}-{year}/{slug}/
     template: edition
     filter: primary_tag:{season}-{year}
     data: tag.{season}-{year}
     order: published_at asc
     limit: 999
   ```

Never remove existing blocks — those URLs are permanent once any piece publishes under them.

After editing, upload the file to Ghost: **Settings → Labs → Routes → Upload**. routes.yaml does not travel with a Ghost export and must be re-uploaded manually on any new Ghost install.

### Re-running the podcast import

Trigger manually via Railway (podcast-import service → Run now), or trigger the GitHub Actions workflow `import-podcast.yml` from the Actions tab, or run `riverside-to-ghost.js` locally with the required environment variables.

## Accounts

**One company identity: Follow the Rabbit LLC** (owner/contact email `hello@terryheath.com`). Active properties: inkhornreview.com, inkhorn.press (dormant 501(c)(3), leave as is), inkhornwriters.org and .com, lifeonwords.com, terryheath.com, goranhodzic.com (new Ghost site on PikaPods later). Everything else (White Rabbit, BookWish live services, Analog List, North Star Postal, Kindred, Passportr, artbase, Quire, ArtsFolk, BookFolk, VendCat, Lumen House, kitsapreads, washingtonreads, lumarahouse, colophon.press, Damp Concrete) is a remnant being retired. BookWish keeps its code only. BookFunnel stays (ARCs). Details, backups and the deletion list: `inkhorn/ACCOUNTS-AUDIT.md`; backups in `~/Archive/FTR-cleanup-2026-10-11/`.

| Account | Used for | ID | Credentials |
|---|---|---|---|
| **GitHub `terryheath`** | The repo `terryheath/terryheath` (public); Railway deploys from `main` | user `312312378` | SSH key `~/.ssh/id_ed25519` (works; comment is cosmetic); `gh` active account `terryheath`. Global and repo git identity: `terryheath <312312378+terryheath@users.noreply.github.com>`. Existing commits keep their older author; never rewrite history or force-push. |
| **Stripe: Inkhorn Review** (Follow the Rabbit LLC) | Shop checkout, products, webhooks; Ghost memberships for inkhornreview.com and terryheath.com | `acct_1TF3BsCItY7iMaUP` | Keychain `stripe-inkhorn-press` (restricted live key; same as `STRIPE_SECRET_KEY` on `inkhorn-shop-service`). CLI: OAuth (Keychain `StripeCLI`), live only. Test with `stripe-mock` plus locally signed webhooks, or a sandbox created inside this account. |
| **AWS "Follow the Rabbit LLC"** | SES for shop mail (identity `inkhornreview.com`, us-east-2); the private ebook bucket `inkhornreview-ebooks-private` (us-east-2). Also keeps SES identities `inkhorn.press`, `terryheath.com`, `goranhodzic.com` | `888671692472` (management account of org `o-ol2sjar4i3`) | IAM user **`inkhorn-shop`** (SES send from `inkhornreview.com` only; S3 read on the ebook bucket only): Keychain `inkhorn-shop-aws-key-id` and `inkhorn-shop-aws-secret`; Railway vars `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` on `inkhorn-shop-service`. Admin work uses `aws login --profile <name>` (root console sign-in; temporary credentials, then `aws logout`). Root email change to `hello@terryheath.com` is pending (console only). The old IAM users, root access key, remnant buckets, Lambda/SQS/SNS and remnant SES identities were deleted 2026-10-11; no CLI profiles remain. |
| **Railway** workspace "Follow the Rabbit LLC" | Project "Inkhorn Cron": digest, shop, address, patreon-sync, og-webhook, podcast-import, shelves-job, scheduler-check, terryheath-digest | project `7865f281-fb8b-46e7-90bd-ffb6babf849d` | `railway` CLI login `hello@terryheath.com` |
| **Cloudflare** | DNS for the active domains (Inkhorn, terryheath.com, goranhodzic.com, lifeonwords.com); Worker `inkhorn-press-redirect` | account `62c3c49152820690bee8bc174a6c9428` (named Follow the Rabbit LLC; `inkhornwriters.org` redirects to inkhornreview.com through the same Worker) | Wrangler OAuth cannot write DNS or use R2; DNS and Registrar changes use the API token in Keychain `cloudflare-ftr-cleanup` (Registrar auto-renew via `PATCH /accounts/<id>/registrar/registrations/<domain>`). terryheath.com's nameservers must stay `lennox`/`suzanne.ns.cloudflare.com` (they were reset by name.com on renewal). **www:** `www.terryheath.com` and `www.inkhornreview.com` are proxied (orange cloud) CNAMEs to the pods, and the Cloudflare Worker `www-to-bare-redirect` (routes `www.terryheath.com/*` and `www.inkhornreview.com/*`) answers every request with a 301 to the bare domain, keeping path and query. This exists because the PikaPods pods only hold certificates for the bare domains. The API token cannot write Redirect Rules, so this uses Workers. All other records in both zones stay DNS-only. |
| **Ghost** | inkhornreview.com (pod `accelerated-basilisk`) and terryheath.com (pod `smoky-hyena`) on PikaPods; PikaPods account email `terry@terryheath.com`; both sites send newsletters through Mailgun domain `mail.inkhornreview.com` (Mailgun account `hello@terryheath.com`) | | Keychain `ghost-admin-inkhorn`, `ghost-content-inkhorn`, `ghost-url-inkhorn`, `ghost-admin-terryheath`. |
| **Google Workspace / Cloud** | Mail for inkhornreview.com (`hello@inkhornreview.com` delivers to `hello@terryheath.com`) and the other active domains. Google Cloud is retired (`whiterabbit-prod` and `wrbc-mcp` deleted 2026-10-11, recoverable for 30 days; the Apps Script `sys-*` projects cannot be deleted from the CLI) | | `gcloud` login `hello@terryheath.com` |

**Never use:** the GitHub account `bookwishapp` (gh is logged out of it; never authenticate as it, never attach anything to it; its repos are archived as private `bookwish-*` repos under `terryheath`); Keychain `stripe-inkhorn` and the White Rabbit Stripe account `acct_1RgB0aGHehj1IHBj` (exported, closing); any Stripe sandbox not created inside `acct_1TF3BsCItY7iMaUP`.

**Cleanup status (2026-10-11):** AWS remnants, GitHub mirrors (`bookwish-*`, `dampconcrete-*`, private and archived under `terryheath`), the Terry-Heath org, Supabase, SendGrid API objects, Ghost extras, Firebase/Sanity/gcloud bookwish.io logins, `.env.local` and local config are done. Cloudflare: auto-renew is off for every remnant domain registered there; 7 remnant zones were deleted and the zones of Cloudflare-registered domains (`artsfolk.com`, `bookfolk.org`, `kitsapreads.org`, `lumarahouse.org`, `lumenhousearts.org`, `vendcat.com`, `washingtonreads.org`, `whiterabbitartistry.com`, `whiterabbitgo.com`, `whiterabbitpresents.com`) cannot be deleted and simply lapse at expiry. Held until the AWS root email reads `hello@terryheath.com`, then deleted: Cloudflare zones `bookwish.io`, `bookwish.net`, `dampconcrete.com`, `whiterabbitbookco.com` (its Google-hosted mail keeps `terry@whiterabbitbookco.com` working until then). Apps Script `sys-*` Google projects are left alone on purpose.

**Owner's own to-do (browser only; not to be raised again):** AWS root email to `hello@terryheath.com` (console); close the White Rabbit Stripe account `acct_1RgB0aGHehj1IHBj`; delete GitHub accounts `dampconcrete` and `bookwishapp`; close Inngest, SendGrid and Quire accounts. Turn auto-renew off at other registrars (lapse dates): one.com `analoglist.com` 2027-03-17, `bookwish.net` 2026-12-22, `dampconcrete.com` 2027-04-02, `fromkindred.com` 2027-03-23, `passportr.io` 2027-03-31; name.com `whiterabbitbooks.org` 2026-12-14; GoDaddy `colophon.press` 2028-01-24, `whiterabbit.cafe` about 2027-08. Cloudflare-registered remnants already have auto-renew off (they expire 2027-05-15 to 2027-08-17). Full list: `inkhorn/ACCOUNTS-AUDIT.md` section 13.

## Credentials

- **ISBNDB_KEY** — macOS Keychain, service name `isbndb-inkhorn`. Retrieve with `security find-generic-password -s "isbndb-inkhorn" -w`. To store or update: `security add-generic-password -s "isbndb-inkhorn" -a "$USER" -w "KEY_HERE"` (or `security delete-generic-password -s "isbndb-inkhorn"` first if updating).
- **Ghost Admin API key (Inkhorn)** — macOS Keychain, service name `ghost-admin-inkhorn`. Retrieve with `security find-generic-password -s "ghost-admin-inkhorn" -w`.
- **Ghost Content API key (Inkhorn)** — macOS Keychain, service name `ghost-content-inkhorn`. Retrieve with `security find-generic-password -s "ghost-content-inkhorn" -w`.
- **Ghost URL (Inkhorn)** — macOS Keychain, service name `ghost-url-inkhorn`. Retrieve with `security find-generic-password -s "ghost-url-inkhorn" -w`. Value: `https://accelerated-basilisk.pikapod.net`.
- **Ghost Admin API key (terryheath.com)** — macOS Keychain, service name `ghost-admin-terryheath`. Create in terryheath.com Ghost Admin → Settings → Integrations, then store with `security add-generic-password -s "ghost-admin-terryheath" -a "$USER" -w "KEY_HERE"`. Push to Railway: `railway variables set --service terryheath-digest "TH_GHOST_ADMIN_KEY=$(security find-generic-password -s "ghost-admin-terryheath" -w)"`.
- **Shop admin and link secret** — macOS Keychain, service names `inkhorn-shop-admin` (password for `https://download.inkhornreview.com/admin`, any username) and `inkhorn-shop-link-secret` (signs download links; also the Railway variable `LINK_SECRET` on `inkhorn-shop-service`. Changing it invalidates every link already emailed).
- **GitHub Actions secrets** — Configured on the repo's Settings → Secrets page.
- **Cloudflare** — Wrangler OAuth (run `npx wrangler login` if expired). The old DNS-only API token lived in GCP project `whiterabbit-prod`, now deleted.

## Hard-won constraints — DO NOT relearn these

- **The paywall is keyed to `inkhorn-N`, not the season tag.** An issue is the set of posts carrying its `inkhorn-N` tag; those are `visibility: paid` from release until 90 days after the issue's catalog-page `published_at`, then they go `public`. Posts carrying a season tag but **no** `inkhorn-N` are the free archive seed and stay `public` permanently — 14 of these sit under `autumn-2026`. Life on Words episodes and the founder's letter are never gated. Art is public. Gating by season tag is wrong twice over: it sweeps in the seed, and it catches any piece mis-tagged with a second season.
- **Life on Words is a column at `/life-on-words/`, numbered.** The collection filters `primary_tag:podcast` (the tag slug stays `podcast`; only the URL is branded) and `^/podcast/(.*)$` redirects to it. Each episode carries a tag slugged `low-N` named "Life on Words No. N" — the `inkhorn-N` convention, where the tag NAME is the display string so the theme prints it unparsed. `riverside-to-ghost.js` assigns it from the highest existing `low-N` read from Ghost, and appends it **last**, because `post.hbs` reads public tag position 2 as the contributor for the byline. Episodes 1–10 were backfilled by hand.
- **Ghost refuses published → scheduled.** Pulling a published post back onto a schedule needs two writes: published → draft, then draft → scheduled with a future `published_at`. Safe for Inkhorn issue posts only because none of them carry a newsletter; check `newsletter_id` before doing this to anything else, since draft → published is the transition that sends email.
- **Season collections in routes.yaml use `template: edition`.** All 21 do. They were created on `template: tag`, which silently skipped the edition hero and numbered contents; fixed 2026-10-27. Genre collections keep their own `tag-*` templates and `/digest/` keeps `index`.

- **Railway is the scheduler; GitHub Actions workflows are manual-dispatch fallbacks only.** Do not add `schedule:` triggers back to the workflows.
- **digest.js keeps its state in Ghost tags** (`#sent-weekly` on pieces, `#weekly-email` on the email posts). There is no `digest-state.json` and no watermark any more. Do not reintroduce a local state file.
- **terryheath-digest.js uses a fixed previous-calendar-month window, not a watermark.** It creates a draft, never publishes. Do not add publish/newsletter logic back.
- **terryheath-digest.js reads Inkhorn via Content API (read-only) using INKHORN_CONTENT_KEY.** It does NOT use the Inkhorn Admin API. The Inkhorn posts it fetches have canonical inkhornreview.com URLs already in the response — no URL rewriting needed.
- **imported-guids.json and .book-cache.json live on the Railway volume** (`STATE_DIR` env var). On Railway, `STATE_DIR` points to the mounted volume. Locally, `STATE_DIR` defaults to `process.cwd()` so local runs are unchanged. Do not commit these files back to git.
- **Ghost strips raw HTML on import.** Anything with markup must be wrapped in `<!--kg-card-begin: html-->` / `<!--kg-card-end: html-->`. The email card variant (`<!--kg-card-begin: email-->`) does NOT survive the same import path.
- **Ghost only sends newsletter email on a draft → published transition,** never on a post created as published in one API call. Two-step publish is required: create as draft, then update status to published.
- **inkhorn/routes.yaml does NOT travel with a Ghost export.** It must be re-uploaded via Settings → Labs on any new install, and it is irreplaceable once issues publish — there is no other canonical copy.
- **Never remove a collection block from routes.yaml.** Those URLs are permanent. Removing a block breaks every piece in that issue.
- **The book shelf renders client-side deliberately.** Do NOT rewrite it to modify post content via the Admin API — round-tripping a contributor's piece through Ghost's HTML converter risks damaging their work.
- **The Ghost Admin API CAN write settings** — `PUT /ghost/api/admin/settings/` with `Accept-Version: v6.72` updated `portal_plans` successfully (2026-10-28). The old blanket claim that it cannot was wrong. Code injection has not been retested; treat that one as unknown rather than impossible. Send the running Ghost version in `Accept-Version` — a stale `v5.0` gets a 406 whose message ("endpoint was not found") looks like a missing route and is really a version mismatch.
- **There is no paywall (since 2026-11-11).** Every piece is public, `schedule-drip.js` schedules posts as public, and Ghost's default post access is Public. Do not set `visibility: paid` again. Only the three old email-digest posts (`#digest`) stay members-only.
- **Drip posts must never have a newsletter attached.** Ghost 6.61 email segmenter bug. schedule-drip.js sets no newsletter; verify in Ghost Admin after scheduling.
- **Ebooks are delivered by the shop service, not BookFunnel.** `inkhorn/shop-service` creates a per-order download link (30 days, 5 downloads) after payment, or on the title's release time for a preorder (taken from its catalog page). Files live in the private S3 bucket `inkhornreview-ebooks-private` (us-east-2, account 888671692472; key `inkhorn-1/inkhorn-review-no-1.epub`, set per product in the Stripe metadata `file_epub`) and download state in SQLite on the Railway volume at `/data`. A preorder's release time comes from its catalog page: the page tagged `#catalog` whose `ih-book` JSON names the product's `sku` (a scheduled page releases at its `published_at`). New titles need that `sku` in the page's `ih-book` JSON and `file_epub` on the ebook product. Admin (resend, reissue, revoke, download history, file check) is at `https://download.inkhornreview.com/admin`. See `inkhorn/EBOOK-DELIVERY-PLAN.md`. Do not add BookFunnel links anywhere. `ghost-footer-injection.html` (PRINT_META, EBOOK_LINKS) is legacy and not live.
- **The address service (inkhorn/address-service/) runs on Railway.** It verifies Ghost member tokens via JWKS and writes SHIP blocks to member notes. GHOST_ADMIN_KEY lives in Railway env vars only — never in the repo.
- **Journal-piece tags.** New pieces are tagged, in order: season, contributor, genre (`fiction`, `nonfiction`, `poetry` or `micro`), `inkhorn-N`. The genre tags are what designate a journal piece: `/archive/`, the home page archive section and the genre pages select on them. The `#archive` tag (`hash-archive`) is retired; do not add it.
- **Editions and running order.** An edition is a Featured `#catalog` page (tags `#catalog`, `inkhorn-N`, and the season tag, e.g. `winter-2026`) plus a running-order file in the theme: `inkhorn/theme/partials/editions/{season}-{year}.hbs`, one line per piece in print order, generated from `inkhorn/data/editions-2026.json` by `node inkhorn/scripts/gen-edition-partials.cjs`. The home page shows whichever Featured `#catalog` page was published most recently (`order="published_at desc"`), so publishing the Winter catalog page, featured, switches the home page to Winter with no manual step. `/autumn-2026/` and `/winter-2026/` render `edition.hbs` (shared `edition-hero` and `edition-contents` partials) and show nothing but the hero and numbered contents; before its catalog page is published an edition page shows "Forthcoming". Pieces not in a running-order file stay in the general archive only (they carry a genre tag, which is what puts them there). `node inkhorn/scripts/check-editions.cjs` is the read-only checker. A new edition needs: its `inkhorn-N` tag, a running-order file, a branch in `partials/edition-contents.hbs`, routes, a catalog page, an "Inkhorn Review No. N" link in `post.hbs`, and (until its catalog page is published) a hardcoded "Forthcoming" entry in `index.hbs` (The Issues). Theme gotchas: `{{else}}` on `{{#get}}` does not fire when nothing is found (use `as |x|` plus `{{#if x}}`); `{{#has tag=}}` matches tag names, not slugs; a static route with `data:` needs `{{#with tag}}`, not `{{#tag}}`; a route's `data: tag.x` 404s until the tag has a published post.
- **The free-member welcome emails no longer pull pieces (2026-11-11).** `inkhorn/welcome.js` and the `#welcome-used` tagging are retired; the Ghost automation `member-welcome-email-free` (5 emails: day 0, 3, 7, 14, 21) is static copy that links to each department's page. The existing `#welcome-used` tags are harmless leftovers. Do not re-add content picks: they overlapped with the Sunday piece.
- **Site-wide header and footer code injection are empty and not used.** Edition and running-order work lives in the theme, `routes.yaml` and `redirects.yaml`. Per-page and per-tag `codeinjection_head` fields (catalog page `ih-book` JSON, contributor bookshelf payloads, the cover-art credit) are still in use; leave them alone. The legacy `ghost-header-injection.html` and `ghost-footer-injection.html` are not live.
- **Tier slugs are `digital` and `default-product` — NOT `print`.** The Print tier is Ghost's built-in default product and its slug cannot be changed: a PUT setting `slug: "print"` returns 200 and silently keeps `default-product`. Portal deep links are `#/portal/signup/default-product/yearly` and `#/portal/signup/digital/yearly`. The theme builds these from `{{slug}}`, so they are correct; what broke was `{{#match slug "print"}}` in `subscribe-block.hbs`, which never matched and styled Print as Digital (fixed 2026-10-28). Never assume this slug reads "print".
- **Tiers cannot be deleted.** There is no DELETE endpoint — `DELETE /tiers/:id/` 404s even on the correct `Accept-Version`. Retire a tier by setting `active: false` **and** `visibility: "none"`. Inkspiller, Ink Blotter and Inkhorn are retired this way; they still exist in the API and always will.
- **Subscriptions are yearly only.** `portal_plans` is `["yearly","free"]`; the tiers still carry monthly prices, which Portal no longer offers. Do not re-add "monthly" — a quarterly magazine sold monthly lets someone buy one issue and cancel.
- **What a subscription buys (2026-11-11):** there is no paywall, so a subscription buys the ebook of each issue (Ebook, $20/year) or four mailed quarterly print issues plus the ebook of each (Print, $48/year), and supports the journal. Print is four quarterly issues only: there are no themed or awards editions. Do not promise early access or a delayed archive.
- **Prices (2026-11-11): Ebook $20/year, Print $48/year (was $60), yearly only.** Ghost creates a new Stripe price when a tier's price changes and archives the old one; existing subscribers keep their old price until moved in Stripe (Stacey M Jones, the only print subscriber at the time, is being moved to the $48 price at her 2027-10-06 renewal, with no charge now).

## Working style

Terry does not write code. Deliver work done, not instructions to follow. No test harnesses, no verification ceremonies — he validates by using the thing and will say if it's wrong.
