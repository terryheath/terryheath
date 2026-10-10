# Automation email recon — Inkhorn Review Ghost pod

Date: 2026-10-10. Read-only: GET requests only, nothing written to Ghost. No key or token is printed anywhere in this doc.

## Caveat on credentials

The brief pointed at Secret Manager (`ghost-api-url-podcast`, `ghost-admin-key-podcast`, project `whiterabbit-prod`). `gcloud` is not installed on this machine, so those secrets were not read. The authenticated GETs below used the Inkhorn Admin integration key from the macOS Keychain (`ghost-url-inkhorn` / `ghost-admin-inkhorn`), the key the repo's `deploy.sh` and `scripts/ghost-fetch.cjs` use. It targets the same site, but it may not be the same integration as the `-podcast` key, so the 403 in section 2 may not apply to that key.

## 1. Version and Labs flag

- Ghost **6.67** (`<meta name="generator" content="Ghost 6.67">`; `/ghost/api/admin/site/` reports version `6.67`).
- `GET /ghost/api/admin/settings/?group=labs` returns `{"automations":true,"automationAnalytics":true,"admin7Pill":true,"members":true}`. The **Automations (beta) flag exists and is ON**.
- Labs UI wording at v6.67 (`apps/admin/src/settings/advanced/labs/beta-features.tsx`): the toggle is titled "Automations (beta)". Its confirm prompt reads: *"This is a one-way street. Once enabled, the automations beta can't be turned off. Existing welcome emails will move into your automations automatically."* Once the flag is enabled the toggle is disabled (`disabled={isAutomationsEnabled}`), so it cannot be reverted from the UI.
- `automationAnalytics` is a GA feature (always true). `automationsPerTier` and `automationsTinybirdSync` are also public-beta flags and are not set on this pod.

## 2. Live endpoint responses (Inkhorn Admin key from Keychain)

| Request | Status | Body |
|---|---|---|
| `GET /ghost/api/admin/automated_emails/` | **403** | `NoPermissionError`: "API tokens do not have permission to access this endpoint" |
| `GET /ghost/api/admin/automations/` | **403** | same error |
| `GET /ghost/api/admin/settings/?group=labs` | 200 | see section 1 |
| `GET /ghost/api/admin/site/` | 200 | n/a |

The same key can read and write posts and tags (used by `deploy.sh`, `build-shelves.cjs` and `og-webhook`), so the key is valid. The 403 is a permission issue, not an auth failure.

By the v6.67 source (section 3), an "Admin Integration" role key *should* hold `automation: browse/read/edit` and `automated_email: all`. I could not find where the "API tokens do not have permission to access this endpoint" text is raised, so the cause is unconfirmed. Hypotheses, none tested:

- The key belongs to an integration whose role is not Admin Integration.
- The pod's permission rows are missing, because the migration `6.36/…-add-automations-permissions` or `6.10/…-add-automated-email-permissions` didn't grant them to this role.
- Some other API-key guard I haven't located.

Because both calls returned 403, the live JSON shape was **not observed**. The shape below comes from the v6.67 source.

### Shape, from source

**`/automated_emails/` (legacy facade; welcome emails only).** It flattens two tables (`automations` + `welcome_email_automated_emails`):

```
{ automated_emails: [ {
    id, status, name, slug,
    subject, lexical,                      // email content lives here
    sender_name, sender_email, sender_reply_to,
    email_design_setting_id,
    created_at, updated_at } ], meta: { pagination } }
```

It is filtered to the member-welcome-email slugs only. A `slug` change is rejected on edit.

**`/automations/` (new graph API).** Linear graph: `status` (`active` or `inactive`), `actions[]`, `edges[]`.

- A wait action is `{ id, type: "wait", data: { wait_hours: positive int } }`.
- An email action is `{ id, type: "send_email", data: { email_subject, email_lexical (string), email_design_setting_id } }`.
- An edge is `{ source_action_id, target_action_id }`, with ObjectId ids.
- At most 20 actions. The graph must be a single linear path with no branches or cycles.
- Browse also returns stats (Tinybird if `automationsTinybirdSync` is on and configured, otherwise MySQL). v6.67 added a `description` column.

## 3. Routes and permissions (TryGhost/Ghost tag v6.67.0)

From `ghost/core/core/server/web/api/endpoints/admin/routes.js`. All use `mw.authAdminApi`.

