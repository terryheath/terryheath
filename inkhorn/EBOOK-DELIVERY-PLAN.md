# Ebook delivery plan (replacing BookFunnel)

Status: **plan only, nothing built or changed.** Findings are from the repo, the live Stripe account, Railway, SES and Ghost, read-only, on 2026-10-11. Wait for approval before building.

## 1. What exists now

### Products
- Ebooks are Stripe products with metadata `sku`, `format` (`ebook` or `print`), `preorder` (`"true"`/`"false"`) and, for ebooks, `download_url`. There is no database; Stripe is the catalogue.
- Live products with a `sku`: **Inkhorn Review No. 1 eBook** (`prod_VMsBOc…`, $7.00, `sku inkhorn-1`, `preorder: "false"`, `download_url` = a `getmybook.com` BookFunnel link) and **Inkhorn Review No. 1** print ($14.00). Nothing exists yet for Winter 2026 (releases Dec 1, 2026).
- `GET /products` (shop service, cached 5 min) groups active products by `sku`. An ebook is offered only if it has a `download_url` or is a preorder.
- The book page reads a JSON block in the Ghost catalogue page's head injection (`<script id="ih-book">`). The Autumn page says `"preorder": true`, but the Stripe product says `preorder: "false"`. These disagree today. There is **no release date anywhere** in Stripe or Ghost.

### Checkout and webhook (`inkhorn/shop-service/index.js`, Railway service `inkhorn-shop-service`, Node 20 Express, one replica)
- `POST /checkout` builds a Stripe Checkout session (`mode: payment`, automatic tax, U.S. shipping address only if a print item is present, a computed shipping line for print). The session metadata carries `items` and `has_preorder`.
- `GET /order?session_id=` is called by the order-complete page. It returns the item list **and each ebook's `download_url` to anyone who has the session id** (the id is in the page URL). The page renders a "Download Ebook →" button from it.
- `POST /webhook` handles only `checkout.session.completed`. The Stripe endpoint is enabled for that event only. It verifies the signature, expands line items, runs `handleOrderCompleted`, and **returns 200 even when that fails**, so Stripe never retries a failed order email. It does not check `payment_status` and has no idempotency (a duplicate delivery would send duplicate emails).
- The same Stripe account also has two Ghost endpoints (`inkhornreview.com`, `terryheath.com`, the latter currently failing because that domain points at a parking page) and a disabled legacy Railway endpoint. Ghost ignores shop sessions.

### Preorders
- Marked only by `preorder: "true"` on the Stripe product. The cart and order pages show "Emailed on release day". **Nothing sends it on release day.** The one tool is `shop-service/release-ebook.js`, a manual script: scan paid sessions for a sku, show the list, type `go`, email the product's `download_url`, and mark each payment intent `ebook_delivered_<sku>=true`.

