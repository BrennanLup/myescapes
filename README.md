# My Escapes

A cozy place to keep every escape room your crew has done.

Sign in with Google and you get your own first-person 3D room: a warm, low-poly gaming bedroom whose cork board holds a polaroid for each room you played, linked by red string. On a phone, the same URL opens a light logging app instead (no 3D): a big **Log an escape room** button and a table of your rooms. Record a voice note about a room; it is transcribed (OpenAI), turned into a structured review (Claude), matched to a venue from the public directory, checked on a form and saved. Every game has a public page with everyone's public reviews. Friends can tag each other on shared visits, and **Escape of the Day** is a small Wordle-style puzzle, the same for everyone, with streaks and a share grid.

It still works with no configuration at all: without keys it uses a local in-process database, mock transcription and a rule-based mock extractor, and signed-out visitors get a read-only demo room with 12 invented sample rooms.

Live: <https://bubbly-hope-production.up.railway.app>. Operating notes are in [`docs/RUNBOOK.md`](docs/RUNBOOK.md); the Phase 2 morning report is [`docs/PHASE2_REPORT.md`](docs/PHASE2_REPORT.md).

## Run it

You only need [Node.js](https://nodejs.org/) 22.12+ (or 20.19+), the range Vite 8 supports. Check with `node -v`.

```sh
git clone https://github.com/BrennanLup/myescapes && cd myescapes && npm start
```

`npm start` installs dependencies (first run only), builds the app, starts the server and opens <http://localhost:3000>. Press Ctrl+C to stop it.

- Another port: `PORT=3001 npm start`
- Don't open a browser: `NO_OPEN=1 npm start`
- Skip the build when nothing changed: `npm start -- --no-build`

Locally the database is PGlite (a WebAssembly Postgres in `DATA_DIR/pglite`), so nothing else needs installing. Google sign-in needs the three auth variables below and the redirect URI `http://localhost:3000/api/auth/callback/google` on the Google OAuth client.

## Pages

| Path | What |
| --- | --- |
| `/` | Signed out on a laptop: the landing page with **Continue with Google**. Signed in: the 3D room (after a one-time display name and @handle step). Phones are sent to `/m`. `/?desktop=1` keeps a phone on the 3D room; `/?demo=1` opens the signed-out demo room. |
| `/m` | The phone app: log a room (voice, captions or typing), the rooms table, review detail, visits to confirm, Escape of the Day card. Never downloads three.js. |
| `/games/:slug`, `/venues/:slug`, `/cities/:slug` | Public directory pages: aggregates, puzzle highlights behind "Show spoilers", public reviews by @handle (never email), "played together" links, a report button, source attribution. |
| `/daily` | Escape of the Day. Also behind the door of the 3D room and on the phone's home screen. |
| `/settings` | Profile, inbox (tags and guest-name claims), friends, invite links and QR code, data download (JSON), account deletion, and links to the legal pages. |
| `/invite/:code` | An invite link: sign in, become friends, claim visits logged under a guest name. |
| `/welcome` | The landing page directly (also where a failed sign-in explains itself). |
| `/about`, `/privacy`, `/terms` | Static pages (`public/*.html`, served by `server/static.ts`), linked from the Google consent screen. |

## Controls (3D room)

| | Desktop | Phone / tablet |
| --- | --- | --- |
| Walk | `W` `A` `S` `D` (or arrow keys), `Shift` to run | Left-thumb joystick |
| Look | Click the room to lock the mouse, then move it. `Esc` releases it | Drag anywhere |
| Interact | Aim the centre dot at something and click or press `E` | Aim at it, then press the big **Tap** button (or tap the thing) |
| Sort the board | Keys `1`-`6`, the sort chips at the top right, or the tabs on the board itself (the seventh tab, **Crew**, groups rooms by who you played with) | Sort button at the top right, or the tabs on the board |
| Close a panel | `Esc` or the × button | The × button |

The round buttons at the top right open the wish list, the year wrap, the voice recorder, settings (sensitivity, invert Y, quality, head bob, and an Account link to `/settings` when signed in), sound and the controls help.

## Features

- **Accounts.** Google sign-in (scopes `openid email profile` only), sessions in Postgres, a public display name and unique @handle chosen once. Your email is never shown publicly.
- **The board.** One polaroid per room, grouped by city, brand, genre, date, rating, escape time or crew, with crew stickers. Rooms logged elsewhere (for example from your phone) fly in from the desk and pin themselves.
- **Voice logging.** On the phone the recording is kept in IndexedDB until the server confirms the transcript, so a failed upload in a basement retries later. Audio is processed in memory and deleted once transcribed. Live captions are opt-in. Over a daily spending cap, or if transcription fails, the app falls back to typing and mock extraction with a short message.
- **Directory.** About 3,350 escape-room venues in 42 regions (US and Canada, plus major cities in Europe, Asia and Australia) from Foursquare Open Source Places, plus venues and games users add while logging. Search is fuzzy (pg_trgm).
- **Shared visits.** A visit (game, date, escaped, time, puzzles, photos) is logged once; each person writes their own review. Friends are mutual; only friends can tag you; tags wait in your inbox unless you turned on auto-accept for that friend. A joining friend's review starts as a copy that is left out of public averages until they change a score. Any accepted participant can edit the shared facts, with history.
- **Review form.** Every question on one scrolling page (phone keyboards never hide the field you're typing in), the room found in the directory as you type (nearest first with **Near me**, or add a new one), and photos added while you write: resized in the browser, uploaded with progress right after you save, with Retry. Photos can also be added later from the review in the 3D room or the room's page on the phone.
- **Reviews.** Public by default, or friends only, or private. Comments can be marked as spoilers. Admins can hide reviews, photos, games and venues that were reported.
- **Escape of the Day.** Six guesses, hints that cost points, a spoiler-free share grid, streaks counted against the server's record of your day, and a friends leaderboard.
- **Wish list** and the **Year in Escape Rooms** wrap (now with your #1 teammate).

## Configuration

Everything is optional locally. Copy `.env.example` to `.env` and fill in what you want. The server prints which features are real and which are mocked when it starts (names only, never values), and `/api/status` reports the same.

| Variable | Without it | With it |
| --- | --- | --- |
| `DATABASE_URL` | An in-process Postgres (PGlite) stored in `DATA_DIR/pglite`. | Postgres (Railway). Migrations run before every deploy and again on start. |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `BETTER_AUTH_SECRET` | Sign-in is off: `/api/auth/*` answers 404 and everyone is signed out. | "Continue with Google". `BETTER_AUTH_SECRET` is any long random string. |
| `PUBLIC_URL` | The public origin is `BETTER_AUTH_URL`, else `https://$RAILWAY_PUBLIC_DOMAIN` (Railway sets it), else the request's host. | The public origin for the auth callback, invite links, canonical and Open Graph URLs. |
| `BETTER_AUTH_URL` | See `PUBLIC_URL`. | Same as `PUBLIC_URL`, read after it. |
| `ANTHROPIC_API_KEY` | Reviews are extracted by the offline rule-based mock extractor. | Claude extraction, with venue and game hints. Falls back to the mock if a call fails. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | The Claude model used for extraction. |
| `OPENAI_API_KEY` | Mock transcription (returns a sample voice note). | Server-side transcription of recordings. |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | The OpenAI transcription model. |
| `CAP_TRANSCRIBE_SECONDS_PER_USER`, `CAP_EXTRACT_CALLS_PER_USER`, `CAP_TRANSCRIBE_SECONDS_GLOBAL`, `CAP_EXTRACT_CALLS_GLOBAL` | 1200 s, 30 calls, 21600 s, 1000 calls per UTC day. | Daily spending caps (whole numbers). |
| `ADMIN_EMAILS` | Only users with `users.is_admin = true` are admins. | Comma-separated emails that are admins, once that Google email is verified. |
| `GOOGLE_MAPS_API_KEY` | The place-ID linker does nothing. | `npm run import:google` attaches Google place ids for "Open in Google Maps" links (ids only). Not used by the server. |
| `DIRECTORY_SEED` | The committed directory seed loads in the background when the directory is empty or the seed changed (off by default under `NODE_ENV=test`). | `off` turns the loader off. |
| `DIRECTORY_SEED_DIR` | `seed/directory` | Another seed folder. |
| `ENRICH_SAMPLE` | Off locally and in tests (needs `ANTHROPIC_API_KEY`). | On: once the directory is loaded, a one-off sample run of the room crawler reads a few venue websites. `off` turns it off. |
| `ENRICH_SAMPLE_VENUES`, `ENRICH_SAMPLE_BUDGET_USD` | 40 venues, $3 (budget capped at $10). | Size of that sample run. Bigger runs are started by an admin at `/admin/rooms`. |
| `ENRICH_MODEL` | `ANTHROPIC_MODEL`, else the extraction default. | Model the room crawler uses. |
| `TRUST_PROXY_HOPS` | 3 | How many private-address proxy hops to trust for the client address (rate limits). |
| `PG_POOL_MAX` | 10 | Postgres pool size. |
| `MIGRATION_TIMEOUT_MS` | 30000 | How long start-up waits for migrations before listening anyway. |
| `PORT` | `3000` | Port the server listens on (Railway sets it). |
| `DATA_DIR` | `.data/` in the repo (gitignored) | Where PGlite and the signed-out demo's local entries live. |
| `NODE_ENV` | | `test` enables the test-only login route (`POST /api/test/login`); it is 404 in every other mode. Never set it to `test` on Railway. |

Railway has `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `OPENAI_API_KEY` set. `ADMIN_EMAILS` and `GOOGLE_MAPS_API_KEY` are optional and not set.

If the database can't be reached or migrated at startup, the server still starts: `/health`, the static pages and the signed-out demo keep working, database routes answer 503 `db_unavailable`, and it retries every 30 seconds.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Install if needed, build, serve on `PORT`, open the browser. |
| `npm run dev` + `npm run dev:server` | Development: Vite with hot reload on <http://localhost:5173> (proxies `/api` to the server) and the API server with file watching. Run them in two terminals. |
| `npm run build` | Production build into `dist/` (plus precompressed `.br`/`.gz`). |
| `npm run serve` | Start the server only (expects `dist/`). |
| `npm test` | Unit, component and API tests (Vitest, on PGlite). |
| `npm run test:e2e` | End-to-end tests (Playwright, desktop 1440x900 and a Pixel 7), including the full morning test (`e2e/morning.spec.ts`). Builds the app and serves it on `E2E_PORT` (default 3100) under `NODE_ENV=test` (test-only login, mock transcription and extraction) with a throwaway `DATA_DIR`, so your data is never touched. Set `E2E_DATABASE_URL` to a local Postgres database whose name contains `e2e` to run against real Postgres (it is dropped and recreated each run); otherwise PGlite. Needs a Playwright Chromium (`npx playwright install chromium` once). |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript, no emit. |
| `npm run check` | Typecheck, lint and unit tests. Must be green before every push to `main`. |
| `npm run db:migrate` | Apply migrations (under an advisory lock; safe to rerun). |
| `npm run db:generate` | Write a new migration after changing `server/db/schema.ts`. |
| `npm run db:seed` | Add the 12 invented demo rooms to a local database (refuses to run in production). |
| `npm run migrate:phase1` | Import Phase 1 logs (`DATA_DIR/store.json`) into an account. See the runbook. |
| `npm run import:google` | Google place-ID linker (needs `GOOGLE_MAPS_API_KEY`). |
| `node qa/live-smoke.mjs`, `node qa/live-daily.mjs` | Read-only checks of the live deploy (signed out). |

## Project structure

```
server/                 Fastify server
  index.ts              Start-up: migrate, listen, directory seed, shutdown
  context.ts http.ts    AppContext (db, users, admins) and defineRoute (auth, validation, output parsing)
  db/                   Drizzle schema, migrations, spending caps, Phase 1 mapping, fixtures, PGlite harness
  auth/                 Better Auth with Google, sessions, handles, account rules
  extract/              Claude and mock extractors, directory hints
  routes/               One module per workstream, listed in routes/registry.ts
  seo/                  Meta and Open Graph tags, robots.txt, sitemap
  static.ts             dist/, the static pages, SPA fallback
src/
  contracts/            Shared zod schemas: models.ts, routes.ts (every route), errors.ts; Phase 1 types
  router.tsx            Small client router; the 3D room (desktop.tsx) is lazy-loaded
  auth/                 useSession, sign-in, onboarding
  mobile/               shell, log (record, confirm, crew chips, upload queue), match, list
  public/               landing, game, venue, city, reviews
  social/               invites, QR, friends, inbox, settings
  daily/                Escape of the Day engine and UI
  world/ player/ interaction/ ui/ state/ audio/ gate/   The 3D room (Phase 1, now on per-user data)
scripts/
  import/               Foursquare importer, de-duplication, Google place-ID linker, OSM stub
  migrate-phase1/       Phase 1 data import
seed/                   12 invented demo rooms; seed/directory is the committed venue directory
e2e/                    Playwright tests
qa/                     Playtest harness, live checks, QA report and screenshots
docs/                   Phase 2 plan, kickoff, runbook, report
```

Each folder has its own README with details. Design choices are listed in [`DECISIONS.md`](DECISIONS.md), and asset, data and library credits in [`CREDITS.md`](CREDITS.md). Venue data is from Foursquare Open Source Places (Apache-2.0); `seed/directory/LICENSE.txt` and `NOTICE.txt` ship with it.

## Deploying to Railway

The app deploys to Railway from `main` on every push (service `bubbly-hope`, with a `Postgres` service in the same project). `railway.json` builds with `npm run build`, runs `npm run db:migrate` before each deploy, starts with `npm run serve` and health-checks `/health` (120 s). See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for deploys, migrations, refreshing the directory and admin tasks.
