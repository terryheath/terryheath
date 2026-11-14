# Genre-tag, digest and publish-order audit

Date: 2026-10-10. Read-only. GET requests only against Ghost (Inkhorn Admin key from the Keychain); also read-only against Railway (status, variables names/non-secret values, logs) and the live public pages. The only file written is this one (plus two small corrections to `AUTOMATION-EMAIL-RECON.md`). No key or token is printed. Counts come from a full pull of all 87 posts and 12 pages.

## A. Replacing `#archive` with genre tags

### A1. Every use of `hash-archive` / `#archive`

**Live (affects the site or sends)**

| Where | Filter (quoted) |
|---|---|
| `inkhorn/routes.yaml:8` | `/archive/` channel: `filter: tag:hash-archive`, `order: published_at desc` |
| `routes.yaml:443` | `/fiction/` collection: `filter: primary_tag:fiction+tag:hash-archive` |
| `routes.yaml:451` | `/nonfiction/`: `filter: primary_tag:nonfiction+tag:hash-archive` |
| `routes.yaml:459` | `/poetry/`: `filter: primary_tag:poetry+tag:hash-archive` |
| `routes.yaml:491` | `/micro/`: `filter: primary_tag:micro+tag:hash-archive` |
| `theme/home.hbs:61` | `{{#get "posts" filter="tag:hash-archive+visibility:public" limit="4" order="published_at desc" include="tags"}}` (comment line 59 and 84 mention it too) |
| `theme/tag-fiction.hbs:16` | `{{#get "posts" filter="tag:fiction+tag:hash-archive" order="published_at desc" limit="999"}}` |
| `theme/tag-poetry.hbs:16` | `{{#get "posts" filter="tag:poetry+tag:hash-archive" order="published_at desc" limit="999"}}` |
| `theme/tag-nonfiction.hbs:16` | `{{#get "posts" filter="tag:nonfiction+tag:hash-archive" order="published_at desc" limit="999"}}` |
| `theme/index.hbs` | no filter of its own; renders whatever the `/archive/` channel supplies |
| `inkhorn/digest.js:213` | a comment only: "Never include paid (#archive, visibility:paid) posts in the digest." The code does **not** filter on `hash-archive` (see B1) |

`tag-micro.hbs` and `tag-art.hbs` use `{{#foreach posts}}` from the route, so micro goes through the `routes.yaml:491` filter. No hit in `og-webhook`, `deploy.sh`, `cutover.sh`, `address-service`, `shop-service` or `redirect-worker`.

**Scripts (create or report on the tag)**

- `scripts/setup-build.js:9,142-164`: bulk-adds `#archive` to all autumn-2026 and micro posts.
- `scripts/build-editions.cjs:104,136`: adds `hash-archive` when creating/updating Winter pieces; tag list is `[edition, contributor, genre, hash-archive, inkhorn-N]`.
- `scripts/schedule-drip.js:12,135-139`: adds `#archive` and `#this-week` and sets `visibility=paid` when scheduling a drip.
- `scripts/archive-report.js:3,60`: `filter: 'tag:hash-archive'` (report only).

**Dead or documentary**

