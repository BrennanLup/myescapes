# Phase 2 plan: accounts, a real database, mobile logging, a public directory, Escape of the Day

Status: draft for approval. Nothing here is built yet.

## The morning test (definition of done for the overnight run)

1. Open the deployed app on a laptop, click **Continue with Google**, and land in your own, empty 3D room.
2. Open the same URL on your phone. It shows the mobile app (no 3D): a big **Log an escape room** button and your list of rooms.
3. Record a voice note about a room you did in the past. It is transcribed, turned into a review, matched to a real venue from the directory (or a new one is created), confirmed, and saved.
4. Back on the laptop, reload. The new polaroid pins itself to your board. The room also has a public page where your review shows.
5. Escape of the Day works on both phone and laptop: same puzzle for everyone today, a share grid, and a streak.

Everything else in this plan is secondary to that path.

## What changes from Phase 1

| Area | Phase 1 | Phase 2 |
| --- | --- | --- |
| Accounts | None, single shared space | Google sign-in. Every user gets their own room, logs, wish list and streak |
| Storage | Seed JSON + optional Google Sheet | PostgreSQL on Railway. Google Sheets is removed |
| Mobile | The 3D world with a joystick | A light 2D app focused on logging, with a table of past rooms. No three.js download |
| Escape rooms | A user's private list | A shared public directory of venues and games, each game with a public page and everyone's reviews |
| Daily puzzle | A gate you must solve to enter | **Escape of the Day**: optional, Wordle-style, the same puzzle for everyone, shareable results, streaks |
| Voice | Browser speech recognition only | Server-side transcription of the recording (works on iPhone), with the browser's live captions as a preview |

## Key decisions (my recommendations)

### Database: PostgreSQL on Railway, with Drizzle ORM
- One Railway Postgres service in the same project; the app reads `DATABASE_URL`.
- Drizzle for typed queries and versioned migrations (`drizzle-kit`). Migrations run automatically on deploy.
- `pg_trgm` for fuzzy venue and game search ("did you mean Starlight Escapes?").
- Venue latitude and longitude as plain columns, for "near me" and city pages. PostGIS only if we outgrow it.
- Photos: resized in the browser (about 1600 px, under 400 KB) and stored in Postgres for now. This avoids an object-storage credential tonight. Move to a bucket later if volume grows.

### Auth: Google sign-in with Better Auth
- Better Auth (Google provider, Drizzle adapter, httpOnly cookie sessions stored in Postgres), mounted under `/api/auth/*` in Fastify.
- Scopes: `openid email profile` only. These are non-sensitive scopes, so the Google consent screen can be published without Google's app verification review.
- Callback URL: `https://<railway-domain>/api/auth/callback/google`, plus `http://localhost:3000/api/auth/callback/google` for local runs.
- A test-only sign-in route, enabled only when `NODE_ENV=test`, so the end-to-end tests can sign in without Google. A guard test proves it is off in production.
- Every API route is scoped to the signed-in user. Public pages are read-only.

### The directory of every escape room (not by scraping Google Maps)
Scraping Google Maps directly breaks Google's Terms of Service, gets blocked quickly, and the data could not legally be kept in our own database anyway. Even through the official Places API, Google only lets you store place IDs permanently, not names, addresses or ratings. So the plan builds the same thing from sources we are allowed to store:

1. **Foursquare Open Source Places** (free, Apache-2.0, includes an escape room category). This is the bulk import for the US, Canada, and major cities in Europe, Asia and Australia.
2. **OpenStreetMap** (`leisure=escape_game`, ODbL, with attribution on public pages). It fills gaps and cross-checks.
3. **Our users.** Every log can create or correct a venue and its games. Over time this becomes the best source.
4. **Google Places API (optional key).** Used only to attach a Google place ID, which we may store, so each page can link to "Open in Google Maps". It can also fetch live details on demand.

Import pipeline: per-source importers, then normalisation, de-duplication (name similarity plus distance under about 75 m), city and country tagging, URL slugs, and a `sources` table recording where each fact came from. It runs as a resumable script, region by region, starting with the US and Canada.

### Data model: venues, games, logs
A Google Maps listing is a business (for example "Starlight Escapes, 12 Main St"). Players review a specific game inside it ("The Lost Observatory"). So:

- `venues`: business locations from the directory (name, brand, address, city, region, country, lat/lng, website, phone, slug, source ids, google place id).
- `games`: individual rooms inside a venue (name, genre, players, duration, slug). Mostly created by users the first time someone logs that room.
- `logs`: a user's play-through of a game (date, crew, ratings, puzzles, escaped, time, features, tools, transcript, photos, visibility).
- Plus: `users`, `sessions`, `log_puzzles`, `log_photos`, `log_crew`, `wishlist_items`, `daily_puzzles`, `daily_results`, `reports`.

Public pages:
- `/games/:slug` shows the game, its venue, aggregate scores, puzzle highlights, and every public review with its author.
- `/venues/:slug` lists the games at that venue.
- `/cities/:slug` lists the venues in a city.

Logs are public by default, as you asked, with a per-log "keep private" switch. Users can report a review, and an admin can hide it.