**Automations**

| Route | Notes |
|---|---|
| `GET /automations` | Returns 404 "Automations are not enabled." unless the labs flag is set. |
| `GET /automations/:id` | |
| `PUT /automations/:id` | Edit. Body `{automations:[{status, actions, edges}]}`; the whole graph is replaced. |
| `PUT /automations/poll` | Uses `authAdminApiWithUrl`. Scheduler role only. |
| `GET /automations/:automation_id/actions/:action_id/links` | |
| `POST /automations/:id/email_preview` | |
| `POST /automations/:id/email_test` | |

**Automated emails**

| Route | Notes |
|---|---|
| `GET /automated_emails` | |
| `GET /automated_emails/:id` | |
| `POST /automated_emails` | |
| `PUT /automated_emails/:id` | Edits `subject`, `lexical`, `email_design_setting_id`, sender fields, and `status`/`name`. |
| `GET` / `PUT /automated_emails/design` | |
| `PUT /automated_emails/senders` | |
| `POST /automated_emails/:id/preview` | |
| `POST /automated_emails/:id/test` | |

**Permissions** (`data/schema/fixtures/fixtures.json`, plus migrations 6.10 and 6.36):

- Administrator: `automated_email: all`, `automation: browse/read/edit`.
- **Admin Integration:** `automated_email: all`, `automation: browse/read/edit`.
- Scheduler Integration: `automation: poll` only.

**Answer (superseded by "403 follow-up" below; the allowlist makes this wrong for integration keys):** per the source, an integration Admin key does not need a staff access token to edit an email's lexical. `PUT /automated_emails/:id` (`lexical`, `subject`) or `PUT /automations/:id` (`email_lexical` / `email_subject` in the `send_email` action) both pass `permissions: true` for the Admin Integration role. The caveat is the live 403 in section 2. The `permissions` helper has a separate path for staff tokens, which use the user's role, but that isn't needed on paper.

**Edit validation worth knowing**

- `lexical` is validated as a well-formed Lexical document.
- `status: active` requires a non-empty subject and a non-empty body on every email.
- `PUT /automations/:id` replaces the full graph, so it needs the existing action ids, edges and wait steps round-tripped. `PUT /automated_emails/:id` touches only the email fields passed. Neither route's behavior is confirmed against this pod's data.
- `automated_emails` writes are not gated by the labs flag in the controller. The `automations` browse is.

## 4. What `inkhorn/og-webhook` would need to also trigger an email rewrite

Current state (`inkhorn/og-webhook/index.js`, 140 lines):

- Plain Node `http` server, POST only. It verifies `X-Ghost-Signature` (`sha256=<hex>, t=<ts>`, HMAC of `rawBody + t` with `WEBHOOK_SECRET`).
- It reads `payload.post.current` (title, tags, `primary_tag`), picks a target tag (the `inkhorn-N`-style publication tag, otherwise the primary tag), then sets `og_image` on every post with that tag via `PUT /posts/:id`.
- It signs its own Admin JWT from `GHOST_ADMIN_KEY` (`kid:hexsecret`, HS256, 5-minute expiry, aud `/admin/`). `GHOST_URL` defaults to `https://accelerated-basilisk.pikapod.net`.
- **Deployment mismatch with the brief:** the repo's `railway.json` and Dockerfile path point at **Railway**, not Cloud Run. I did not verify where it actually runs or which Ghost webhook points at it.

To also drive an email rewrite, it would need:

1. **Branching in the handler.** After the signature check and the og_image step, decide whether this post warrants an email rewrite. Today it handles every `post.published`.
2. **A GET for the target email.** Either `GET /automated_emails/` (find by `slug`) or `GET /automations/` (find the `send_email` action). Both are unverified live (see section 2).
3. **A PUT with the new subject/lexical.** `PUT /automated_emails/:id` with `{automated_emails:[{subject, lexical}]}`, or `PUT /automations/:id` with the whole graph. `updated_at` is not required by these controllers, unlike posts. Ghost does not diff or version these edits.
4. **Lexical generation.** The service would have to build a valid Lexical JSON string from the post (title, excerpt, URL, feature image). The webhook payload already carries `post.current`. Whether to rewrite the whole body or fill placeholders is a content decision, not decided here.
5. **A permissions check.** Resolve the 403 first. The key in `GHOST_ADMIN_KEY` for that service must be an integration with the automation/automated_email permissions, or the fix is a different key.
6. **Idempotency and loop safety.** `post.published` can fire again on re-publish. The og step is a no-op when values match (`skipped`); the email step would need the same check, since a rewrite is a visible change to a live automation. Editing an `active` automation takes effect for members still waiting in the flow.
7. **Config.** A new env var for the target email slug or automation id. `GHOST_URL` for the deployed service should be confirmed to be `https://inkhornreview.com`, not the pikapod default.

