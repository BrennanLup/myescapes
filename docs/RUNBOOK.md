# Runbook

Short operating notes for My Escapes on Railway. Never print, log or commit secret values; check variables by name only.

- Live URL: <https://bubbly-hope-production.up.railway.app>
- Railway project `7340f6fa-9c30-494c-8fd9-07df91729f16`, environment `0b520879-ab8e-44ef-ab61-2a3d155f29dd`, services `bubbly-hope` (the app, `863cb423-b5f3-44fa-a1d7-a14ab52fbee1`) and `Postgres` (`e377487d-9ae6-4fb7-b55d-2cf576d8e7b5`).
- Required app variables: `ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL` (a reference to the Postgres service), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`. Optional: `ANTHROPIC_MODEL`, `ADMIN_EMAILS`, `PUBLIC_URL`, `CAP_*`, `OPENAI_TRANSCRIBE_MODEL`. The full list is in the README. Never set `NODE_ENV=test` on Railway: it turns on the test-only login.

## Deploy

1. Work on `main` (or merge into it). Run `npm run check` (typecheck, lint, Vitest). For anything that touches pages or the 3D room also run `npm run test:e2e`.
2. `git push origin main`. Railway builds (`npm run build`), runs `npm run db:migrate` as the pre-deploy command, starts `npm run serve` and waits for `/health` (up to 120 s). The old deployment keeps serving until the new one is healthy.
3. Check it:
   - `curl -sS https://bubbly-hope-production.up.railway.app/health` returns `{"ok":true}`.
   - `curl -sS https://bubbly-hope-production.up.railway.app/api/status` should say `"storage":"postgres","database":"ready","auth":"google","extraction":"claude","transcription":"openai"`. `database: unavailable` means the app is up but can't reach Postgres; it retries every 30 s.
   - `node qa/live-smoke.mjs` and `node qa/live-daily.mjs` (read-only, signed out; they write screenshots to `qa/screenshots/phase2`, so `git checkout -- qa/screenshots` afterwards unless you want to keep them).
4. Deployment status without the Railway CLI: Railway's GraphQL API at `https://backboard.railway.com/graphql/v2` with the header `Project-Access-Token: $RAILWAY_TOKEN`, query `deployments(first: 3, input: {projectId, environmentId, serviceId}) { edges { node { status createdAt meta } } }`. `meta.commitHash` is the deployed commit.

**Roll back:** in the Railway dashboard, redeploy the previous successful deployment, or `git revert` the bad commit on `main` and push. Never force-push or rewrite `main`. A rollback does not undo a migration that already ran, so migrations should only add things (see below).

## Migrations

- The schema is `server/db/schema.ts` (Drizzle). After changing it, run `npm run db:generate`, which writes the next numbered SQL file into `server/db/migrations/`. Read the SQL, commit it with the schema change, and push. Migrations run on deploy (pre-deploy command) and again at server start, both under a Postgres advisory lock, so a second run is a no-op.
- Prefer additive changes (new tables, new nullable columns). If a column must be dropped or renamed, ship the code that stops using it first, then the migration in a later deploy, so a rollback still works.
- Run them by hand against a database with `DATABASE_URL=<url> npm run db:migrate`. For Railway, use the Postgres service's public connection URL from the Railway dashboard, typed into your shell, not saved in a file.
- `0000_extensions.sql` enables `pg_trgm` (fuzzy search). If an extension is missing, search falls back to ILIKE.
- The directory seed loader keeps its own bookkeeping table, `directory_seed_state`, created at runtime (not a Drizzle migration).
- Backups: Railway Postgres backups are not set up yet. Turn them on in the Postgres service before public launch.

## Refreshing the directory seed

The venue directory is committed in `seed/directory/` (one gzipped file per region plus `manifest.json`). On start, the server loads it into Postgres in the background when no imported venue exists yet or the manifest's `version` changed. It upserts by Foursquare id, keeps slugs and ids stable, never overwrites a user's applied correction, and only one instance loads at a time. `/health` never waits for it.

