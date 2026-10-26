# Phase 2 morning report

Good morning. Phase 2 is built, merged into `main` and live on Railway. The short version: everything on the morning-test path works end to end in automated tests with a test login, and the parts of it I could check on the live site without a real Google account all pass. The pieces that need your own Google account (signing in, a real voice note through OpenAI and Claude, the invite to your girlfriend) are yours to try first thing, and there are a couple of settings you need to change in Google Cloud for her to be able to sign in at all. Details below.

## The live site

The app is at <https://bubbly-hope-production.up.railway.app>. On a laptop it opens the landing page with "Continue with Google"; on a phone the same URL opens the mobile logging app at `/m`.

The deployed version is commit `b149b29` (the last QA round), and Railway reports that deployment as SUCCESS. This report's own commit only changes documentation, so the next deploy runs the same code.

## What I checked on the live deploy

I ran these against the live URL on 2026-10-26, signed out, without writing anything on the server:

- `/health` returns ok, and `/api/status` says the database is Postgres and ready, sign-in is Google, extraction is real Claude and transcription is real OpenAI.
- The seven required Railway variables are present (I checked names only): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `OPENAI_API_KEY`.
- The read-only live smoke test (`qa/live-smoke.mjs`) passed 16 of 16. The laptop landing page shows "Continue with Google", and clicking it goes to Google with the right callback (`https://bubbly-hope-production.up.railway.app/api/auth/callback/google`). The phone is sent to the mobile app. The signed-out demo 3D room loads with its 12 sample rooms, and Escape of the Day opens from the door. `/about`, `/privacy` and `/terms` load. A venue page renders, an unknown game shows a friendly not-found page, an unknown invite link explains itself, and a failed Google sign-in on a phone now says what went wrong. No page logged an error.
- The live Escape of the Day check (`qa/live-daily.mjs`) played today's puzzle (Escape #1) to the end on a laptop and on a phone. The share text is spoiler-free and links to `/daily`, the streak shows, and the result survives a reload.
- The directory loaded into the live Postgres: the sitemap lists 3,354 venue pages and 1,255 city pages, which matches the committed seed exactly. Search returns real venues.
- The test-only login route answers 404 on the live site, as it should, and `/api/me` answers 401 when signed out.

What I could not check live, because it needs a real Google account: signing in, the name and @handle step, a real voice note going through OpenAI transcription and Claude extraction, saving a room, the polaroid appearing on the laptop, a live public game page with a review, and the invite, claim and tagging flow between two real accounts. All of these pass locally in `e2e/morning.spec.ts`, on both the laptop and phone projects, using the test login and mock transcription and extraction. The OpenAI transcription call itself has only ever been tested against a fake, so your first voice note is also its first real run.

## What runs in mock mode

Nothing on the live site runs in mock mode by default: it uses real Claude, real OpenAI, real Google sign-in and Railway Postgres. Mock pieces only step in as fallbacks:

- If you go over a daily spending cap, or OpenAI fails, the phone switches to typing, and extraction uses the rule-based mock extractor with a short message. The caps per person per UTC day are 20 minutes of transcription and 30 Claude extractions, with a global ceiling of 6 hours and 1,000 calls.
- If a Claude call fails, that one draft comes from the mock extractor, and the confirm screen says so.
- Signed-out visitors get the read-only demo room with 12 invented sample rooms. On Railway they can't save anything.

Locally, and in all the automated tests, transcription and extraction are mocked and the database is PGlite. The Google place-ID linker has never run, because `GOOGLE_MAPS_API_KEY` isn't set, so no venue has an "Open in Google Maps" link yet.

## Directory coverage

There are 3,354 venues across 42 regions, from Foursquare Open Source Places (release 2025-02-06, Apache-2.0). The counts are after de-duplication:

- **North America:** United States 2,120 (in 1,133 cities), Canada 212.
- **Europe:** London 69, Manchester 15, Paris 56, Berlin 28, Munich 12, Hamburg 19, Amsterdam 11, Madrid 50, Barcelona 61, Rome 18, Milan 8, Dublin 4, Lisbon 12, Brussels 19, Vienna 16, Zurich 11, Prague 55, Warsaw 38, Budapest 33, Copenhagen 8, Stockholm 13, Athens 48, Istanbul 20.
- **Asia and the Middle East:** Tokyo 43, Osaka 16, Seoul 60, Singapore 17, Hong Kong 9, Taipei 25, Bangkok 12, Kuala Lumpur 21, Manila 6, Jakarta 85, Dubai 18.
- **Australia and New Zealand:** Sydney 24, Melbourne 32, Brisbane 7, Perth 10, Adelaide 7, Auckland 6.

Foursquare is thin in Asia: Seoul really has hundreds of escape rooms, for example. The directory only has venues, not games. A game page appears once someone logs a room there, so there is no public game page on the live site yet. That is also why today's Escape of the Day has no "inspired by" room; the theme appears once the directory has games.

OpenStreetMap was not imported. `overpass-api.de` and two mirrors reset every connection from the build machine, so that importer is still a stub. The official Hugging Face copy of the Foursquare data was also unreachable from the build machine, so the importer read the identical release from a public mirror (Source Cooperative).

## Plan status

Checked against the code on `main`. Workstream numbers are from `docs/PHASE2_PLAN.md`.