### Mobile app
- Phones get a separate light route, `/m` (an automatic redirect on phones, plus a "View on desktop" escape hatch). It is code-split so the phone never downloads three.js.
- Home screen: a big **Log an escape room** button, then a compact, searchable table of your rooms (name, venue, city, date, overall score, escaped). Tapping a row shows the review.
- Logging flow:
  1. Record a voice note, with the same prompt checklist as Phase 1.
  2. Upload the audio and get a transcript, then a structured draft from Claude.
  3. Confirm which venue and game it was, picking from the directory matches or creating new ones.
  4. Edit any flagged fields on the confirm form.
  5. Save, and it is public.
- If the upload or transcription fails, the browser's live captions or typing still work.
- No 3D, no joystick, no wish-list board on phones.

### Escape of the Day
- One puzzle per calendar day, the same for everyone, numbered like Wordle ("Escape #12"). It changes at midnight in your local time zone.
- It reuses and extends the Phase 1 generators (combination lock, symbol cipher, sequence, search-the-image), seeded by the date instead of personal history. Each day is themed on a real room from the directory: "Today's escape is inspired by The Lost Observatory, San Francisco".
- Limited guesses, with optional hints that cost points. Results are stored per user, with streaks and the best time.
- Spoiler-free share text (an emoji grid plus time) that people can paste into group chats.
- In the 3D room, the door becomes the daily puzzle and no longer blocks entry. On mobile it is a card on the home screen.

### Voice transcription
The Claude API does not take audio, so transcription needs a speech-to-text provider. I recommend OpenAI's transcription API: one key, fractions of a cent per minute, and reliable on iPhone recordings. Claude then turns the transcript into the structured review, as in Phase 1.

## Workstreams for the overnight build (about 30 agents in worktrees, then integration and review)

| # | Workstream | Owns |
| --- | --- | --- |
| 1 | Contracts v2: new types, API schemas and route list | `src/contracts` |
| 2 | Database schema, migrations, seed and test fixtures | `server/db` |
| 3 | Auth: Better Auth + Google, sessions, test login | `server/auth`, `src/auth` |
| 4 | User-scoped API: logs, wish list, profile | `server/routes/logs*`, `wishlist*` |
| 5 | Directory API: search, nearby, venue/game/city queries | `server/routes/directory*` |
| 6 | Importer: Foursquare OS Places | `scripts/import/foursquare` |
| 7 | Importer: OpenStreetMap | `scripts/import/osm` |
| 8 | Normalisation and de-duplication | `scripts/import/dedupe` |
| 9 | Google place-ID linker (optional key) | `scripts/import/google` |
| 10 | Transcription endpoint + audio upload | `server/routes/transcribe*` |
| 11 | Extraction v2 (venue and game matching hints) | `server/extract` |
| 12 | Venue and game matcher UI (pick or create) | `src/mobile/match` |
| 13 | Mobile shell, routing, device redirect | `src/mobile/shell` |
| 14 | Mobile log flow (record, confirm, save) | `src/mobile/log` |
| 15 | Mobile rooms table + review detail | `src/mobile/list` |
| 16 | Public game page | `src/public/game` |
| 17 | Public venue and city pages | `src/public/venue`, `src/public/city` |
| 18 | Public reviews: author cards, report button, aggregates | `src/public/reviews` |
| 19 | Landing page + sign-in screen | `src/public/landing` |
| 20 | 3D room on the new API (per-user data, loading, empty state) | `src/world`, `src/state` |
| 21 | Escape of the Day: generators and daily seeding | `src/daily/engine` |
| 22 | Escape of the Day: UI, share grid, streaks (mobile + desktop) | `src/daily/ui` |
| 23 | Escape of the Day: results API | `server/routes/daily*` |
| 24 | Photo upload, resize, storage | `server/routes/photos*`, `src/ui/photos` |
| 25 | Moderation: reports, admin hide | `server/routes/admin*` |
| 26 | SEO and sharing: meta tags, Open Graph images for public pages | `server/seo` |
| 27 | Railway deploy: Postgres wiring, migrations on deploy, health, logs | `railway.json`, `server/index.ts` |
| 28 | Data migration: import Phase 1 seed and `.data` logs into your account | `scripts/migrate-phase1` |
| 29 | End-to-end tests: the morning test on desktop + mobile | `e2e/` |
| 30 | Docs: README, DECISIONS, env vars, runbook | docs |

After the workstreams finish:
- **Integration:** one agent merges and wires everything.
- **Review:** separate review agents check auth and session security, data-access scoping (no user can read or write another user's private data), SQL and injection, and directory licensing and attribution. One agent also re-runs the Phase 1 QA harness for regressions.
- **QA loop:** fix-up agents run until clean.
- **Deploy and confirm:** deploy to Railway, run a smoke test against the live URL, and check `/health`.

## Risks and open questions
- **Directory coverage.** Foursquare and OSM will not have every venue, and some entries will be closed or duplicates. User logs fill the gaps. Coverage is reported per region after the import.
- **Bulk dataset download.** The Foursquare dataset is large. The importer streams and filters to the escape room category, and the host it downloads from must be on the network allowlist.
- **Real Google sign-in cannot be automated in tests.** It is covered by the test login, plus one manual check by you in the morning.
- **Cost.** Railway Postgres (small), Claude per log (cents), transcription (fractions of a cent per minute), and Google Places only if enabled, with a hard monthly cap set in Google Cloud.
