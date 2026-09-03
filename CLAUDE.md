# terryheath repo

Scripts and config for Terry Heath's Ghost sites. This is not a web app — it's a toolbox. Nothing here is deployed as a service; scripts are run on demand and config files are uploaded into Ghost by hand.

## Scope

**This repo is the only place to work for Inkhorn Review operations.** The whiterabbit monorepo is being retired and is not relevant to Inkhorn. Do not read, audit, or modify anything there for Inkhorn work.

Inkhorn Review's stack:
- **Publishing** — Ghost at inkhornreview.com (PikaPods). Posts, pages, and routing all managed there.
- **Submissions** — Duosuma. No submission code lives in this repo.
- **This repo** — five files only: `inkhorn/routes.yaml`, `inkhorn/contributors.json`, `inkhorn/build-shelves.js`, `inkhorn/shelves.json`, `inkhorn/ghost-footer-injection.html`. Nothing else.

## The sites

- **lifeonwords.com** — Life on Words, a literary podcast. Ghost instance on PikaPods. The podcast import pipeline in this repo feeds it.
- **inkhornreview.com** — Inkhorn Review, a bimonthly literary journal (6 issues/year, first Tuesday of alternating months: September, November, January, March, May, July). Ghost instance on PikaPods. Routes, contributor shelves, and code injection in this repo support it.
- **terryheath.com** — Personal site. Still on Ghost Pro, to be ported to PikaPods.

## What's in here