**Done**
- Foundation (1, 2, 27): contracts, Postgres schema and migrations (run on every deploy), and the Railway deploy with health checks. The server keeps serving the static pages and the demo if the database is down.
- Accounts (3, 4): Google sign-in (scopes `openid email profile` only), sessions in Postgres, the name and @handle step, your logs, the JSON data download, and account deletion from `/settings` (tags become plain names, as `/privacy` promises). There is a test-only login that tests prove is off outside test mode.
- Directory (5, 6, 8): search (fuzzy), nearby, matching, venue, game and city pages, user-added venues and games, the Foursquare import, and de-duplication.
- Voice (10, 11): transcription with spending caps (audio is kept in memory only and wiped), and extraction with venue and game hints.
- Phone app (12, 13, 14, 15, 36): the device redirect with "View on desktop", the add-to-home-screen manifest starting at `/m`, recording with an IndexedDB queue that retries failed uploads, the matcher (pick or create), the confirm form, crew chips ordered by how often you play together, and the rooms table with the "with / without" filter.
- Public pages (16, 17, 18, 19): game, venue and city pages, reviews by @handle (never email), spoilers hidden until revealed, aggregates that leave copied scores out, a report button, source attribution, and the landing page linking `/about`, `/privacy` and `/terms`.
- 3D room (20, 37): it now runs on your own data, with an empty-board note, new rooms flying in, crew stickers, the Crew board sort and the "#1 teammate" wrap card.
- Escape of the Day (21, 22, 23): Wordle-style, the same puzzle for everyone, hints, a share grid, streaks stored against the server's record of your day, and a friends leaderboard. The door no longer blocks entry.
- Social (31, 32, 33, 35): friends, invite links, a QR code, the inbox and notifications, shared visits with an edit history, per-friend auto-accept, and personal reviews with copied scores flagged.
- Tests and docs (29, 30, 38): the morning-test end-to-end spec on laptop and phone, the permission test suite, the privacy-promise tests, the README, `docs/RUNBOOK.md` and `DECISIONS.md`.
- Phase 1 migration (28): the script is written and tested, but it hasn't been run (see below).

**Partly done**
- Photos (24): upload, storage, permissions and display all work, and photos show on the phone's review detail and on public reviews. However, no screen has an "add photo" button yet: the upload component exists but isn't mounted in the phone or desktop flow.
- Claims and merging (34): claiming guest names works in the app. The "Looks like Mia already logged this, join her visit?" step only exists in the API. No screen offers it yet, so two people logging the same room separately end up with two visits.
- Moderation (25): reports, hiding and unhiding work through the API, and admins come from `ADMIN_EMAILS` or a database flag. There is no admin screen (the plan's cut list allowed this); `docs/RUNBOOK.md` shows how to do it from the browser console.
- SEO (26): titles, descriptions, canonical links, Open Graph tags, `robots.txt` and the sitemap are done. Every page shares one static Open Graph image; there are no per-page images.
- Google place-ID linker (9): built and tested, but never run, because there is no `GOOGLE_MAPS_API_KEY`.

**Not done**
- OpenStreetMap importer (7): the source was unreachable (allowed by the cut order).
- Saved crews such as "Me + Mia" (part of 37): not built. The frequency-ordered friend chips cover the common case.
- Before-launch items, as planned: Postgres backups, error tracking, an uptime check, email or push notifications, an admin merge tool for duplicate games, and the "Want to play" button.

The automated checks on the commit that carries this report all pass: `npm run check` (typecheck, lint, and 1,255 Vitest tests in 100 files). The full Playwright suite passes too: 28 passed and 6 skipped by design (desktop-only or phone-only specs). That includes the morning test on laptop and phone, the static pages and the privacy promises.

## What you need to do by hand

1. **Let your girlfriend sign in.** The Google consent screen is still in Testing mode, so only listed test users can sign in. In Google Cloud (project `myescapes`, Google Auth Platform, Audience), add her Google address as a test user before you send the invite. The alternative is to publish the app: the scopes are non-sensitive, so it shouldn't need Google's review, but Google may want a domain you can verify, so publishing is easier once you have a custom domain.
2. **Sign in once with Google on the laptop** to confirm the real sign-in works. Pick your display name and @handle; that name and handle are what public pages show. You should land in an empty 3D room.
3. **Log one room from your phone** with a short voice note. This is the first real OpenAI transcription. Then reload the laptop and check that the polaroid pins itself and that the game's public page shows your review. If something fails, the phone keeps the recording and offers typing.
4. **Send the invite.** In `/settings` on either device, make an invite link (optionally with the guest name you've used for her) and text it to her. When she opens it and signs in, you become friends, and she can claim the visits logged under that guest name. Tag her on a new room: it waits in her inbox until she taps "Add to my room" (or lands straight away if she turns on auto-accept for you), then it shows in both rooms. Her name isn't recorded anywhere, so use whatever name you like.
5. **Optional: make yourself an admin.** Add `ADMIN_EMAILS` with your Google address to the app service's Railway variables. I didn't set it, since I don't write Railway variables. Without it nobody is an admin.
6. **Optional: Google Maps links.** Set a hard monthly cap in Google Cloud, then run the place-ID linker from your machine with `GOOGLE_MAPS_API_KEY` in your shell (see the runbook). It stores only Google place ids.
7. **Optional: Phase 1 rooms.** If you have real Phase 1 rooms in a local `.data/store.json`, run `npm run migrate:phase1 -- --email <your address>` after signing in once (see the runbook). The 12 sample rooms are invented and are not imported.
8. **Before public launch:** turn on Railway Postgres backups and add an uptime check on `/health`.

## Known gaps worth knowing about

- Reloading a newer directory seed doesn't remove a venue that the new seed merged into another one, and imported venues aren't de-duplicated against venues people add by hand.
- If OpenAI measures a recording as longer than the server reserved, the extra seconds aren't counted against the cap. The gap is small, because the reservation has a floor based on file size.
- Playwright leaves a temporary data folder in `/tmp` after each run (`playwright.config.ts` never removes it), and earlier runs left several on the build machine. They don't affect the site.
