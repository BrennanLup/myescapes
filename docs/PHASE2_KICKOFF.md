# Phase 2 kickoff brief (for the overnight orchestrator session)

Read this file first, then `docs/PHASE2_PLAN.md` (the full plan), `README.md`, `DECISIONS.md` and `src/contracts/README.md` (the Phase 1 architecture).

## Where things stand
- Phase 1 is complete on `main` in `BrennanLup/myescapes`: a cozy first-person 3D escape-room world (Vite + React + R3F, Fastify server, Zod contracts, seed/Sheet storage, mock or Claude extraction, daily gate, Playwright QA harness in `qa/playtest.mjs`).
- Push to `main` only. GitHub push access works.
- Railway project: service public domain `https://bubbly-hope-production.up.railway.app`. **The deploy is green** (verified 2026-10-26 04:20 UTC; `/health` returns `{"ok":true}`). Railway deploys every push to `main`.
- The `railway` CLI can't be installed (github.com downloads are blocked), so use Railway's GraphQL API at `https://backboard.railway.com/graphql/v2` with the header `Project-Access-Token: $RAILWAY_TOKEN`. Project `7340f6fa-9c30-494c-8fd9-07df91729f16`, environment `0b520879-ab8e-44ef-ab61-2a3d155f29dd`, services `bubbly-hope` (`863cb423-b5f3-44fa-a1d7-a14ab52fbee1`) and `Postgres` (`e377487d-9ae6-4fb7-b55d-2cf576d8e7b5`).
- **Railway Variables are all set by the owner** (verified by name): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `BETTER_AUTH_SECRET`, `DATABASE_URL` (reference to Postgres), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`. `GOOGLE_MAPS_API_KEY` is not set (optional). Do not write secrets to Railway yourself; if a new variable is needed, add it to the morning report.
- In this session, `ANTHROPIC_API_KEY` and `GOOGLE_MAPS_API_KEY` are not set, so local tests use mock extraction. The live deploy uses real Claude.
- Network (checked 2026-10-26): Hugging Face (Foursquare OS Places dataset), Anthropic, OpenAI, npm and Railway are reachable. `overpass-api.de` drops connections most of the time; treat the OSM importer as best-effort.
- `/about`, `/privacy` and `/terms` are live and linked from the Google consent screen. Keep them working, and honour every commitment in `/privacy` (see the plan's "Additions" section).
- Google OAuth client is created in Google Cloud project `myescapes`. The consent screen is in **Testing** mode with the owner as a test user. Redirect URIs: `https://bubbly-hope-production.up.railway.app/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`.

## Credentials (never print values; check names only)
- Claude environment variables: `RAILWAY_TOKEN` (Railway project token, for the `railway` CLI), plus `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_MAPS_API_KEY` for local testing.
- The deployed app reads the same names from **Railway Variables**. Verify they exist there with `railway variables` (names only). If any are missing and you can set them with the CLI from the environment, do so. Otherwise stop and tell the owner exactly which are missing.
- Postgres: the owner was asked to add a Railway PostgreSQL service. Wire `DATABASE_URL` as a Railway reference variable to it. If it does not exist, try `railway add --database postgres`; if that is not permitted, stop and ask.
- Generate `BETTER_AUTH_SECRET` (or the session secret) yourself and set it in Railway.

## Additions
Read the plan's "Additions approved 2026-10-26" section: the cut order if time runs short, and the extra requirements folded into existing workstreams.

## Preflight (do this before any building; report results to the owner and stop if anything blocks the morning test)
1. Env var names present (as above). Watch for typos such as `OOGLE_CLIENT_ID`.
2. Network reachability: `backboard.railway.com`, `api.anthropic.com`, `api.openai.com`, `overpass-api.de`, `places.googleapis.com`, `bubbly-hope-production.up.railway.app`, and the Foursquare Open Source Places download host. Use `curl -sS "$HTTPS_PROXY/__agentproxy/status"` to see policy denials, and name any blocked host to the owner.
3. Confirm the latest Railway deployment is `SUCCESS` (via the GraphQL API) and `/health` on the live URL returns ok.

## Decisions already made by the owner (confirmed 2026-10-26)
- Google sign-in with per-user spaces. PostgreSQL replaces Google Sheets entirely (remove the Sheet adapter).
- Mobile opens a light, logging-first app (no 3D): a big "Log an escape room" button plus a table of past rooms.
- A public directory of escape rooms with a public page per game, where everyone's reviews show. Reviews are **public by default** with a per-review "keep private" switch, plus a "friends only" level.
- Directory sources: **Foursquare Open Source Places + OpenStreetMap + user contributions**, with Google Places used only to store `place_id`s for "Open in Google Maps" links. **Do not scrape Google Maps** (it breaks Google's terms, and Places data other than IDs cannot be stored). Start with the US and Canada, then major cities in Europe, Asia and Australia.
- The daily gate becomes **Escape of the Day**: Wordle-style, the same puzzle for everyone, share grid, streaks, never blocks entry.
- Friends and shared visits exactly as in the plan's "Friends and shared visits" section, with these defaults: auto-accept tags is **off by default** and turned on per friend; **any accepted participant can edit shared facts**, with edit history; a joining friend's review **starts as a copy of the logger's scores and comments**, which they can edit (owner's choice). Copied scores stay flagged as copies and are excluded from public averages until the friend changes at least one score.
- The owner does most rooms with his girlfriend. Her name is not recorded here: do not assume one. The invite-link plus guest-claim flow handles linking her.

## How to work (the owner's rules)
- You are the orchestrator. Write contracts v2 first and commit them. Then launch the workstreams in the plan (about 38) as subagents in git worktrees, in parallel, each owning its folder. Then run one integrator, then separate **review agents**: auth and session security, cross-user data access (every rule in "Who can do what" has an API test), SQL and injection safety, directory licensing and attribution, and Phase 1 regressions using `qa/playtest.mjs`. Then QA and fix-up loops until clean.
- Review extensively before pushing. Typecheck, lint, Vitest and Playwright must all be green on every push to `main`.
- Never ask the owner questions mid-build unless something blocks the morning test. Record defaults in `DECISIONS.md`.
- Keep the Phase 1 3D room working, now fed by the signed-in user's data.
- Real Google sign-in cannot be automated. Add a test-only login route enabled only when `NODE_ENV=test`, with a test proving it is off in production.

## Definition of done: the owner's morning test, on the live Railway URL
1. On a laptop, "Continue with Google" leads to an empty personal 3D room.
2. On a phone, the same URL opens the mobile logging app.
3. Record a voice note about a past room. It is transcribed (OpenAI), extracted (Claude), matched to a directory venue or a new one, confirmed and saved.
4. Reload the laptop: the polaroid pins itself to the board, and the game has a public page showing the review.
5. The owner can text an invite link to his girlfriend. She signs in, becomes a friend, can claim guest-name visits, and visits he tags her on appear in her room.
6. Escape of the Day works on phone and laptop.

When done, report: the live URL, what was verified on the live deploy, what runs in mock mode, the directory import coverage per region, and anything the owner must do by hand (for example publishing the OAuth consent screen once there is a custom domain).