### Emails
- Sent through **Amazon SES** (`@aws-sdk/client-ses`, us-east-2, keys in the service's Railway variables), as plain text.
  - Buyer: "Your Inkhorn Review order" from `orders@inkhornreview.com` (order summary, plus the `download_url` for non-preorder ebooks).
  - Staff: "New order — …" from the same address to `hello@inkhornreview.com` (items, total, shipping address, buyer, Stripe link).
  - No Reply-To is set.
  - `release-ebook.js` sends from `hello@inkhornreview.com`.
- SES state (live): domain identity `inkhornreview.com` is **verified**, DKIM **Success**, account out of the sandbox (quota 50,000/day, 6 sent in 24 h), sending enabled. DMARC is `p=none` with reports to hello@. The root SPF record lists only Google; SES mail passes DMARC through DKIM. No bounce or complaint notifications are configured.

### Order data stored
- **None in the shop.** Orders live only in Stripe (sessions, payment intents). The only extra state is the manual script's `ebook_delivered_<sku>` flag on payment intents.

### Where BookFunnel appears
- Stripe product `prod_VMsBOc…` metadata `download_url` (the `getmybook.com/gqed7w1qmp` link, which redirects to the book's sales page, so it never delivers a file). The one ebook order so far (2026-10-11 ~14:04 UTC) received this link.
- `inkhorn/scripts/setup-build.js` (a template that creates a draft "Subscriber Ebooks" page: text "Links are provided by BookFunnel…" and a "[Paste BookFunnel link]" button). That Ghost page exists as a **draft**, slug `ebooks`, paid-only; its live body contains no BookFunnel text.
- Comments and notes only: `inkhorn/ghost-footer-injection.html` ("Ebook store links… EBOOK_URLS in digest.js", not live), a stale line in `CLAUDE.md` (EBOOK_LINKS / EBOOK_URLS; `digest.js` no longer has EBOOK_URLS), `theme/cutover.sh` ("no ebook links").
- Searched and clean: all Ghost posts, pages and tags (HTML and code injection), and the whole theme. No BookFunnel links on the live site.
- The ebook file itself: one EPUB exists locally (`~/Publisher/Inkhorn/2026/Inkhorn Review EPUB.epub`, 5.4 MB, Oct 9). No PDF found. `build-ebook.js` makes a .docx for Vellum, not the EPUB.

## 2. Proposed design

### Where files live
**Private S3 bucket in the AWS account that already runs SES** (us-east-2), blocked from public access. Reasons: the shop already holds AWS credentials and an SDK; objects are durable and versioned; you can replace a file in the console without a deploy. The shop streams the file to the buyer; the bucket URL is never given out.
Needs by hand: create the bucket, upload files, and give the shop's IAM user read access to that bucket only (the current key's permissions beyond SES are unknown). Alternative with fewer parts: store the files on the Railway volume with the data below. Less durable, and every file change needs the service.

### Where download state lives
**SQLite on a Railway volume attached to the shop service** (the project already uses this pattern for `podcast-import`). It holds only download state: orders seen, one row per download link (token hash, expiry, uses, status). Stripe stays the source of truth for orders, so a lost database can be rebuilt from Stripe and links reissued. A nightly copy of the database file goes to the same bucket. A volume means the service can't do zero-downtime redeploys (seconds of downtime per deploy).
Alternatives: Railway Postgres, or DynamoDB in the AWS account. More moving parts for the same job.

### Product definition
Stripe product metadata replaces `download_url` with `file_epub` and (optional) `file_pdf` (object keys), and adds `release_date` (e.g. `2026-12-01`) for preorders. A product is offered if it has at least one file key or is a preorder. `preorder` is derived from `release_date` being in the future; the flag then needs no hand-editing after release.

### On a paid ebook order (`checkout.session.completed`)
1. Check `payment_status === 'paid'`, record the session (idempotent on session id), and for each ebook line create one **download link**: 32 random bytes, stored only as a hash, expires **30 days** after issue, **5 downloads**.
2. Buyer gets the delivery email (below). Staff email continues, with an added line per ebook link.
3. If a step fails, the webhook returns 500 so Stripe retries (it retries for up to 3 days). Repeats are harmless because of the idempotency key.
4. Print-only orders are unchanged.

### The link
`https://<download host>/d/<token>`. It shows a small page with the title and one button per format (EPUB, PDF). The button requests `/d/<token>/epub`, which counts a download and streams the file. The page itself never counts. Reason: mail scanners and link previews fetch URLs automatically, and a count-on-GET would use up the five before the buyer clicks.
- Expired, used up, revoked or unknown token: the same plain page: "This link has expired. Reply to your receipt and we'll send a new one." (an unknown token gets this too, so nothing is revealed).
- Headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `Content-Disposition: attachment`. Basic rate limit per IP.
- Host: a custom subdomain such as `download.inkhornreview.com` pointed at the Railway service (DNS in Cloudflare, by hand), rather than the `*.up.railway.app` address. Links in already-sent email would keep working if the service ever moves.

### Delivery email
From `hello@inkhornreview.com`, plain text, Reply-To `hello@inkhornreview.com`. Draft:

> Subject: Your Inkhorn Review ebook
>
> Hi {name},
>
> Thank you for your order. Your ebook, {title}, is ready:
>
> {link}
>
> The link works for 30 days and for up to 5 downloads. If it stops working, reply to this email and we'll send a new one.
>
> Inkhorn Review
> https://inkhornreview.com

One email per order, with one link per ebook line if there are several.

### Preorders
- At purchase: only the purchase email goes out (the existing order summary), changed to say when the ebook arrives: "Your ebook will be emailed to you on {date}." The link is **not** created yet.
- On the release date: a daily check inside the shop service (a timer, plus an admin trigger) finds paid ebook lines for products whose `release_date` has passed and have no link yet, creates the link (30 days run from then, not from purchase), sends the delivery email, and logs a summary to `hello@`. It replaces `release-ebook.js`, which I'd delete.
- Time of day: default 7:00 AM Pacific on the release date.

### Admin: resend and reissue
A password-protected page on the shop service (`/admin`): search by email or order id, see each link's status (issued, expires, downloads used, revoked), and two buttons.
- **Resend:** emails the same link again (only while it is still valid).
- **Reissue:** revokes the old link, makes a new one with a fresh 30 days and 5 downloads, and emails it.
The password is a Railway variable (`ADMIN_PASSWORD`), sent over HTTPS only, with attempt limits. Optional: a small local script that calls the same actions so you can do it from the terminal.

### Cleanup of the existing flow
- `GET /order` stops returning `download_url`; the order-complete page says the link has been emailed (or will be, on the release date).
- `webhook` fixed as above (200 only on success, `payment_status` check, idempotency).
- Add `charge.refunded` to the shop's Stripe endpoint to revoke a refunded order's links (see decisions).
- Delete `release-ebook.js`. Remove `download_url` from the Stripe product after the new links exist.
- Delete the draft `ebooks` Ghost page and the `createEbooksPage` block (and its BookFunnel text) from `scripts/setup-build.js`. Fix the stale `CLAUDE.md` lines and the `EBOOK_*` comments. Update the "Delivered by email" wording only if the release-date text needs it.
- Upgrade the shop's Docker base image to Node 22 while adding the S3 and SQLite dependencies (the AWS SDK has already warned it drops Node 20 in January 2027).

### Order of work
1. Fix the webhook and `/order` leak, add the storage and the link service (no behaviour change for buyers yet).
2. Upload files and add Stripe metadata; switch the delivery email on for new orders.
3. Add the release-date job and the admin page.
4. Re-send today's buyer a working link; remove BookFunnel references; cancel the BookFunnel account.

## 3. Decisions and hand-work

### Decisions for you
1. **Storage:** S3 for files plus SQLite on a Railway volume (recommended), or everything on the volume?
2. **Downloads limit:** 5 downloads per link in total across EPUB and PDF, or 5 per format?
3. **Quantity:** can a buyer order 2 copies of an ebook? Recommend limiting the cart to 1 per ebook (it is a personal copy); otherwise one link per unit.
4. **Autumn issue status:** Stripe says not a preorder, the Ghost page says preorder. Is Autumn available now? That decides whether buyers get links at purchase (available now) or on a release date.
5. **Winter 2026 release date and time:** Dec 1, 2026 at 7:00 AM Pacific? Same rule for later issues?
6. **PDF:** do you want to sell a PDF alongside the EPUB? I found no PDF.
7. **"Reply to your receipt":** Stripe's own receipt, our order summary from `orders@`, or the delivery email? Replies must reach you. I'd set Reply-To `hello@` on every shop email and make "your receipt" mean the delivery email. Is `orders@inkhornreview.com` a real mailbox or alias for you? I couldn't check.
8. **Refunds:** revoke links automatically when an order is refunded? (Requires adding `charge.refunded` to the shop's Stripe endpoint.)
9. **Download host:** `download.inkhornreview.com`, or keep the Railway address?
10. **Bounce handling:** worth wiring SES bounce and complaint notices to an inbox? Optional, not needed for the plan.
11. **Verification:** one real order from you, refunded afterwards, before announcing? (There is no Stripe test-mode flow in the current setup that I could find.)

### What you do by hand
- Confirm the final EPUB (and PDF, if any) for Autumn 2026. The EPUB I found is from Oct 9; confirm it is the release file.
- Create the private S3 bucket and upload the files, and grant the shop's IAM user read access (or tell me to use the volume).
- Add the `download.` DNS record in Cloudflare and the custom domain in Railway.
- Attach the volume to the shop service in Railway (adding a volume needs your OK since it changes the service's deploy behaviour).
- Set `ADMIN_PASSWORD` in Railway and add `charge.refunded` to the Stripe endpoint if you choose refund revocation.
- Cancel the BookFunnel account once the first order has gone through the new flow.
- No SES domain verification is needed: `inkhornreview.com` is already verified with DKIM and out of the sandbox.