## Open items

- Resolve the 403: check which role the Keychain key and the `-podcast` key have, and retest with the `-podcast` key once `gcloud` is available.
- Capture a real JSON sample once a GET succeeds. Redact member data if any appears.
- Confirm where `og-webhook` is deployed (Railway vs Cloud Run) and which webhook posts to it.

## 403 follow-up

Date: 2026-10-10. Read-only. GET requests only against Ghost; no key or token printed.

### 1. Where the error is raised

- **File:** `ghost/core/core/server/web/api/endpoints/admin/middleware.js` at v6.67.0, function `tokenPermissionCheck`, message key `apiTokenBlocked` ("API tokens do not have permission to access this endpoint").
- `tokenPermissionCheck` is the last middleware in `authAdminApi`, `authAdminApiWithUrl` and `publicAdminApi`, so it runs on every Admin API route including all the automation routes. It runs *before* the permission system, so the role permissions from section 3 are never consulted for a blocked request.
- **Flow:**
  1. No `req.api_key` (a logged-in user session): skip to the permission system.
  2. `req.api_key.get('user_id')` is set (**staff access token**): only a small blocklist applies (`DELETE /db`, `PUT /users/owner`, `POST /authentication/reset`), then skip to the permission system. **Automation routes are not blocked.**
  3. Otherwise (**integration key**, no `user_id`): the request passes only if the first path segment is in a hardcoded allowlist and the HTTP method is listed for it. Otherwise it fails with `NoPermissionError`, status 403, message `apiTokenBlocked`.
- **The allowlist (v6.67.0), automation-related entries:** `automations: ['PUT']`. There is **no `automated_emails` entry at all**. Also relevant: `settings: ['GET']`, `actions: ['GET']`, `roles: ['GET']`, `users: ['GET']`, `webhooks: ['POST','PUT','DELETE']` (no GET), `themes: ['POST','PUT']`, `tags`/`posts`/`pages` full CRUD. `integrations` is not listed.
- **Applies to:** integration keys only. Staff access tokens skip the allowlist.

### 2. Which integration and role the Keychain key is

