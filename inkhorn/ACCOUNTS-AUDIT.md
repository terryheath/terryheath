# Accounts audit (read-only) and move-to-Follow-the-Rabbit plan

Revised 2026-10-11 with your rulings. Sections 4 to 11 are the first-pass inventory; **where they disagree with sections 0 to 3 or 12 to 14, the later rulings win.**

## 0. Status (2026-10-11)

**Backed up to `~/Archive/FTR-cleanup-2026-10-11/` (2.8 GB):** GitHub mirror clones (terryheath's 3 repos, bookwishapp's 12 public repos cloned without authenticating, dampconcrete's 2 private repos); Stripe export for White Rabbit Book Co. (every payment, customer, invoice, subscription, payout, refund, product, price, coupon, balance transaction, checkout session, plus CSV reports); all 11 S3 buckets (2.3 GB); AWS IAM authorization details, credential report, SES identities, SNS, Lambda code, SQS, bucket policies, contact info; Ghost exports for both sites; Railway variable names; Cloudflare zone list, Worker source and a public-DNS snapshot; Google Cloud service configs and bucket listings; registrar expiry dates.

**Done:**
- Stripe webhooks deleted in `acct_1TF3Bs…` (the `terryheath.com` and disabled legacy Railway endpoints). Remaining: the shop and Ghost for inkhornreview.com.
- AWS account renamed **"Follow the Rabbit LLC"** (was "Damp Concrete"); contact company set to Follow the Rabbit LLC; billing, operations and security contacts set to hello@terryheath.com.
- IAM user **`inkhorn-shop`** created (SES send from `inkhornreview.com` only, S3 read on `inkhornreview-ebooks-private` only; checked with the policy simulator). The shop's Railway keys now use it. Verified live: the admin file check reads the EPUB, IAM shows the new key in use, and a test email sent with the deployed service's own variables. The bucket policy now names `inkhorn-shop`.
- Railway workspace renamed **"Follow the Rabbit LLC"**.
- Global git config set to `terryheath <312312378+terryheath@users.noreply.github.com>` (no history rewrite).
- PikaPods owner found: the pods mail `terry@terryheath.com` (your mailbox). Mailgun owner: marketing and notices arrive at `hello@terryheath.com`.

**Blocked, and exactly why (this is the one batch of asks):**
1. **AWS root email** (`terry@bookwish.io` to `hello@terryheath.com`): the API only changes member accounts' emails, and this is the organization's management account, so it needs a console sign-in as root. I cannot drive a browser. Steps are in section 12.
2. **Cloudflare API token:** the Wrangler login cannot read or write DNS, delete zones, or rename the account. Everything DNS-related (an exact DNS export, `inkhornwriters.org` redirect, removing remnant zones, the Cloudflare account rename) needs one token. Steps are in section 12.
3. **terryheath.com is down because its nameservers were reset at name.com on 2026-10-07** (the renewal date), from Cloudflare's to name.com's own, which serve a parking page. Fix: set them back to `lennox.ns.cloudflare.com` and `suzanne.ns.cloudflare.com` at name.com (sign-in needed).
4. **terryheath.com Stripe:** Ghost recreates its Stripe webhook by itself the next time its pod starts or its Stripe key settings change (confirmed in the Ghost source). I deleted the old endpoint, so after DNS is fixed the pod needs one restart in PikaPods (account `terry@terryheath.com`), or Settings, Membership, Stripe, reconnect in terryheath.com Ghost Admin.
5. **Google Cloud billing is closed**, and Google refuses to read Cloud Storage objects from a project whose billing account is closed (HTTP 403 "billing account ... closed"). So the five GCS buckets with data in `whiterabbit-prod` (about 255 MB) **cannot be archived** until billing is reopened or a billing account is linked. Reopen "My Billing Account" in the Billing console, then I archive and you can close it again.
6. **Stripe:** adding `hello@terryheath.com` as owner/admin of the Inkhorn account, and closing the White Rabbit account (both dashboard only).
7. **Google sign-in for `terry@bookwish.io`** (so I can see whether it owns any project before signing it out).

## 1. How to read this

Labels: **IN PLAY (Inkhorn)**, **IN PLAY (other)** (live, not Inkhorn, named), **REMNANT** (proposed for deletion), **UNSURE** (your call).

**Not audited (needs a sign-in or a login I do not have):**
- Google Cloud for the second login `terry@bookwish.io`: its stored login needs re-authentication. `hello@terryheath.com` is signed in and audited (section 9). Secret Manager, Cloud Scheduler and Artifact Registry in `whiterabbit-prod` could not be read because billing is disabled on the project.
- GitHub private repos of `bookwishapp` and `dampconcrete`: I will not authenticate as either (your rule).
- PikaPods and Mailgun account owners: no credentials anywhere on this Mac.
- Cloudflare DNS record contents, API tokens, R2: the Wrangler login lacks those scopes. I used public DNS instead.
- Stripe restricted keys and connected apps: the dashboard only (no API).
- Firebase, Sanity, Inngest, Flutter, Supabase CLI, Quire, OneAuth: their config folders and Keychain items exist; opening them would mean reading token files, so I only list them.

## 2. Rulings applied

**Identity:** Follow the Rabbit LLC is the one company identity; owner/contact email `hello@terryheath.com`; display name "Follow the Rabbit LLC". Rename in place (Route B dropped everywhere).

**ACTIVE:** inkhornreview.com, inkhorn.press (dormant 501(c)(3), left as is), inkhornwriters.org, inkhornwriters.com (owned, GoDaddy, points at a Wix site), lifeonwords.com, terryheath.com, goranhodzic.com (a new Ghost site on PikaPods later; the old site and host are remnants). BookFunnel stays.
**BookWish:** keep its code only (repos archived under terryheath); everything live under bookwish.io is a remnant.
**Remnants:** White Rabbit, Analog List, North Star Postal, associations, marketplace/Amazon tooling, Kindred, Passportr, artbase, Quire, Damp Concrete, ArtsFolk, BookFolk, VendCat, Lumen House, kitsapreads, washingtonreads, lumarahouse, colophon.press.

**One thing to confirm before domains lapse:** `whiterabbitbookco.com` is the send-as address `terry@whiterabbitbookco.com` that your global notes use for all White Rabbit Book Co. outreach (events: Reader, I.; The Books Remain; Otherwise; Sleuths; business entity DBA). Retiring that domain stops that address. I have kept it on the removal list because you ruled all White Rabbit a remnant; say so if the DBA is still operating.

## 3. Rulings on the UNSURE list (all resolved by you)

| # | Item | Ruling | Status |
|---|---|---|---|
| 1 | GitHub `dampconcrete` | Remnant; delete the account after cloning | Cloned (2 private repos). Deletion needs a web sign-in, queued |
| 2 | Org `Terry-Heath` | Delete after a mirror clone | Cloned (empty repo). Queued |
| 3 | SSH `id_ed25519` | Keep | Kept |
| 4 | AWS root access key | Delete | Queued (after root email change) |
| 5, 6 | IAM `terryheath-ghost`, `marketplace-s3-ses`, `sp-api-marketplace`, `whiterabbit-cross-cloud`, `ses-smtp-user.*`, old inactive key on `bookwish-ses-sender` | Delete | Queued |
| 7 | OG webhooks | Keep Railway `og-webhook`; delete Cloud Run `inkhorn-og-webhook`, its image, `inkhorn-webhook-sa`, and the "OG Image Setter" Ghost integration | Queued |
| 8 | Ghost staff `terry-2` | Delete | Queued |
| 9, 10 | Domains on `8.233.214.255` or with no A record | Remnants, except `goranhodzic.com` and `inkhornwriters.org` (redirect to inkhornreview.com like inkhorn.press) | Redirect needs the Cloudflare token |
| 11 | `inkhornwriters.org`, `lifeonwords.com` | Active (Inkhorn) | |
| 12 | Firebase, Sanity, Inngest, Flutter, Supabase, Quire | Remnants; delete remote projects if they hold only remnant work, then sign out | See section 13: each needs its own sign-in |
| 13 | PikaPods and Mailgun owners | Find in the mailbox | PikaPods: `terry@terryheath.com`; Mailgun: `hello@terryheath.com` |
| 14 | terryheath.com | Fix it | Root cause found (nameservers reset at name.com); needs the batched steps in section 0 |
| 15, 16 | `whiterabbit-prod`, `wrbc-mcp` | Remnants; archive anything with data, then delete | Blocked on reopening billing for data; configs archived |
| 17 | `terry@bookwish.io` Google login | Remnant; audit once if it owns a project, then sign out | Needs its re-sign-in |
| 18 | `sys-*` projects | Delete any whose Apps Script has not run in 90 days | Need each project's script execution history (needs the Apps Script API on that login); not yet evaluated |

## 2a. Summary table (final dispositions)

| System | Account / ID | Disposition |
|---|---|---|
| GitHub `terryheath` | user 312312378 | KEEP (active) |
| GitHub `bookwishapp` | user 218007121 | KEEP the account; its 12 public repos archived under terryheath |
| GitHub `dampconcrete`, org `Terry-Heath` | | DELETE after backup |
| Stripe Inkhorn Review | `acct_1TF3BsCItY7iMaUP` | KEEP (shop, Ghost for inkhornreview.com and terryheath.com) |
| Stripe White Rabbit Book Co. | `acct_1RgB0aGHehj1IHBj` | EXPORT (done), then CLOSE |
| AWS `888671692472` | now "Follow the Rabbit LLC" | KEEP, trimmed to Inkhorn + terryheath.com + goranhodzic.com |
| Railway | workspace "Follow the Rabbit LLC" | KEEP |
| Cloudflare | account `62c3c4…` | KEEP, rename; keep 6 zones; remove 21 |
| Google Cloud | `whiterabbit-prod`, `wrbc-mcp`, `sys-*` | DELETE (after billing reopen for archive) |
| Google Workspace | hello@ / terry@ | KEEP; remove remnant secondary domains |
| Ghost inkhornreview.com, terryheath.com | PikaPods | KEEP |
| Mailgun | `hello@terryheath.com` | KEEP |
| SES | us-east-1/2/west-2 | KEEP 4 identities, remove the rest |
| SendGrid, Supabase, Firebase, Sanity, Inngest, Flutter, Quire | various | REMNANT (sign-in needed to delete each) |
| BookFunnel | | KEEP |

## 4. GitHub

| Item | What | Used by / evidence | If removed | Label |
|---|---|---|---|---|
| `terryheath` login in `gh` | Active account, scopes `admin:repo_hook,gist,read:org,repo,workflow` | Pushes to `terryheath/terryheath`; Railway deploys show author `terryheath` | Cannot push | IN PLAY (Inkhorn) |
| `bookwishapp` login in `gh` | Inactive login, scopes `gist,read:org,repo,workflow` | Global git author on every commit (157), 12 public repos incl. `terryheath-com`, `terryheath-site`, `terryheath-auth` | Local `gh` login only; repos unaffected | IN PLAY (other) |
| `dampconcrete` login in `gh` | Inactive, 0 public repos | Nothing seen | Local login only | UNSURE |
| Org `Terry-Heath` | Free org, 1 private repo | No recent use | Delete the org | UNSURE |
| Repo `terryheath/terryheath` | PUBLIC; pushed 2026-10-11; 5 Actions secrets (`BSKY_APP_PASSWORD`, `BSKY_HANDLE`, `GHOST_ADMIN_KEY`, `GHOST_API_URL`, `ISBNDB_KEY`); no deploy keys; no webhooks | Source for all Railway services | Everything stops deploying | IN PLAY (Inkhorn) |
| Repo `terryheath/whiterabbit` | Private, 14 MB, pushed 2026-08-29 | Not referenced from this repo | Lose WRBC code | IN PLAY (other) |
| SSH `~/.ssh/id_ed25519` | Comment `claude@anthropic.com`; authenticates as `terryheath` | All `git@github.com` pushes | Pushes fail | UNSURE (see 3.3) |
| SSH `~/.ssh/google_compute_engine` | RSA 3072, `terryheath@Mac.attlocal.net` | gcloud/Compute | GCP SSH | IN PLAY (other) |
| Git global config | `user.name bookwishapp`, `user.email terryheath@yahoo.com`; credential helpers `osxkeychain` and `gh` | Every repo without a local override | Commits get a different author | REMNANT (change author) |
| Git repo-local config here | `terryheath <312312378+terryheath@users.noreply.github.com>` | This repo | | IN PLAY (Inkhorn) |
| Keychain `gh:github.com`, `GitHub - https://api.github.com` | gh and git credentials | gh/git | Re-login | IN PLAY (Inkhorn) |

`terryheath`'s SSH keys could not be listed (the token lacks `admin:public_key`).

## 5. Stripe

| Item | What | Used by / evidence | If removed | Label |
|---|---|---|---|---|
| Account `acct_1TF3BsCItY7iMaUP` | Inkhorn Review / Follow the Rabbit LLC, hello@inkhornreview.com | 10 products, 3 charges today, 1 active subscription | Shop and memberships stop | IN PLAY (Inkhorn) |
| Keychain `stripe-inkhorn-press` | Restricted live key for the account above | Shop (same key as Railway `STRIPE_SECRET_KEY`), my admin tasks | Rotate the Railway var too | IN PLAY (Inkhorn) |
| CLI login `StripeCLI` (default profile) | OAuth to the Inkhorn account, live only | Stripe CLI | Re-login | IN PLAY (Inkhorn) |
| Products in the Inkhorn account | `Inkhorn Review No. 1 eBook` and `No. 1` (print); `Digital`, `Print`, `Inkhorn`, `Ink Blotter`, `Inkspiller` (membership tiers); `Editor evaluation`, `Reader evaluation`, `Support Inkhorn Review` | Print/ebook: shop. Others: Ghost tiers and evaluations. All active | Orders for them fail | IN PLAY (Inkhorn) |
| Webhooks | Two remaining (see 0) | Shop, Ghost | | IN PLAY (Inkhorn) |
| Account `acct_1RgB0aGHehj1IHBj` | White Rabbit Book Co.; 11 products; webhooks to `api.whiterabbitgo.com` (3); last charge 2026-07-30 | `whiterabbitgo.com` app | That business stops | IN PLAY (other) |
| Keychain `stripe-inkhorn` | Restricted live key for White Rabbit Book Co. | Whiterabbitgo tools | | IN PLAY (other) |
| `~/.env.local` `STRIPE_SECRET_KEY` | Full-access live secret key for White Rabbit Book Co., in plaintext | Probably a local dev project | Rotate | UNSURE (move to Keychain or delete) |
| `~/.env.local` `INKHORN_STRIPE_SECRET_KEY` | Live key, expired | Nothing | Nothing | REMNANT |
| Old CLI login | White Rabbit (expired 2026-09-08) | Nothing | | REMNANT (already gone from config) |
| Sandbox `acct_1UP9L9BUVn9ySAvD` | Detached sandbox I created; its profile is deleted | Nothing | Expires 2026-10-18 | REMNANT |
| Restricted keys, connected apps | Not listable by API | | | UNSURE (review in dashboard) |

## 6. AWS account 888671692472 (read with a temporary root session, now signed out)

**Account:** name **"Damp Concrete"**, management account of organization `o-ol2sjar4i3` (it is the only account in the org), root email `terry@bookwish.io`, contact "Terry Heath, Inkhorn Review", root MFA on, **root access key active**. Spend is about $0.03–$0.11 a month (S3 and SES only).

**This is the shared account for most of your projects**, not an Inkhorn account.

| Item | What | Used by / evidence | If removed | Label |
|---|---|---|---|---|
| IAM `bookwish-ses-sender` | Policies: `AmazonSESFullAccess`, `AmazonSNSFullAccess`; inline S3 access for `analogist-avatars`, `associations-releases`, `north-star-postal-letters`; self key rotation. Active key created 2026-08-11, last used today | Shop email (Railway), Analog List, North Star Postal, associations; also my local `default` profile | Shop email stops; the other apps' uploads stop | IN PLAY (Inkhorn) and (other) |
| Same user, old key | Inactive, created 2025-11-05, last used 2026-08-11 | Nothing | Nothing | REMNANT |
| IAM `ses-smtp-user.20260324-111916` | Group `AWSSESSendingGroupDoNotRename`; key last used on the day it was made | Nothing | Nothing | REMNANT |
| IAM `terryheath-ghost` | SES SMTP; last used 2026-05-18 | Probably terryheath.com Ghost mail, before Mailgun | terryheath.com mail | UNSURE |
| IAM `marketplace-s3-ses`, `sp-api-marketplace` | Amazon marketplace tooling; last used 2026-05-19 | Lambda `marketplace-sqs-to-webhook-forwarder`, SQS `marketplace-amazon-orders` | That tooling | UNSURE |
| IAM `whiterabbit-cross-cloud` | SES; last used 2026-08-11 | White Rabbit | | UNSURE (see 3.6) |
| IAM role `marketplace-sqs-forwarder-role` | For the Lambda | The Lambda | Lambda fails | IN PLAY (other) |
| Root access key | Created 2026-03-27, last used 2026-05-19 | Unknown | Anything using it fails | UNSURE |
| SES us-east-2 | Identities: `inkhornreview.com`, `colophon.press`, `analoglist.com`, `terryheath.com`, `northstarpostal.com`, `hello@bookwish.net`, `tech@bookwish.io`, `terry@terryheath.com`, `letter@terryheath.com` | `inkhornreview.com` is the shop sender (DKIM verified, DNS CNAMEs present, 6 sent in the last day); bounces/complaints go to my SNS topic | Shop mail stops | IN PLAY (Inkhorn) and (other) |
| SES us-east-1 | 20 identities (kitsapreads.org, lumenhousearts.org, whiterabbit.cafe, whiterabbitgo.com, artbase.studio, inkhorn.press, passportr.io, goranhodzic.com, bookwish.io, whiterabbitpresents.com, artsfolk.com, whiterabbitartistry.com, terryheath.com, fromkindred.com, whiterabbitbookco.com, sinclairinlet.com, bookfolk.org, dampconcrete.com, hello@whiterabbitbooks.org, terry@terryheath.com); configuration set `dampconcrete` | Other projects; `inkhorn.press` is Inkhorn-adjacent | | IN PLAY (other) |
| SES us-west-2 | `artsfolk.com`, `bookfolk.org` | Other | | IN PLAY (other) |
| SNS | `dampconcrete-ses-events` (us-east-1, us-east-2); `inkhorn-ses-feedback` (us-east-2, mine, subscribed hello@inkhornreview.com) | | | IN PLAY (other) / IN PLAY (Inkhorn) |
| S3 `inkhornreview-ebooks-private` | Private ebook bucket (mine), versioned | Shop downloads | Ebook delivery stops | IN PLAY (Inkhorn) |
| S3 others | `analogist-avatars`, `artbase-uploads`, `associations-releases`, `bookwish-avatars`, `dampconcrete-marketplace-catalog`, `goran-artsite` (empty), `kindred-image`, `north-star-postal-letters`, `passportr-images`, `terryheath-com` (empty) | Other projects, last writes March–May 2026 | | IN PLAY (other); `goran-artsite` and `terryheath-com` are empty: UNSURE |
| Lambda, SQS | `marketplace-sqs-to-webhook-forwarder`, `marketplace-amazon-orders` (us-east-1) | Marketplace order forwarding | | IN PLAY (other) |
| EC2, RDS, DynamoDB, Route 53, CloudFront | None found in 17 enabled regions | | | |

## 7. Railway (login `hello@terryheath.com`, workspace "terryheath's Projects")

One project, **Inkhorn Cron**, environment `production`, source repo `terryheath/terryheath`:

| Service | Runs | Domains | Variable names (values not read) | Label |
|---|---|---|---|---|
| digest | `node inkhorn/digest.js`, Sundays 14:00 UTC (also the welcome-card step) | | `BSKY_APP_PASSWORD`, `BSKY_HANDLE`, `GHOST_ADMIN_KEY`, `GHOST_API_URL`, `GHOST_STAFF_TOKEN`, `PUBLISH_MODE` | IN PLAY (Inkhorn) |
| inkhorn-shop-service | Express shop and downloads | `download.inkhornreview.com`, `*.up.railway.app` | `ADMIN_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_REGION`, `AWS_SECRET_ACCESS_KEY`, `CORS_ORIGIN`, `DATA_DIR`, `DOWNLOAD_BASE_URL`, `GHOST_ADMIN_KEY`, `GHOST_URL`, `LINK_SECRET`, `S3_BUCKET`, `SITE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | IN PLAY (Inkhorn) |
| address-service | Shipping addresses | `address.inkhornreview.com` | `GHOST_ADMIN_KEY`, `GHOST_URL` | IN PLAY (Inkhorn) |
| og-webhook | OG images on publish | `*.up.railway.app` | `GHOST_ADMIN_KEY`, `GHOST_URL`, `WEBHOOK_SECRET` | IN PLAY (Inkhorn); duplicate? (3.7) |
| podcast-import | Daily 13:00 UTC | | `BOOKSHOP_ID`, `GHOST_ADMIN_KEY`, `GHOST_API_URL`, `HEADSHOT_DIR`, `ISBNDB_KEY`, `MAX_AGE_DAYS`, `NEWSLETTER_SLUG`, `POST_STATUS`, `STATE_DIR` | IN PLAY (Inkhorn) |
| shelves-job | Daily 02:00 UTC | | `GHOST_ADMIN_KEY`, `GHOST_API_URL`, `ISBNDB_KEY`, `STATE_DIR` | IN PLAY (Inkhorn) |
| patreon-sync | Daily 06:00 UTC | | `GHOST_ADMIN_KEY`, `GHOST_API_URL`, `PATREON_CREATOR_TOKEN` | IN PLAY (Inkhorn) |
| scheduler-check | Daily 15:30 UTC | | `GHOST_ADMIN_KEY`, `GHOST_API_URL` | IN PLAY (Inkhorn) |
| terryheath-digest | Monthly, 1st 16:00 UTC | | `INKHORN_API_URL`, `INKHORN_CONTENT_KEY`, `TH_GHOST_ADMIN_KEY`, `TH_GHOST_API_URL` | IN PLAY (other): terryheath.com |
| Volumes | `podcast-import-volume` (33 MB/500), `shelves-job-volume` (83 MB/5000), `inkhorn-shop-service-volume` (/data, new) | | | IN PLAY (Inkhorn) |

All nine services last deployed successfully on 2026-10-11. Nothing else exists in the workspace.

## 8. Cloudflare (Wrangler login `terryheath@yahoo.com`, account `62c3c49152820690bee8bc174a6c9428`, name "Terryheath@yahoo.com's Account")

27 zones, all on the Free plan, nameservers `lennox`/`suzanne.ns.cloudflare.com`. Workers: one (`inkhorn-press-redirect`). Pages, KV, D1: none. R2: not enabled. Email Routing on `inkhornreview.com`: a catch-all rule that is **disabled** (drop). API tokens and DNS records could not be read with this login; DNS below is from public lookups.

| Zone | Registrar | Evidence of use | Label |
|---|---|---|---|
| `inkhornreview.com` | Cloudflare, expires 2027-08-29 | A to PikaPods (216.152.155.147), `www` CNAME `accelerated-basilisk.pikapod.net`, MX smtp.google.com, SES DKIM CNAMEs, `address.` and `download.` CNAMEs to Railway, DMARC `p=none` | IN PLAY (Inkhorn) |
| `inkhorn.press` | GoDaddy, expires 2027-07-25 | Worker returns 301 to inkhornreview.com; MX Google; SPF Google + SES | IN PLAY (Inkhorn) |
| `terryheath.com` | name.com, renewed to 2027-10-05 | A `91.195.240.94` = parking page; the site is down; the Ghost pod exists | IN PLAY (other), broken |
| `whiterabbitgo.com`, `whiterabbitbookco.com`, `whiterabbit.cafe` (expires ~Aug 2027, GoDaddy), `whiterabbitbooks.org`, `whiterabbitartistry.com`, `whiterabbitpresents.com` | various | White Rabbit; MX Google/iCloud on some | IN PLAY (other) |
| `bookwish.io`, `bookwish.net`, `bookfolk.org`, `artsfolk.com`, `dampconcrete.com` | one.com / name.com | BookWish family; `bookwish.io` MX iCloud; SES SPF | IN PLAY (other) |
| `analoglist.com`, `artbase.studio`, `fromkindred.com`, `passportr.io`, `quire.page`, `whiterabbitbooks.org` | one.com / name.com | Cloudflare-proxied apps (HTTP 404 at the root) | IN PLAY (other) |
| `lifeonwords.com` | | HTTP 200 via Cloudflare | UNSURE (podcast brand?) |
| `inkhornwriters.org` | | A to `8.233.214.255`, HTTPS fails | UNSURE |
| `goranhodzic.com`, `vendcat.com`, `kitsapreads.org`, `lumarahouse.org`, `lumenhousearts.org`, `washingtonreads.org` | | See 3.9, 3.10 | UNSURE |

## 9. Google Cloud (login `hello@terryheath.com`, default project `whiterabbit-prod`; second login `terry@bookwish.io` not audited)

14 projects: **`whiterabbit-prod`** ("Follow the Rabbit Ecosystem", number 607719180653, created 2026-05-20, owner `hello@terryheath.com`), **`wrbc-mcp`** ("WRBC MCP", 2026-05-20) and 12 system projects `sys-*` (Apps Script / Workspace; two named "Gmail Sheets mail merge", ten "Untitled project").

**Billing:** both real projects use billing account `017622-55A46D-07260A` ("My Billing Account"), which is **closed** (`open: false`), so billing is disabled on both. Secret Manager, Cloud Scheduler, Artifact Registry and Compute list calls fail with "requires billing to be enabled". The 8 Cloud Run services below still show Ready. CLAUDE.md mentions a DNS token `whiterabbit-cloudflare-api-token` in `whiterabbit-prod` Secret Manager; I could not confirm it exists.

| Item | What | Used by / evidence | If removed | Label |
|---|---|---|---|---|
| Cloud Run `inkhorn-og-webhook` (us-central1) | OG image setter, created 2026-09-07, runs as `inkhorn-webhook-sa`, env `GHOST_URL`, `GHOST_ADMIN_KEY`, `WEBHOOK_SECRET` | Ghost integration "OG Image Setter" (`post.published`, status 200 today) | Duplicate of Railway `og-webhook`; Ghost integration needs removing too | UNSURE (duplicate) |
| Cloud Run `ecosystem-api`, `ecosystem-jobs`, `web-admin`, `web-art`, `web-bookwish`, `web-intake`, `web-public` | White Rabbit / BookWish ecosystem | Created May to July 2026, Ready | Those apps stop | IN PLAY (other) |
| Service account `inkhorn-digest` | Inkhorn digest identity from before Railway | The digest now runs on Railway | Nothing | UNSURE |
| Service account `inkhorn-webhook-sa` | Runs the Cloud Run OG webhook | That service | The service | UNSURE (tied to the duplicate) |
| Service accounts `github-deploy`, `whiterabbit-api-sa`, `whiterabbit-cloudbuild`, `whiterabbit-jobs-sa`, default compute | White Rabbit deploys and jobs | | | IN PLAY (other) |
| Bucket `whiterabbit-inkhorn-submissions` | **Not empty**: 487,586 bytes under `submissions/` (corrected from the first pass) | Old Inkhorn submissions; readable only once billing is reopened (see section 0) | Loses those files | REMNANT after archiving |
| Buckets `whiterabbit-events-images` (140 objects, newest 2026-08-26), `whiterabbit-art-images` (32), `whiterabbit-bookwish-avatars` (6), `whiterabbit-podcast-releases` (1, 2026-08-28), `whiterabbit-prod-backups` (4, 2026-07-27), `run-sources-whiterabbit-prod-us-central1` | White Rabbit / BookWish | | | IN PLAY (other) |
| Buckets `whiterabbit-backups`, `whiterabbit-images`, `whiterabbit-labels` | Empty | | | UNSURE |
| Artifact Registry image `whiterabbit/inkhorn-og-webhook:latest` | Image for the Cloud Run service | | | UNSURE (with the service) |
| Project `wrbc-mcp` | Drive, Docs, Sheets, Slides, Gmail, Calendar APIs enabled; no compute | Likely the Google MCP connector for White Rabbit | MCP connector stops | IN PLAY (other) |
| 12 `sys-*` projects | Apps Script / Workspace system projects | | | UNSURE |
| `~/.config/gcloud` | `hello@terryheath.com` (re-authenticated just now), `terry@bookwish.io` (expired), ADC file (expired) | | | IN PLAY (other) |
| `~/.ssh/google_compute_engine` | SSH key for Compute | No VMs readable | | UNSURE |

## 10. Google Workspace, email senders, Ghost, Keychain, config files

| Item | What | Used by / evidence | If removed | Label |
|---|---|---|---|---|
| Google Workspace for `inkhornreview.com` | MX `smtp.google.com`, SPF, Google DKIM | `hello@inkhornreview.com` delivers into the `hello@terryheath.com` mailbox (the SNS confirmation arrived there); Ghost contact address | Inkhorn mail stops | IN PLAY (Inkhorn) |
| Workspace for `inkhorn.press`, `kitsapreads.org`, `lumarahouse.org`, `lumenhousearts.org`, `whiterabbit*` | MX Google | Other mail | | IN PLAY (other) |
| Domain aliases / users | Cannot read without Admin console | | | UNSURE |
| Mailgun `mail.inkhornreview.com` | SPF `include:mailgun.org`; set as `mailgun_domain` on both Ghost sites | Newsletters (Weekly Digest, Life on Words, Weekly Micro, Founder's Letter) for inkhornreview.com, and terryheath.com's Ghost | Newsletters stop | IN PLAY (Inkhorn) |
| SES | See 6 | Shop order and delivery email | | IN PLAY (Inkhorn) |
| SendGrid | Free plan, verified sender `support@bookwish.io`, key in `~/.env.local` | BookWish | | IN PLAY (other) |
| Ghost inkhornreview.com | Version 6.67; staff `terry-heath` (terry@inkhornreview.com, Administrator), `terry` (terry@terryheath.com, **Owner**), `inkhorn` (hello@inkhornreview.com, Contributor), `terry-2` (locked); integrations Zapier, Transistor (unused), `Inkhorn` and `OG Image Setter` (both webhook `post.published`); Stripe connected live | Production site | | IN PLAY (Inkhorn) |
| Ghost terryheath.com | Pod `smoky-hyena`; owner `terry@terryheath.com`; 97 members, paid on, Stripe live (the Inkhorn account), latest post 2026-10-02; integrations not readable with the key | Monthly letter draft job (`terryheath-digest`) | | IN PLAY (other) |
| PikaPods | Both pods on `podhost70.us.pikapod.net` | Both sites HTTP 200 | Sites disappear | IN PLAY (Inkhorn) / (other); account owner unknown |
| BookFunnel | Account for ARCs | Left in place as asked | | IN PLAY (Inkhorn) |
| Keychain items (names) | `ghost-admin-inkhorn`, `ghost-content-inkhorn`, `ghost-url-inkhorn`, `ghost-admin-terryheath`, `isbndb-inkhorn`, `stripe-inkhorn-press`, `stripe-inkhorn` (White Rabbit), `StripeCLI`, `inkhorn-shop-admin`, `inkhorn-shop-link-secret`, `gh:github.com`, `GitHub - api.github.com` | Scripts and CLIs | | IN PLAY (Inkhorn) except as noted |
| Keychain: `Supabase CLI`, `page.quire.mac`, `Claude Code-credentials`, `OneAuthAccount`, assorted app items | Other apps | | | IN PLAY (other) |
| `~/.aws` | `default` profile = IAM `bookwish-ses-sender` keys; `sesfix` profile has a region only; `inkhorn-audit` and `inkhorn-setup` profiles I created (login-based, signed out) | Shop admin tasks | | IN PLAY (Inkhorn); `sesfix` REMNANT |
| `~/.config` | `stripe`, `gh`, `git`, `gcloud`, `google-mcp`, `firebase`, `flutter`, `sanity`, `inngest`, `configstore` | See 3.12 | | UNSURE |
| `~/.env.local` | Variable names: `ADMIN_PASSWORD`, `INKHORN_STRIPE_SECRET_KEY` (expired), `STRIPE_SECRET_KEY` (White Rabbit live, full access), `NEXT_PUBLIC_*` (Stripe, Supabase, site URL), `SENDGRID_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | A local Next.js project; modified 2026-09-12 | Local project breaks | UNSURE; the expired key is a REMNANT |

## 11. Local leftovers

| Path | What | Label |
|---|---|---|
| `~/Publisher/terryheath` (322 MB) | The repo. Untracked clutter: `inkhorn/routes.yaml.pre-*.bak` (4 untracked, 6 total), `inkhorn.png`, `poem-wrap.js`, `redate-september-2026.js`, `set-schedule.js`, `GENRE-TAG-AND-DIGEST-AUDIT.md`, `submissions-20261007-021801/`, `submissions-20261007-021801 2/` (duplicate) and `submissions-20261007-021801.zip` | IN PLAY (Inkhorn); the `.bak` files, the duplicate submissions folder and the zip are REMNANT |
| `~/Publisher/Inkhorn` (55 MB) | `2026/` Pages files and the corrected EPUB (the master), `2027/` | IN PLAY (Inkhorn) |
| `~/Desktop/inkhorn` (30 MB), `~/Desktop/inkhorn print cover`, `inkhorn.pdf`, `~$` Word lock files | Print files (InDesign, PDFs), an older EPUB (Oct 4, 16 chapters) | UNSURE (archive after print is final) |
| `~/Documents/Leaves of Grass`, `~/Desktop/Leaves of Grass*` | Not Inkhorn | IN PLAY (other) |

## 12. Plan: one identity (Follow the Rabbit LLC / hello@terryheath.com), renamed in place

Order matters. Status: done, or the exact step that needs you.

1. **Back up** (done, section 0). Remaining gaps: GCS data (billing closed) and exact DNS records (no token).
2. **AWS rename and contacts** (done). **Root email change (needs you, first):** sign in at https://console.aws.amazon.com as the root user (current root email `terry@bookwish.io`, with its MFA code). Click your account name (top right), then **Account**, **Root user email address** (or **Security credentials**, then **Edit root email**), enter `hello@terryheath.com`, and confirm the code AWS sends to the new address (I can read that from your mailbox). Do this before anything under bookwish.io is retired.
3. **`inkhorn-shop` IAM user and cutover** (done and verified).
4. **Cloudflare token (needs you):** dash.cloudflare.com, My Profile, **API Tokens**, **Create Token**, **Create Custom Token**, name "ftr-cleanup", permissions: Account / Account Settings / Edit; Zone / Zone / Edit; Zone / DNS / Edit; Zone / Zone Settings / Edit; Account / Workers Scripts / Edit; Account / Email Routing Addresses / Edit; Zone Resources: Include, All zones; Account Resources: Include, your account. Create, then paste the token into this chat (I store it in Keychain as `cloudflare-ftr-cleanup` and use it for: exact DNS export, `inkhornwriters.org` redirect, terryheath.com records, zone removals, the account rename). Delete the token when the cleanup is done.
5. **terryheath.com:** at name.com, **My Domains**, `terryheath.com`, **Nameservers**, replace with `lennox.ns.cloudflare.com` and `suzanne.ns.cloudflare.com`. Then I check the Cloudflare zone's records (apex A to `216.152.155.147`, `www` CNAME to `smoky-hyena.pikapod.net`, the same pattern as inkhornreview.com) and fix them with the token. Then restart the pod in PikaPods (sign-in as `terry@terryheath.com`) so Ghost recreates its Stripe webhook; I confirm the webhook appears in `acct_1TF3Bs…`, then check `https://terryheath.com/`.
6. **Account renames:** Railway (done), AWS (done), Cloudflare (step 4 token), Stripe (already "Inkhorn Review"; add `hello@terryheath.com` as owner/admin under Settings, Team: needs you).
7. **Mailgun, PikaPods:** change each account's owner email to `hello@terryheath.com` (PikaPods is `terry@terryheath.com` today, the same mailbox; Mailgun is already `hello@terryheath.com`). Needs a sign-in to each only if you want the email changed; no action is required for the cleanup.
8. **Deletions:** after you say "go" (section 13).

## 13. Deletion list (nothing here has been deleted)

Every item shows what, where, and where it is backed up. "Needs you" = a web sign-in or step I cannot do.

**GitHub**
1. Account `dampconcrete` and its repos `ecosystem` (98 MB) and `print-agent`. Backup: `github/dampconcrete_*.git`. *Needs you:* GitHub Settings, Delete account.
2. Org `Terry-Heath` (empty repo). Backup: `github/Terry-Heath_terryheath.git`. *Needs you:* org Settings, Delete.
3. Local `gh` logins for `dampconcrete` (and `bookwishapp`). Backup: n/a (tokens).
4. BookWish code: push the 12 bookwishapp mirrors to private repos under terryheath and archive them (`bookwish-<name>`). Backup: `github/bookwishapp__*.git`. Non-destructive; done on "go".

**Stripe**
5. White Rabbit Book Co. account `acct_1RgB0aGHehj1IHBj` (close). Backup: `stripe/whiterabbit-acct_1RgB0aGHehj1IHBj/` (JSON for every object plus CSV reports). *Needs you:* dashboard, Settings, Close account (after any balance is paid out).
6. Keychain `stripe-inkhorn`; `~/.env.local` (White Rabbit live full-access key, expired Inkhorn key, SendGrid, Supabase, admin password). Backup: variable names only (no values archived on purpose). Local.
7. Stripe sandbox `acct_1UP9L9BUVn9ySAvD`: expires 2026-10-18 by itself.

**AWS 888671692472** (after the root email change)
8. IAM users: `bookwish-ses-sender` (and its inactive key), `terryheath-ghost`, `marketplace-s3-ses`, `sp-api-marketplace`, `whiterabbit-cross-cloud`, `ses-smtp-user.20260324-111916`; group `AWSSESSendingGroupDoNotRename`; role `marketplace-sqs-forwarder-role`; the root access key. Backup: `aws/config/iam-authorization-details.json`, `credential-report.csv`.
9. S3 buckets (all backed up in `aws/s3/`): `analogist-avatars` (5 files), `artbase-uploads` (39, 336 MB), `associations-releases` (10, 1.2 GB), `bookwish-avatars` (7), `dampconcrete-marketplace-catalog` (105, 95 MB), `kindred-image` (10), `north-star-postal-letters` (175, 713 MB), `passportr-images` (9), and the empty `goran-artsite` and `terryheath-com`. **Kept:** `inkhornreview-ebooks-private`.
10. Lambda `marketplace-sqs-to-webhook-forwarder`, SQS `marketplace-amazon-orders`, SNS `dampconcrete-ses-events` (us-east-1 and us-east-2), SES configuration set `dampconcrete`. Backup: `aws/config/lambda-*`, `sqs-*`, `sns-*`, `ses/`.
11. SES identities for remnant domains. us-east-2: `colophon.press`, `analoglist.com`, `northstarpostal.com`, `hello@bookwish.net`, `tech@bookwish.io`. us-east-1: `kitsapreads.org`, `lumenhousearts.org`, `whiterabbit.cafe`, `whiterabbitgo.com`, `artbase.studio`, `passportr.io`, `bookwish.io`, `whiterabbitpresents.com`, `artsfolk.com`, `whiterabbitartistry.com`, `fromkindred.com`, `whiterabbitbookco.com`, `sinclairinlet.com`, `bookfolk.org`, `dampconcrete.com`, `hello@whiterabbitbooks.org`. us-west-2: `artsfolk.com`, `bookfolk.org`. **Kept:** `inkhornreview.com` (us-east-2), `inkhorn.press`, `terryheath.com` and `terry@terryheath.com`, `letter@terryheath.com`, `goranhodzic.com`. Backup: `aws/config/ses/`.

**Google Cloud**
12. Projects `whiterabbit-prod` (8 Cloud Run services, 6 buckets with data, service accounts incl. `inkhorn-digest` and `inkhorn-webhook-sa`, the `inkhorn-og-webhook` image), `wrbc-mcp`, and the `sys-*` projects idle more than 90 days. Backup: `gcs/cloudrun/*.yaml`, `service-accounts.json`, IAM policy, `bucket-listing-*.txt`. **Bucket contents are NOT backed up** (billing closed). *Needs you:* reopen billing first (section 0, item 5), or tell me to delete without a copy.
13. `gcloud` login `terry@bookwish.io` and the expired ADC file. *Needs you:* sign-in to inspect, then I sign out.

**Ghost**
14. Staff user `terry-2`; integration "OG Image Setter" (webhook to Cloud Run). Backup: `ghost/inkhornreview.com/users.json`, `content-export.json`.

**Domains (remove zone from Cloudflare and turn off auto-renew so they lapse)**
Registrar auto-renew is switched in each registrar's dashboard: *needs you* (GoDaddy, name.com, one.com, Cloudflare Registrar). Expiry dates:

| Domain | Registrar | Expires |
|---|---|---|
| analoglist.com | one.com | 2027-03-17 |
| artbase.studio | unknown (whois not available) | unknown |
| artsfolk.com | Cloudflare | 2027-08-02 |
| bookfolk.org | Cloudflare | 2027-06-19 |
| bookwish.io | Cloudflare | 2027-06-26 |
| bookwish.net | one.com | 2026-12-22 |
| colophon.press | GoDaddy (Vercel DNS) | 2028-01-24 |
| dampconcrete.com | one.com | 2027-04-02 |
| fromkindred.com | one.com | 2027-03-23 |
| kitsapreads.org | Cloudflare | 2027-05-18 |
| lumarahouse.org | Cloudflare | 2027-06-24 |
| lumenhousearts.org | Cloudflare | 2027-06-26 |
| passportr.io | one.com | 2027-03-31 |
| quire.page | unknown | unknown |
| vendcat.com | Cloudflare | 2027-08-17 |
| washingtonreads.org | Cloudflare | 2027-05-18 |
| whiterabbitartistry.com | Cloudflare | 2027-07-04 |
| whiterabbitbookco.com | Cloudflare | 2027-05-15 |
| whiterabbitbooks.org | name.com | 2026-12-14 |
| whiterabbit.cafe | GoDaddy (per Cloudflare) | about 2027-08 |
| whiterabbitgo.com | Cloudflare | 2027-06-02 |
| whiterabbitpresents.com | Cloudflare | 2027-07-10 |

**Kept (ACTIVE):** `inkhornreview.com` (Cloudflare, 2027-08-29), `inkhorn.press` (GoDaddy, 2027-07-25), `inkhornwriters.org` (Cloudflare, 2027-08-03), `inkhornwriters.com` (GoDaddy, 2027-03-23), `lifeonwords.com` (Cloudflare, 2027-07-22), `terryheath.com` (name.com, 2027-10-05), `goranhodzic.com` (Cloudflare, 2027-07-26).

15. Google Workspace secondary domains/aliases and iCloud custom domains for remnant domains (MX evidence: Google for `kitsapreads.org`, `lumarahouse.org`, `lumenhousearts.org`, `whiterabbitbookco.com`, `whiterabbitgo.com`, `whiterabbit.cafe`; iCloud for `bookwish.io`, `dampconcrete.com`, `whiterabbitbooks.org`). *Needs you:* Workspace Admin and iCloud settings; I cannot list them from here.

**Other accounts (remote projects, then sign out)**
16. Firebase, Sanity, Inngest, Flutter tooling, Supabase (project `yrssljjcijnobwptkkuw`), Quire, SendGrid (verified sender `support@bookwish.io`). None of these CLIs is installed, and each needs its own sign-in to see and delete remote projects. *Needs you:* one sign-in each; I delete the projects and sign out.

**Local**
17. `~/.env.local`; `~/.aws` profiles `sesfix`, `inkhorn-setup`, `inkhorn-audit`, `ftr-admin` and the `default` profile's `bookwish-ses-sender` keys (dead after item 8); `~/.config/firebase`, `flutter`, `sanity`, `inngest`, `configstore`; Keychain `stripe-inkhorn`, `Supabase CLI`, `page.quire.mac`; the repo's untracked `routes.yaml.pre-*.bak` (4), `submissions-20261007-021801 2/` and `.zip`. Backup: copied to `~/Archive/FTR-cleanup-2026-10-11/local-leftovers/` first.
18. Kept for now: `~/.config/google-mcp` (its server binary is missing, say if you want it removed), `gcloud` for `hello@terryheath.com`.

**Not on the list, for your information:** Railway project contents, `terryheath-digest` (terryheath.com), Mailgun, BookFunnel, all Inkhorn services, and the `inkhornreview-ebooks-private` bucket.
