# terryheath repo

Scripts and config for Terry Heath's Ghost sites. This is not a web app — it's a toolbox. Nothing here is deployed as a service; scripts are run on demand and config files are uploaded into Ghost by hand.

## The sites

- **lifeonwords.com** — Life on Words, a literary podcast. Ghost instance on PikaPods. The podcast import pipeline in this repo feeds it.
- **inkhornreview.com** — Inkhorn Review, a quarterly literary journal. Ghost instance on PikaPods. Routes, contributor shelves, and code injection in this repo support it.
- **terryheath.com** — Personal site. Still on Ghost Pro, to be ported to PikaPods.

## What's in here

- **riverside-to-ghost.js** — Converts Riverside podcast recordings into Ghost posts with embedded audio, show notes, and book cards. Run manually after a new episode is edited. Looks up ISBNs via ISBNdb → Google Books → Open Library.
- **.github/workflows/import-podcast.yml** — GitHub Actions workflow that runs the podcast import pipeline. Triggered manually or on push.
- **headshots/** — Guest headshot images referenced by podcast posts.
- **inkhorn/routes.yaml** — Ghost custom routes for Inkhorn Review. Defines seasonal collection URLs (`/autumn-2026/`, `/winter-2027/`, etc.) and genre channel routes (poetry, fiction, nonfiction per season). Uploaded via Ghost Settings → Labs.
- **inkhorn/contributors.json** — Hand-maintained list of Inkhorn contributors and their book ISBNs. Add entries here to populate the book shelf.
- **inkhorn/shelves.json** — Generated output of `build-shelves.js`. Served from `raw.githubusercontent.com` and fetched client-side by the book shelf script. Commit and push after regenerating.
- **inkhorn/build-shelves.js** — Resolves ISBNs in `contributors.json` to titles, authors, and cover images. Writes `shelves.json`. Run with `ISBNDB_KEY` env var.
- **inkhorn/ghost-footer-injection.html** — JavaScript block pasted into Ghost's Site Footer code injection for Inkhorn Review. Renders a "Books by [Name]" shelf on contributor post pages.

## Recurring tasks

### Adding a contributor's books

1. Edit `inkhorn/contributors.json` — add the contributor's name and ISBN array.
2. Run the build:
   ```
   ISBNDB_KEY=$(gcloud secrets versions access latest --secret=whiterabbit-isbndb-api-key --project=whiterabbit-prod) \
     node inkhorn/build-shelves.js
   ```
3. Check the output — every ISBN should show `OK` with title, author, and cover.
4. Commit and push `inkhorn/shelves.json` (and `contributors.json`). The shelf appears automatically on the next page load.

### Extending routes.yaml with more years

Add four collection blocks per year (winter, spring, summer, autumn) following the existing pattern, plus three genre channel routes per season. Never remove existing blocks. Upload the updated file to Ghost → Settings → Labs → Routes.

### Re-running the podcast import

Trigger the GitHub Actions workflow `import-podcast.yml` from the Actions tab, or run `riverside-to-ghost.js` locally with the required environment variables (Ghost Admin API key, Riverside credentials).

## Credentials

- **ISBNDB_KEY** — GCP Secret Manager: `whiterabbit-isbndb-api-key` in project `whiterabbit-prod`. Retrieve with `gcloud secrets versions access latest --secret=whiterabbit-isbndb-api-key --project=whiterabbit-prod`.
- **Ghost Admin API keys** — Per-site, from each site's Settings → Integrations panel in Ghost.
- **GitHub Actions secrets** — Configured on the repo's Settings → Secrets page.
- **Cloudflare** — Wrangler OAuth (run `npx wrangler login` if expired). DNS-only API token in GCP Secret Manager: `whiterabbit-cloudflare-api-token` in project `whiterabbit-prod`.

## Hard-won constraints — DO NOT relearn these

- **Ghost strips raw HTML on import.** Anything with markup must be wrapped in `<!--kg-card-begin: html-->` / `<!--kg-card-end: html-->`. The email card variant (`<!--kg-card-begin: email-->`) does NOT survive the same import path.
- **Ghost only sends newsletter email on a draft → published transition,** never on a post created as published in one API call. Two-step publish is required: create as draft, then update status to published.
- **inkhorn/routes.yaml does NOT travel with a Ghost export.** It must be re-uploaded via Settings → Labs on any new install, and it is irreplaceable once issues publish — there is no other canonical copy.
- **Never remove a seasonal collection block from routes.yaml.** Those URLs are permanent. Removing a block breaks every piece in that issue.
- **The book shelf renders client-side deliberately.** Do NOT rewrite it to modify post content via the Admin API — round-tripping a contributor's piece through Ghost's HTML converter risks damaging their work.
- **The Ghost Admin API cannot edit settings or code injection.** Anything in Settings has to be done by hand in the browser.

## Working style

Terry does not write code. Deliver work done, not instructions to follow. No test harnesses, no verification ceremonies — he validates by using the thing and will say if it's wrong.