1. Regenerate (about 4 minutes for all regions; behind an HTTPS proxy Node needs `NODE_USE_ENV_PROXY=1`):
   ```sh
   NODE_USE_ENV_PROXY=1 npx tsx scripts/import/foursquare/index.ts --all          # every region
   NODE_USE_ENV_PROXY=1 npx tsx scripts/import/foursquare/index.ts --region us,ca # some regions
   ```
   It reads Foursquare OS Places release 2025-02-06 from the Source Cooperative mirror; `--base hf` with `HF_TOKEN` uses the official Hugging Face copy. Per-file results are cached in `.data/import-cache/`; delete that folder when you're done if disk matters.
2. Check the per-region counts in `seed/directory/manifest.json`, run `npm run check` (the seed tests check integrity and size), commit `seed/directory/` and push. The next deploy loads it.
3. Keep `seed/directory/LICENSE.txt`, `NOTICE.txt` and the change notice in `seed/directory/README.md` with the data (Apache-2.0).

Known gaps: when a new seed merges two venues that were separate before, the old second venue row stays; imported venues are not de-duplicated against venues users created; the OpenStreetMap importer is a stub. `DIRECTORY_SEED=off` turns the loader off.

Optional Google Maps links: with `GOOGLE_MAPS_API_KEY` in your shell (and a hard monthly cap set in Google Cloud), `DATABASE_URL=<url> npm run import:google -- --limit 100` stores Google place ids only. Without the key it does nothing.

## Admin

- Make someone an admin with `ADMIN_EMAILS` on the app service (comma separated; only counts once Google reports the email as verified), or set `users.is_admin = true` for that user in the Postgres service's data view. Admin changes take effect on the next request.
- There is no admin screen yet. While signed in as an admin on the live site, use the browser console (same origin, so the session cookie and Origin header are sent):
  ```js
  await (await fetch('/api/admin/reports')).json()                       // open reports, newest first
  await (await fetch('/api/admin/reports?status=hidden')).json()         // or dismissed
  await fetch('/api/admin/reports/REPORT_ID/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'hide' }) })     // or 'dismiss'
  await fetch('/api/admin/hide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'review', targetId: 'rev_...', hidden: true }) })  // review, photo, game or venue; hidden: false unhides
  ```
- Hidden reviews and photos disappear from public pages and averages; hidden games and venues answer 404 publicly. Unhiding a venue restores it only if it was hidden (a closed venue stays closed).
- Suggested edits to directory entries from non-creators are stored as `suggested` rows in the `sources` table; there is no review screen for them yet.

## Phase 1 data

`npm run migrate:phase1 -- --email you@example.com [--data-dir .data] [--visibility private|friends|public] [--dry-run]` imports Phase 1 rooms from `<data-dir>/store.json` into an existing account (sign in with Google once first). With `DATABASE_URL` set to the Railway Postgres public URL it writes to production; without it, to local PGlite. Imported reviews are private unless you pass `--visibility`. Crew names become guest names that friends can claim. The 12 invented sample rooms are only imported with `--include-seed`. It is safe to rerun (existing visits are skipped unless `--update`).

## Spending caps

Per user per UTC day: 20 minutes of transcription and 30 Claude extractions; globally 6 hours and 1000 calls. Override with the `CAP_*` variables. Over a cap the phone falls back to typing and mock extraction with a short message. `GET /api/me/usage` shows a signed-in user's meters.

## Privacy promises to keep

`public/privacy.html` promises: raw voice audio is deleted once transcribed (it is never written to disk or the database), users can delete their account from `/settings` (reviews, photos, voice notes and friendships removed, tags turned into plain names), users can download their data as JSON, and email is never shown publicly. `e2e/static-pages.spec.ts`, `server/auth/privacy.test.ts` and `server/routes/logs.test.ts` check these. Any change that touches them must keep those tests green and the page true.