- **Integration name: "Inkhorn".** `GET /actions/?include=actor&filter=actor_type:integration` returns tag edits made with this key (for example, today's shelf writes for Bill Garvey, Cecil Morris and Frank William Finney) with actor type `integration` and actor name "Inkhorn". 1,001 integration actions in total. No staff user appears as the actor for these.
- **Role: not directly readable.** `GET /integrations/` returns 403 for integration keys (not on the allowlist), and `GET /users/me/` returns 404. The role list on the pod includes `Admin Integration`, `Self-Serve Migration Integration`, `DB Backup Integration` and `Scheduler Integration`. Custom integrations are created as Admin Integration, and this key uploads and activates themes and edits posts and tags, which the other three roles don't allow. So it is almost certainly **Admin Integration**, by inference.
- **Would that role pass step 1's check?** No. The allowlist is evaluated before roles, and it is the same for every integration key. Admin Integration holds `automation` and `automated_email` permissions in the database (section 3), but the request is rejected before those are consulted.

### 3. Can an integration key read and edit automation emails on v6.67?

- **Read: no.** `GET /automations/`, `GET /automations/:id`, `GET /automated_emails/` and `GET /automated_emails/:id` are all blocked for integration keys (allowlist has only `PUT` for `automations`, nothing for `automated_emails`).
- **Edit: only one route, blind.** `PUT /automations/:id` passes the allowlist, then permissions (`automation: edit`, held by Admin Integration). `PUT /automated_emails/:id`, `POST /automated_emails/:id/preview` and `/test`, and `POST /automations/:id/email_preview` and `/email_test` are all blocked.
- **Why it is effectively unusable.** The PUT replaces the whole graph and needs every action's ObjectId, the edges, and `email_design_setting_id` (`GET /automated_emails/design` is also blocked). An integration key can't read any of those. It would have to be given them from another source, such as an Admin UI session, and a wrong body would overwrite the existing automation.
- **Staff access token: yes.** A staff token has a `user_id`, skips the allowlist, and is then authorised by the owning user's role. Administrator holds `automated_email: all` and `automation: browse/read/edit`. With a staff token from an Administrator or Owner, all the routes in section 3 are reachable.
- **Summary:** on v6.67, read-modify-write of automation emails takes a **staff access token** (or a logged-in admin session). The section 3 conclusion in this document, that an integration key suffices, was wrong; it overlooked the middleware.
- Not tested: whether a staff token on this pod works (none exists here), and whether the same allowlist is in place on the `-podcast` key's pod. The allowlist is code, so any v6.67 pod behaves the same.

### 4. Where og-webhook runs and which Ghost webhook calls it

- **Deployed on Railway**, not Cloud Run. The Railway project "Inkhorn Cron", production environment, has a service `og-webhook` with public domain `og-webhook-production.up.railway.app`; latest deploy status SUCCESS. An unauthenticated `GET /` returns 405, as the code does for non-POST.
- **Git history:** commit `15c1018` (2026-09-07) added it as "Cloud Run service"; commit `30607d3` (2026-09-30) fixed the Dockerfile path for Railway and added `railway.json`. The code is the same, and Cloud Run is not in use.
- **Service config:** variables are `GHOST_ADMIN_KEY`, `GHOST_URL`, `WEBHOOK_SECRET`. `GHOST_URL` is `https://accelerated-basilisk.pikapod.net` (the Inkhorn PikaPod).
- **Which Ghost webhook:** the webhook definition could not be read. `GET /webhooks` is not on the integration allowlist and no staff token exists here. Railway logs for `og-webhook` show it receiving `post.published` payloads that pass the signature check (log lines such as `post.published: "Basins"  target tag: inkhorn-1`, then the tag/post update lines), so a **`post.published` webhook in Ghost is calling it** with the matching secret. The webhook's own name and target URL are unconfirmed; that needs Ghost Admin → Settings → Integrations.
- **Side effect of this check:** I ran `railway link` inside the session scratchpad directory (not in the repo) to read the service list; nothing in the repo or in Railway was changed.

## Archive and newsletter audit

Date: 2026-10-10. Read-only. GET requests only against Ghost (Inkhorn Admin key from the Keychain); nothing written to Ghost. All posts and pages were fetched with `limit=all` (87 posts, 12 pages). Counts below are from that pull.

### 1. How the archive is defined

- **`routes.yaml` line 6:**
  ```yaml
  /archive/:
    controller: channel
    filter: tag:hash-archive
    order: published_at desc
  ```
  The `/archive/` page is a channel over the internal tag `#archive` (slug `hash-archive`). There is no visibility, type or status condition in the filter. Ghost serves only `published` posts on a channel, so scheduled posts don't appear yet. The page renders `theme/index.hbs` ("The Archive").
- **Home page "The Archive" section** (`theme/home.hbs`): `{{#get "posts" filter="tag:hash-archive+visibility:public" limit="4" order="published_at desc" include="tags"}}`. Four newest public archive posts. A separate dark card uses `tag:hash-this-week+visibility:public,tag:hash-this-week+visibility:paid`, limit 1. There are currently 0 `#this-week` posts.
- **Genre routes** (`/fiction/`, `/nonfiction/`, `/poetry/`, `/micro/`) use `filter: primary_tag:<genre>+tag:hash-archive`. `tag-fiction.hbs` also runs `{{#get "posts" filter="tag:fiction+tag:hash-archive"}}`. **`/art/`** (`primary_tag:art`), **`/founder-letter/`** (`primary_tag:letter`) and **`/podcast/`** (`primary_tag:podcast`) have no `hash-archive` condition.
- **Edition and issue routes** (`/autumn-2026/`, genre channels per issue) filter on the season tag (`tag:autumn-2026+tag:poetry` and so on) and are separate from the archive.
- **The `/archive/` list labels** items "Free" if `visibility` is `public`, otherwise "Subscribers" (`index.hbs`). The theme assumes some archive pieces may be non-public; none are today (see section 4).
- **`/digest/`** reuses the same `index` template with `filter: tag:hash-digest`.

### 2. The weekly newsletter (digest)

- **How identified:** internal tag `#digest` (slug `hash-digest`), `visibility: members`, slug pattern `inkhorn-review-week-of-<mon>-<d>-<yyyy>`, title "Inkhorn Review — Week of <Mon d>, <yyyy>", author `terry`, has a `feature_image`. `digest.js` creates it as a draft with `tags: [{name:'#digest'}]`, then publishes it with newsletter `inkhorn-review-digest`.
- **Posts found (3):**
  - 2026-10-01 "Week of Oct 1, 2026": status `published`, `/digest/inkhorn-review-week-of-oct-1-2026/`
  - 2026-09-20 "Week of Sep 20, 2026": status `published`, `/digest/inkhorn-review-week-of-sep-20-2026/`
  - 2026-09-13 "Week of Sep 13, 2026": status `sent`, `email_only: true`, url `/email/`
- **Newsletter field (corrected):** my first pull did not request `include=email,newsletter`, so it showed `null`. With those includes all three digests have an email record and newsletter `inkhorn-review-digest`; see GENRE-TAG-AND-DIGEST-AUDIT.md section B3. All three were emailed.
- **Do any appear on `/archive/`, the home archive section or contributor tag pages? No.** Each digest carries only the tag `#digest`, so `tag:hash-archive` can't match it. The live HTML of `/archive/` and `/` contains no "Week of" text. Contributor tag pages list posts by contributor tag, and the digests have none. They are reachable only at `/digest/` (members visibility).
- **Related, not part of the weekly newsletter:** four `sent` posts with `email_only: true`: "Processing", "Inkhorn Review is Live", "Your Inkhorn Piece" (tag `news`), and the Sep 13 digest. They have no `#archive` tag.

### 3. Everything else that is not an archive piece

| Kind | Identification | Count / status |
|---|---|---|
| Podcast episodes | primary tag `podcast`, plus an internal `hash-rs-<uuid>` tag (Riverside import) and a guest tag (e.g. `aleks-merilo`); author `terry`; URL `/podcast/<slug>/` | 10 published, public |
| Founder's letters | primary tag `letter`; `/founder-letter/<slug>/` | 2 published ("Drive-by Submissions", "Institutionalized"), 1 draft ("Both Sides Now") |
| Art | primary tag `art` plus the artist's tag; **no** `#archive` tag; `/art/<slug>/` | 3 published ("Dolly", "She Creates a Paradise", "Maritime Study") |
| Email-only / news | `email_only: true`, status `sent`; one has tag `news`, two have no tags | 3 posts ("Processing", "Inkhorn Review is Live", "Your Inkhorn Piece") |
| Digests | `#digest` | 3 (see section 2) |
| Catalog pages (issues) | pages tagged `#catalog` + `inkhorn-N` + season tag | No. 1 published (`inkhorn-review-no-1-autumn-2026`), No. 2 scheduled (Winter 2026) |
| Other pages | no tags or `hash-import-…` / `hash-patreon` | Home, About, Submissions, Books, Print Edition, Cart, Order Complete, Mailing Address (members), Subscriber Ebooks (draft, paid), Patreon Supporters (`#patreon`) |
| `#this-week` | tag only, no posts | 0 |

Issue tags (`inkhorn-1`, `inkhorn-2`, season tags) and contributor tags sit on archive pieces as well; they do not identify non-archive content.

### 4. Admin API filters and fields

**Archive pieces only, newest first**

```
GET /ghost/api/admin/posts/?filter=tag:hash-archive%2Bstatus:published&order=published_at%20desc&include=tags,authors
```
- Add `%2Bvisibility:public` for public only. Today that changes nothing (all 65 are public).
- Omit `status:published` to include the 21 scheduled Winter pieces (`status:[published,scheduled]`).
- `tag:hash-archive` alone matches nothing outside the archive. Art, letters, podcasts, digests and email-only posts do not carry it.

**Newest podcast episode**

```
GET /ghost/api/admin/posts/?filter=primary_tag:podcast%2Bstatus:published&order=published_at%20desc&limit=1&include=tags,authors
```
`tag:podcast` returns the same set today; `primary_tag:podcast` matches the route filter.

**Fields**

| | Archive piece | Podcast episode |
|---|---|---|
| Title | `title` | `title` ("Guest: Episode title") |
| Author byline | `custom_excerpt`, formatted "by <Name>". Every archive piece has one. `authors[]` is always the site account `inkhorn`, so it is not the byline. The contributor tag (`tags[].slug`/`name`) also carries the name. | Guest name: the title prefix before ":" and the guest tag. `authors[]` is `terry` (host). `custom_excerpt` is a bio blurb, not a byline. |
| URL | `url` (e.g. `/autumn-2026/my-heart-is-a-bird/`) | `url` (`/podcast/<slug>/`) |
| Image | `feature_image` is **null on all 65**. The cover comes from the issue tag (`inkhorn-N` / season tag `feature_image`). | `feature_image` (guest photo, e.g. `.../2026/10/Aleks-Merilo.jpg`); `og_image` is a shared tag-page image |

**Newest podcast episode right now:** "Aleks Merilo: Kicked Out of His Own Play", published 2026-10-07, `/podcast/aleks-merilo-kicked-out-of-his-own-play/`, public.
**Newest archive piece:** "My Heart is a Bird", "by Bull Garlington", published 2026-10-09 20:59 UTC, `/autumn-2026/my-heart-is-a-bird/`.

**Archive counts (`tag:hash-archive`)**

- Total: **65**. Published: 44. Scheduled: 21 (Winter 2026, going out 2026-12-01).
- Visibility: **65 public; 0 members-only; 0 paid.** The archive has no non-public pieces today, so the "Subscribers" label in `index.hbs` and the `visibility:paid` handling in `digest.js` have no live cases.
- Genre tags across the 65: poetry 33, fiction 26, micro 4, nonfiction 3 (one piece carries two genre tags, giving 66).
- Pieces without `custom_excerpt`: 0. Without `feature_image`: 65.

**Resolved later:** the live `/archive/` page's 31 anchors are 30 entries plus the Autumn issue-cover link (page size 30; page 2 has the other 14). The two `published` digests were emailed (see GENRE-TAG-AND-DIGEST-AUDIT.md B3).


## Live automation read with the staff token (2026-10-10)

`GET /automations/` and `GET /automated_emails/` return 200 with `GHOST_STAFF_TOKEN`. Two automations exist: `member-welcome-email-free` (id `6aca803482c1da000109e776`, active, 0 runs so far) and `member-welcome-email-paid` (inactive, no actions). The `/automated_emails/` facade returns `subject: null, lexical: null` for the free flow, so only the `/automations/:id` graph carries the email content.

Shape of `GET /automations/:id` (long strings truncated, ids kept):

```
{ automations: [ {
  id, slug, name, status: "active", created_at, updated_at,
  actions: [
    { id: "…3028", type: "send_email", stats: {…},
      data: { email_subject: "Welcome to Inkhorn Review", email_lexical: "<string 2193 chars>", email_design_setting_id: "6a95…" } },
    { id: "…3029", type: "wait", data: { wait_hours: 72 } },
    { id: "…302a", type: "send_email", data: { email_subject: "Two pieces to start with", email_lexical: "<1594>", … } },
    { id: "…302b", type: "wait", data: { wait_hours: 96 } },
    { id: "…302c", type: "send_email", data: { email_subject: "The life behind the work", email_lexical: "<1932>", … } },
    { id: "…302d", type: "wait", data: { wait_hours: 168 } },
    { id: "…302e", type: "send_email", data: { email_subject: "If you write", email_lexical: "<1819>", … } },
    { id: "…302f", type: "wait", data: { wait_hours: 168 } },
    { id: "…3030", type: "send_email", data: { email_subject: "Inkhorn in print", email_lexical: "<2122>", … } }
  ],
  edges: [ { source_action_id, target_action_id } × 8, linear ]
} ] }
```

This matches the source-derived shape. Send-email actions also carry a read-only `stats` object. `email_lexical` is a JSON string; its root children are all `paragraph` nodes (types seen: `extended-text`, `link`, `paragraph`, `root`).

**Markers not found.** None of the five emails contains `<!--welcome:archive-->` or `<!--welcome:podcast-->`. There is no `html` card node and no `<!--` anywhere in any `email_lexical`. Email 2 ("Two pieces to start with") is plain paragraphs with two links, and email 3 ("The life behind the work") has one link under "Here is the latest conversation." and a second link to the podcast page. The write was not attempted.