- `inkhorn/ghost-footer-injection.html:580` and `theme/rollback/ghost_foot.txt:592`: `filter=tag:hash-archive&…&limit=10&order=published_at+desc`. The site-wide injection is empty and the file is not live (per the repo's CLAUDE.md).
- `CLAUDE.md:170` (rule text), `build-log.md`, `build-report-2026-10-09.md:75` (record that new posts get tags "season, contributor, genre, `#archive`, `inkhorn-N`").

### A2. Genre-tag replacements, and are they identical?

The genre tags are `fiction`, `nonfiction`, `poetry`, `micro`.

**Both directions, live data (all 87 posts, every status):**
- `#archive` posts: **65**. Posts carrying at least one genre tag: **65**. They are the same 65.
- Archive posts without a genre tag: **0**.
- Non-archive posts with a genre tag: **0**. Podcasts, art, letters, digests and email-only posts carry none. No page carries one either.
- One post has two genre tags: "What I Talk About When I Talk About Running" (`micro` + `fiction`).

So `tag:[fiction,nonfiction,poetry,micro]` returns exactly the same posts as `tag:hash-archive` today.

| Current | Genre equivalent | Same posts today? |
|---|---|---|
| `/archive/` `tag:hash-archive` | `tag:[fiction,nonfiction,poetry,micro]` | Yes, 65 = 65 (44 published, 21 scheduled) |
| home `tag:hash-archive+visibility:public` | `tag:[fiction,nonfiction,poetry,micro]+visibility:public` | Yes |
| `tag-fiction/poetry/nonfiction.hbs` `tag:X+tag:hash-archive` | `tag:X` | Yes (the `#archive` condition is already implied) |
| `/micro/` `primary_tag:micro+tag:hash-archive` | `primary_tag:micro` | Yes: 4 posts |
| `/fiction/` `/poetry/` `/nonfiction/` collection filters | see below | Do not currently match anything |

**Two things to know before a swap:**
1. **The genre collections never own posts.** Genre is not the primary tag for 61 of the 65 pieces: their primary tag is the season (`autumn-2026` 40, `winter-2026` 21), and for the 4 micro pieces it is `micro`. So `primary_tag:fiction+tag:hash-archive` (and poetry, nonfiction) match nothing, and those three pages work only because their templates run their own `{{#get}}`. If any collection filter were relaxed to `tag:fiction`, collections are matched in `routes.yaml` order: `/fiction/` is listed after `/autumn-2026/` and `/winter-2026/all/`, so season pieces would keep their URLs, but the micro+fiction post (primary `micro`) would be claimed by whichever of `/fiction/` and `/micro/` comes first. `/fiction/` precedes `/micro/` in the file, so its URL would change from `/micro/<slug>/` to `/fiction/<slug>/`.
2. **`primary_tag` is a different thing.** Anything that reads `primary_tag` for genre gets the season (or `micro`), not the genre. See B2 for the digest.

### A3. What the live pages return now

| Page | Result |
|---|---|
| `/archive/` | 200. **30 entries per page** (page size is `posts_per_page: 30` in the theme config), page 2 has the other **14**, page 3 is 404. 30 + 14 = 44 published. |
| why 31 vs 44 | The first page has 31 anchors with class `ih-archive-entry-link`, but 30 are entries; the 31st is the link on the Autumn issue cover in "The Issues" section above the list. The 44 are split across two pages. |
| `/fiction/` | 200, 18 entries (one is the micro+fiction piece) |
| `/nonfiction/` | 200, 1 entry (3 nonfiction archive pieces; the other 2 are scheduled for Winter) |
| `/poetry/` | 200, 22 entries |
| `/micro/` | 200, 4 entries |

18 + 1 + 22 + 4 = 45 = 44 published + 1 piece that appears twice (micro and fiction). Scheduled Winter pieces do not appear yet.

### A4. What adds `#archive` to new posts

- `scripts/build-editions.cjs:104,136` (Winter pieces; `want.push('hash-archive','inkhorn-2')` and the tag list for new posts).
- `scripts/setup-build.js:164` (one-off bulk add for autumn-2026 and micro).
- `scripts/schedule-drip.js:139` (drip schedule; also sets paid + `#this-week`).
- Nothing in `og-webhook`, `digest.js`, `patreon-sync.js` or the Railway services adds it. Submissions come through Duosuma, which has no code here.
- Not visible to me: any Ghost-side automation or manual tagging in Ghost Admin, and the Ghost webhook definitions (not readable with an integration key).
- Documented practice: the build report records the tag order "season, contributor, genre, `#archive`, `inkhorn-N`" as the convention for new posts.

## B. The weekly newsletter build (`inkhorn/digest.js`)

### B1. End to end

- **Where and when:** Railway project "Inkhorn Cron", service `digest`, cron `0 14 * * 4` (Thursdays 14:00 UTC), start command `node inkhorn/digest.js`, restart policy NEVER. Env: `GHOST_API_URL` (Inkhorn PikaPod), `GHOST_ADMIN_KEY`, `PUBLISH_MODE=publish`, Bluesky handle and app password.
- **Watermark (no repeats):**
  ```js
  filter: 'tag:hash-digest+status:published', order: 'published_at desc', limit: 1
  ```
  `lastDigestAt` is the newest digest's `published_at`. There is no state file. A failed lookup returns `null` (treated as "first run").
- **Selection:**
  ```js
  `status:published+tag:-hash-digest+visibility:-paid+published_at:>'${lastDigestAt}'`   // or the same without the date on a first run
  ```
  with `include: 'tags'`, `limit: 'all'`. Posts with preview URLs (`/p/<uuid>/`) are dropped.
- **Sections:** each post is mapped by `department(post)` from its **primary tag**: an issue tag (`autumn-2026`, `inkhorn-N` etc.) becomes `issue:<slug>`; `letter`, `poetry`, `fiction`, `nonfiction`, `art`, `podcast` map to themselves; anything else (for example `micro`) is skipped ("no-section"). Within a section only the **newest** post is kept. All new pieces in an issue collapse to one "Read the issue" block (cover, description, count, link). Fixed order: issue, letter, poetry, fiction, nonfiction, art, podcast.
- **Send guard:** fewer than 2 sections after the filter means nothing is sent.
- **Rendering:** inline-styled HTML tables and paragraphs (`issueBlock`, `sectionHeading`, `itemRow`, `digestFooter`), wrapped in `<!--kg-card-begin: html-->` markers and posted with `source: 'html'`. Title is "Inkhorn Review — Week of <Mon d>, <yyyy>"; the email subject is the lead item plus " — and N more"; the feature image is the issue cover, else the first post with an image. Art and podcast rows get a 72 px thumbnail.
- **Publishing:** creates a draft (tag `#digest`, visibility `members`), then edits it to `published` with `newsletter: 'inkhorn-review-digest'`, `email_segment: 'all'`. It then re-reads `email`/`newsletter`, queries `/emails/` and exits 1 if no email record exists. Last, it posts to Bluesky (failure does not fail the run).
- **Newsletter:** `inkhorn-review-digest` ("Weekly Digest", active, subscribe on signup on). Other newsletters on the pod: Issue Announcements (default), Life on Words, Founder's Letter, Weekly Micro (active); Weekly Micro Fiction, Patron and a test one (archived).
- **Latest run (Thursday Oct 8):** the Railway log shows "Fetched 2, 2 with canonical URLs", skipped "Fledgling" (primary tag `micro`), and "Only 1 section(s) after watermark filter, nothing to send." So no digest went out on Oct 8.

### B2. Would switching `#archive` to genre tags break or change it?

- **No change from the tag swap itself.** `digest.js` never queries `hash-archive`. Its filters use `hash-digest`, `visibility:-paid`, `status` and `published_at`. Only the comment at line 213 mentions `#archive` and would become stale.
- **What would change it** is a change to *primary tags*. Today pieces have the season as primary tag, so they roll up into an issue block, and micro pieces are skipped. If genre became the primary tag, `department()` would turn each piece into its own poetry/fiction/nonfiction section and the issue block would disappear for those pieces (one newest piece per genre per week). If you do not touch primary tags, nothing in the digest changes.
- **Exactly what would need changing** in that case: `department()` (lines 60-71) and, if you want micro pieces included, a `micro` entry in `department()` and `DEPT_ORDER`. Everything else is independent of genre.
- **Related quirk:** because only the newest post per section counts and micro is skipped, a week with new pieces from one issue plus nothing else sends nothing (the 2-section minimum). That is what happened on Oct 8.

### B3. Were the Oct 1 and Sep 20 digests emailed?

**Yes, both, plus Sep 13.** `GET /posts/?filter=tag:hash-digest&include=email,newsletter` shows an email record and the newsletter `inkhorn-review-digest` on each (my earlier pull omitted those includes, which is why it showed null):

| Digest | Post status | Subject | Recipients | Delivered | Failed | Opened |
|---|---|---|---|---|---|---|
| Oct 1 | published | "Dolly — and 1 more" | 115 | 106 | 9 | 83 |
| Sep 20 | published | "Drive-by Submissions — and 1 more" | 86 | 83 | 3 | 72 |
| Sep 13 | sent (email-only) | "Autumn 2026 — and 4 more" | 12 | 11 | 1 | 7 |

Email record status is `submitted` for all three, with no error. `published` versus `sent` is not a signal here: a post that goes to the web and to email stays `published`; `sent` appears on email-only posts (the Sep 13 digest). `/emails/` itself is blocked for integration keys, so I read the counts from the post's `email` object.

## C. Overlap with the planned welcome-email job

### C1. What `digest.js` already does that the welcome job also needs

- **Latest podcast episode:** it keeps the newest post whose primary tag is `podcast` (via `department()` and the newest-per-section sort), and renders it with a thumbnail row. Equivalent filter: `primary_tag:podcast+status:published`, newest first, `limit=1`.
- **Archive pieces:** it takes pieces newer than the watermark, collapsed by issue (a cover block) or the newest per section. The welcome job may want something different: for example the newest N pieces, or a fixed rotation.
- **Rendering for email:** `itemRow`, `issueBlock`, `sectionHeading`, `digestFooter` produce inline-styled HTML. Welcome emails store **Lexical**, not HTML, so the output would have to be a Lexical HTML card (or Lexical built directly); the digest path avoids that by posting `source: 'html'`.
- **Tracking what has been used:** the watermark from the last published digest (`published_at`), derived from Ghost with no state file. A welcome email that always shows "the latest" needs no tracking; a rotation would.

### C2. What one integrated job could look like (options only)

- **Option 1: two jobs, one shared module.** Extract selection (latest podcast, newest pieces) and the HTML helpers into a small module that `digest.js` and a new `welcome-blocks` job both import. Shares: queries, rendering. Separate: watermark, subject, publish/newsletter, Bluesky, and the welcome write path (staff token, section 3 of the recon doc).
- **Option 2: one job, two outputs.** One Railway cron fetches posts once, builds the "latest podcast" and "latest pieces" blocks, then (a) creates the digest and (b) rewrites the welcome-email blocks. Shares: schedule, fetch, rendering. Separate: the digest still needs the watermark and the 2-section guard; the welcome rewrite should run even when no digest is sent (as on Oct 8).
- **Option 3: blocks as data.** `digest.js` or a small job writes the selected blocks (podcast, pieces) as JSON into a Ghost page or file; the digest and the welcome job each render from that. Shares: selection only. Separate: rendering formats (HTML card vs Lexical).
- **Stays separate in every option:** publishing and emailing the digest (newsletter `inkhorn-review-digest`, `email_segment: 'all'`), the Bluesky post, the watermark logic, and the credentials: the digest uses the integration Admin key (works); the welcome edit needs a staff access token on v6.67.
- **Timing consideration:** the digest runs Thursdays 14:00 UTC; the welcome job could run daily or on `post.published` (see the `og-webhook` section of the recon doc).

## D. Publish order and the archive

### D1. How the pieces are dated

Order comes from `data/editions-2026.json` (print running order, 25 pieces per issue). All 21 scheduled pieces and 4 earlier-published Winter pieces are matched.

**Winter 2026:** 21 scheduled for **2026-12-01**, one minute apart from 12:00 to 12:24 UTC (04:00 to 04:24 PT) in running-order sequence. Four Winter pieces were already published on 2026-09-08 and sit outside that run: position 5 "Pigment" (07:05), 12 "Metal Storm" (07:04), 17 "How Now Brown Cow" (07:06), 20 "The Incredible Shrinking Coffee Shop of Paris" (07:25). Of 24 consecutive pairs in issue order, 20 go later-position-later-date and 4 go earlier (those four).

**Autumn 2026 (44 published, 25 of them in this running order):** the dates fall in clusters, with no relation to print order:
- 14 on 2026-09-08 (minute stamps 07:01 to about 07:29, unrelated to position)
- 8 on 2026-10-09 (20:59:xx, seconds stepping in a different order: Motherland, position 3; Basins, 23; My Heart is a Bird, 24; and others)
- 1 each on 2026-09-06, 2026-09-27 and 2026-10-04
Of 24 consecutive pairs in issue order: 13 later-position-later and 11 earlier. So Autumn is in no consistent order by date.
The 44 published archive pieces include 15 that are in neither running-order file (for example "Yom Kippur haiku", "Jekyll Island", "Brothers", "Poverty: The Itinerant Thief", and the micro pieces).

### D2. Everything that sorts pieces by publish time

| Page / list | Sort |
|---|---|
| `/archive/` (channel) | `published_at desc`; month headings are inserted by JavaScript |
| Home "The Archive" (4 cards) | `published_at desc` |
| `/fiction/`, `/poetry/`, `/nonfiction/` | `published_at desc` (template `{{#get}}`, `limit="999"`) |
| `/micro/`, `/art/`, `/founder-letter/`, `/podcast/` | `published_at desc` (route) |
| `/digest/` | `published_at desc` |
| `/autumn-2026/` collection | `published_at asc` (route), but the edition page renders the running-order partial, so the sort does not drive what is shown |
| `/winter-2026/all/` collection and per-issue genre channels (e.g. `/autumn-2026/poetry/`) | `published_at asc` |
| Edition pages `/autumn-2026/`, `/winter-2026/` | **Not by time**: `edition.hbs` renders `partials/editions/{season}.hbs` (print order, one `{{#get slug:…}}` per piece) |
| Home page current edition | not by time: the hero and contents use the same running-order partials; the Featured `#catalog` page is chosen by `published_at desc` |
| Contributor and season tag pages (`tag.hbs`) | `{{#foreach posts}}` with Ghost's default order for tag pages (newest first); season tag pages follow the same default |
| Related posts partial | `primary_tag:{{primary_tag.slug}}+id:-{{id}}`, limit 4, default order |
| Catalog lists (`index.hbs` "The Issues", `page-books.hbs`) | `published_at desc` on catalog pages |

### D3. Does an edition read in reverse on `/archive/` now?

- **Winter, once it publishes on Dec 1: yes.** All 21 pieces are one minute apart in running-order sequence, and `/archive/` sorts newest first, so within that run position 25 is listed above position 1. (The 4 already-published Winter pieces from Sep 8 will sit lower in the list, outside the run.) The month heading "December 2026" would group them.
- **Autumn now: not reverse, and not in order either.** The first page opens with the 8 pieces from Oct 9 in reverse of their stamp order (My Heart is a Bird, Basins, The Perpetual Amity…), followed by Sep 8 pieces at minute stamps that do not follow print order. It reads in mixed order.

### D4. Options for making each edition read in issue order on `/archive/`

1. **Reschedule so `desc` equals issue order.** Give Winter pieces `published_at` in *reverse* running-order (position 1 gets the latest minute). Touches: the 21 scheduled posts' `published_at` only (the repo's `reschedule.js` spaces posts in current order, so it would need a reverse mode). Side effects: the asc-sorted pages (`/winter-2026/all/`, genre channels per issue) would then read in reverse; the digest picks "newest per section", so the issue block's choice flips; the Autumn issue's published pieces are already published, so this does not help them unless their dates are edited (which changes their public dates and RSS/sitemap entries).
2. **Group `/archive/` by issue, using the running-order data.** Rewrite `index.hbs` to list each edition as a section (cover, then its pieces from the `partials/editions/*.hbs` files in print order) and keep a time-sorted list for pieces outside any edition (micro, the 15 unplaced pieces). Touches: `index.hbs`, the edition partials (or a flat variant), pagination (30 per page applies to the channel feed, not to partial content), and the month-heading script. Does not touch post dates or routes.
3. **Client-side reorder.** Emit a position number per piece (for example from `editions-2026.json` via a generated lookup in the theme) and let the existing inline script sort and group by edition. Touches: `index.hbs` script plus a generated data file. Pieces without a position fall back to date. Page-by-page sorting only works within the 30 loaded per page, so pagination would need `limit: all` on the route.
4. **Use a Ghost-sortable field as the key.** Channels sort only by native post fields (published_at, title, featured, and so on). Setting a native field to the issue position (for example `featured` or a prefix in `title`/slug) is not a clean fit. Touches post data on all pieces. Not recommended by default: listed for completeness.
5. **Leave `/archive/` newest-first, link editions to the edition page.** Edition pages already read in print order. Touches nothing; accepts that `/archive/` is a time-ordered feed.

Whatever is chosen, remember the interactions: the month headings are generated from `published_at`; the digest and `og-webhook` both read publish time; and replacing `#archive` with genre tags (section A) changes only which posts the `/archive/` channel selects, not its order.