- **riverside-to-ghost.js** — Converts Riverside podcast recordings into Ghost posts with embedded audio, show notes, and book cards. Run manually after a new episode is edited. Looks up ISBNs via ISBNdb → Google Books → Open Library.
- **.github/workflows/import-podcast.yml** — GitHub Actions workflow that runs the podcast import pipeline. Triggered manually or on push.
- **headshots/** — Guest headshot images referenced by podcast posts.
- **inkhorn/routes.yaml** — Ghost custom routes for Inkhorn Review. Defines month-based collection URLs (`/september-2026/`, `/november-2026/`, `/january-2027/`, etc.) and genre channel routes (poetry, fiction, nonfiction per issue). Uploaded via Ghost Settings → Labs. The backup `inkhorn/routes.yaml.4-season.bak` preserves the original seasonal layout.
- **inkhorn/contributors.json** — Hand-maintained list of Inkhorn contributors and their book ISBNs. Add entries here to populate the book shelf.
- **inkhorn/shelves.json** — Generated output of `build-shelves.js`. Served from `raw.githubusercontent.com` and fetched client-side by the book shelf script. Commit and push after regenerating.
- **inkhorn/build-shelves.js** — Resolves ISBNs in `contributors.json` to titles, authors, and cover images. Writes `shelves.json`. Run with `ISBNDB_KEY` env var.
- **inkhorn/ghost-footer-injection.html** — JavaScript block pasted into Ghost's Site Footer code injection for Inkhorn Review. Renders a "Books by [Name]" shelf on contributor post pages.

## Recurring tasks

### Adding a contributor's books

1. Edit `inkhorn/contributors.json` — add the contributor's name and ISBN array.
2. Run the build:
   ```
   ISBNDB_KEY=$(security find-generic-password -s "isbndb-inkhorn" -w) \
     node inkhorn/build-shelves.js
   ```
3. Check the output — every ISBN should show `OK` with title, author, and cover.
4. Commit and push `inkhorn/shelves.json` (and `contributors.json`). The shelf appears automatically on the next page load.

### Rescheduling posts for an issue

Run:
```
node inkhorn/reschedule.js <YYYY-MM-DD> <HH:MM>
```
Example: `node inkhorn/reschedule.js 2026-11-04 00:00`

Fetches all scheduled posts, sorts them by current published_at order, and spaces them one minute apart from the given start time (UTC). Credentials come from Keychain automatically.

### Extending routes.yaml with more issues

Inkhorn publishes **6 issues per year** on a bimonthly schedule. Release months are the **odd months only**: September, November, January, March, May, July (i.e. month numbers 9, 11, 1, 3, 5, 7 — wrapping across the calendar year boundary between November and January).

Issue slugs are `{month}-{year}` in lowercase, where year is the calendar year the issue releases (e.g. `september-2026`, `november-2026`, `january-2027`, `march-2027`).

For each new issue, add to `routes.yaml`:

1. Three channel routes (in the `routes:` section):
   ```yaml
   /{month}-{year}/poetry/:
     controller: channel
     filter: tag:{month}-{year}+tag:poetry
     order: published_at asc
   /{month}-{year}/fiction/:
     controller: channel
     filter: tag:{month}-{year}+tag:fiction
     order: published_at asc
   /{month}-{year}/nonfiction/:
     controller: channel
     filter: tag:{month}-{year}+tag:nonfiction
     order: published_at asc
   ```

2. One collection block (in the `collections:` section, before the catch-all `/:`):
   ```yaml
   /{month}-{year}/:
     permalink: /{month}-{year}/{slug}/
     template: index
     filter: primary_tag:{month}-{year}
     data: tag.{month}-{year}
     order: published_at asc
   ```

Never remove existing blocks — those URLs are permanent once any piece publishes under them.

After editing, upload the file to Ghost: **Settings → Labs → Routes → Upload**. routes.yaml does not travel with a Ghost export and must be re-uploaded manually on any new Ghost install.

### Re-running the podcast import

Trigger the GitHub Actions workflow `import-podcast.yml` from the Actions tab, or run `riverside-to-ghost.js` locally with the required environment variables (Ghost Admin API key, Riverside credentials).

## Credentials

- **ISBNDB_KEY** — macOS Keychain, service name `isbndb-inkhorn`. Retrieve with `security find-generic-password -s "isbndb-inkhorn" -w`. To store or update: `security add-generic-password -s "isbndb-inkhorn" -a "$USER" -w "KEY_HERE"` (or `security delete-generic-password -s "isbndb-inkhorn"` first if updating).
- **Ghost Admin API key (Inkhorn)** — macOS Keychain, service name `ghost-admin-inkhorn`. Retrieve with `security find-generic-password -s "ghost-admin-inkhorn" -w`.
- **Ghost Content API key (Inkhorn)** — macOS Keychain, service name `ghost-content-inkhorn`. Retrieve with `security find-generic-password -s "ghost-content-inkhorn" -w`.
- **Ghost URL (Inkhorn)** — macOS Keychain, service name `ghost-url-inkhorn`. Retrieve with `security find-generic-password -s "ghost-url-inkhorn" -w`. Value: `https://accelerated-basilisk.pikapod.net`.
- **GitHub Actions secrets** — Configured on the repo's Settings → Secrets page.
- **Cloudflare** — Wrangler OAuth (run `npx wrangler login` if expired). DNS-only API token in GCP Secret Manager: `whiterabbit-cloudflare-api-token` in project `whiterabbit-prod`.

## Hard-won constraints — DO NOT relearn these

- **Ghost strips raw HTML on import.** Anything with markup must be wrapped in `<!--kg-card-begin: html-->` / `<!--kg-card-end: html-->`. The email card variant (`<!--kg-card-begin: email-->`) does NOT survive the same import path.
- **Ghost only sends newsletter email on a draft → published transition,** never on a post created as published in one API call. Two-step publish is required: create as draft, then update status to published.
- **inkhorn/routes.yaml does NOT travel with a Ghost export.** It must be re-uploaded via Settings → Labs on any new install, and it is irreplaceable once issues publish — there is no other canonical copy.
- **Never remove a collection block from routes.yaml.** Those URLs are permanent. Removing a block breaks every piece in that issue.
- **The book shelf renders client-side deliberately.** Do NOT rewrite it to modify post content via the Admin API — round-tripping a contributor's piece through Ghost's HTML converter risks damaging their work.
- **The Ghost Admin API cannot edit settings or code injection.** Anything in Settings has to be done by hand in the browser.

## Working style

Terry does not write code. Deliver work done, not instructions to follow. No test harnesses, no verification ceremonies — he validates by using the thing and will say if it's wrong.
