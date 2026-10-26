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
- Plus: `users`, `sessions`, `wishlist_items`, `daily_puzzles`, `daily_results`, `reports`, and the friends and visits tables below. "Logs" are split into shared visits and personal reviews (see Friends and shared visits).

Public pages:
- `/games/:slug` shows the game, its venue, aggregate scores, puzzle highlights, and every public review with its author.
- `/venues/:slug` lists the games at that venue.
- `/cities/:slug` lists the venues in a city.

Logs are public by default, as you asked, with a per-log "keep private" switch. Users can report a review, and an admin can hide it.

### Friends and shared visits

The goal: you and your girlfriend do most rooms together and some apart. Each of you should see every room you played in your own room. When you played together, it should be logged once, but each of you keeps your own opinion.

#### Core idea: a visit is shared, a review is personal
A play-through splits into two parts:

- **Visit** (shared): the facts that are the same for everyone in the room. These are the game, the date, whether you escaped, the escape time, the features (visible timer, multi-room, flashlights, live actors), the tools, the puzzles and the photos. Logged once.
- **Review** (personal, one per person per visit): your scores from 1 to 100, your comments, your voice note and transcript, and which puzzles were memorable to you. Each person writes their own, and each person sets its visibility.

This means:
- A room you did together appears once on the public game page, with two reviews and a "played together" link between them.
- Shared facts count once, for example the venue's escape rate.
- Scores aren't double-counted: public averages count only reviews where the person entered their own scores.

#### Friends
- **Mutual friendships.** You send a request, they accept. Either side can unfriend or block. Only friends can tag you on a visit, which stops strangers from spamming your room.
- **Adding a friend**, three ways:
  1. **Invite link** (best for a partner). "Invite Mia" makes a link you text her. When she opens it and signs in with Google, you become friends automatically. Any guest names you already used for her can be claimed in one tap (see "Claiming guest names" below).
  2. Search by **@handle** or exact email address. There's no browsable user directory, which keeps people private.
  3. A **QR code** on your profile, for adding friends in person after a game.
- **Auto-accept per friend** (off by default). "Always add Brennan's visits to my room" means tags from that friend land straight in your room without a confirmation step. For a couple, you'd each turn this on for the other once.

#### Tagging people when you log
- The crew field on the log form suggests friends first, ordered by how often you play together, so your girlfriend is always the first chip. It also accepts plain names for people without accounts ("guests").
- **Crews (saved groups):** "Me + Mia" or "Work crew" can be tagged in one tap. These are a later addition; the frequency-ordered chips cover the common case first.
- **Tagged friend with auto-accept on:** the visit is added to her room straight away, and she gets a notice: "Brennan logged The Lost Observatory with you".
- **Tagged friend without auto-accept:** she sees an inbox item ("Brennan says you played The Lost Observatory together on Oct 12") with **Add to my room** or **That wasn't me**. Until she accepts, she shows on the visit as pending, by name only.
- **Her review after accepting:** empty, with **Add my take** (her own voice note or quick sliders) and **Copy Brennan's scores** (copied scores are marked as copies and left out of public averages until she edits them). She can skip it entirely. The visit is still in her room, showing as "no review yet".

#### Claiming guest names (backfilling history)
Your Phase 1 logs and any logs you make before she joins will list her as the plain name "Mia". When she accepts your invite link:
- She sees "Brennan has 23 visits with a guest named Mia. Is that you?" and claims them all, or picks some.
- Each claimed visit is linked to her account, using the same accept flow as tagging.

#### Logging the same room separately
If two friends log the same game on the same date (or within a day), the second person sees "Looks like Mia already logged this on Oct 12. Join her visit?" Joining merges into one visit: the shared facts are kept, conflicting facts are shown side by side for her to pick, and both reviews are kept.

#### Who can do what
These are enforced in the API and covered by tests. The security review checks this list.

| Action | Who |
| --- | --- |
| See a visit | Its accepted participants. Anyone else only through a public review on it |
| Edit shared facts (date, escaped, time, features, puzzles) | Any accepted participant. Edits are recorded ("edited by Mia") |
| Add photos to a visit | Any accepted participant. Only the uploader can remove their own |
| Write or edit a review | Only its author |
| Tag someone with an account | Only their accepted friends |
| Remove yourself from a visit | Any participant. Your review is removed, and the visit stays for the others |
| Delete a visit | Its creator, and only when no one else has accepted it. Otherwise the creator just leaves it |

- **Review visibility:** public (the default you asked for), friends only, or private. A visit with only private reviews never appears publicly.
- **Unfriending** keeps past shared visits for both of you, but stops new tags. **Deleting an account** removes that person's reviews and turns their tags into plain names.

#### How friends show up in the product
- **3D room:** every polaroid shows small avatar stickers for the crew. There's a new board sort, **Crew** ("With Mia", "Solo", "With the work crew"), so rooms done together cluster under one string.
- **Mobile:** the home screen shows "2 visits to confirm" above the log button. The rooms table has a crew column and a "with Mia / without Mia" filter.
- **Year wrap:** "Your #1 teammate: Mia, 23 rooms together, 87% escape rate".
- **Escape of the Day:** a friends leaderboard for today and streak comparisons.
- **Later:** visiting a friend's 3D room read-only ("Visit Mia's room").

#### Data model
| Table | Holds |
| --- | --- |
| `friendships` | user_a, user_b, status (pending, accepted, blocked), requested_by, auto-accept flag for each direction |
| `invites` | code, inviter, optional guest name to claim, expiry, used_by |
| `visits` | game, date, created_by, the shared facts |
| `visit_participants` | visit, user (or a guest name), status (owner, accepted, pending, declined), added_by. Each user appears at most once per visit |
| `reviews` | visit, author, scores and comments, transcript, memorable puzzles, visibility, copied-scores flag. One per author per visit |
| `visit_puzzles`, `visit_photos`, `visit_edits` | shared puzzles, photos with their uploader, the edit history |
| `notifications` | user, type, payload, read_at. Powers the inbox and the badge. Email can come later |

This replaces the single `logs` table from the earlier draft.

#### Morning-test addition
Before bed you send an invite link to your girlfriend. In the morning she signs in, claims "Mia" on your existing logs, and sees them in her own room. When you log a new room from your phone and tag her, it shows up in both rooms.

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

## Workstreams for the overnight build (about 38 agents in worktrees, then integration and review)

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
| 31 | Friends API: requests, accept, block, auto-accept, invite links | `server/routes/friends*` |
| 32 | Visits and participants API: tagging, accept or decline, leave, shared-fact edits with history | `server/routes/visits*` |
| 33 | Reviews API: one per author, visibility, copied-score flag, public aggregates | `server/routes/reviews*` |
| 34 | Guest-name claiming and same-room merge detection | `server/routes/claims*` |
| 35 | Friends UI: invite link, QR, search, inbox, notifications badge | `src/social` |
| 36 | Crew tagging in the log flow (friend chips by frequency, guests) | `src/mobile/log/crew` |
| 37 | Crew in the 3D room: avatar stickers, Crew sort, wrap teammate card | `src/world/board`, `src/ui/wrap` |
| 38 | Permission test suite: every rule in "Who can do what" as an API test | `server/authz.test.ts` |

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
