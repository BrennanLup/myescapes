# Phase 3 plan

Requested by Brennan on 2026-10-28: build all of Phase 3 within 24 hours, autonomously, then verify,
find improvements and implement them. This file is the brief every Phase 3 worker reads. Decisions
taken without asking are listed at the end; add to that list as you go.

## Ownership (other work happening at the same time)

Two other efforts are landing on `main` in parallel. Phase 3 workers must not edit their files:

- **Room visuals** (branch `claude/project-thread-b5n80v`): `src/world/lighting/**`,
  `src/world/materials/**`, `src/world/room/**`, `src/world/props/living/**`,
  `src/world/props/desk/**`, `public/assets/**`, `CREDITS.md`.
- **Room database and public reviews** (branch `claude/project-thread-btfk4r`): Rooms to try picker
  (`src/world/wishlist/**`, `server/routes/wishlist.ts`, wishlist functions in `server/db/dataset.ts`),
  Foursquare import (`scripts/import/foursquare/**`, `seed/directory/**`), the venue crawler
  (`server/enrich/**`), the public `/reviews` feed page and the spoiler filter on `/reviews` and game
  pages. They are also building a reusable directory picker (planned at `src/ui/roompicker/`).

If you truly need a change in one of those files, keep it to a few lines and mention it in your
summary so the integrator can resolve it.

`src/world/World.tsx` is shared: add one mount line per feature, nothing else.

## Workstreams

### A. Review form (ideas 1, 2, and the review half of 3)
Files: `src/ui/confirm/**`, `src/ui/review/**`, `src/mobile/log/confirm.tsx`, `src/mobile/log/form.ts`,
`src/ui/photos/**`, related server routes only if needed (`server/routes/photos*.ts`, `reviews*.ts`).
- Every question of the review/confirm form stays visible while typing: one scrolling form with all
  sections, no collapsing to the focused block, no step wizard. On phones the on-screen keyboard
  must not hide the rest (scroll the focused field into view, keep the others in the flow).
- Add photos while writing a review, on desktop and phone: an "Add photos" control in the form, using
  the existing upload API and `src/ui/photos` component (resize client-side, show thumbnails, remove,
  upload progress, retry, limits). Photos chosen before the visit exists are queued and uploaded right
  after save. Also allow adding photos to an existing visit from the review overlay in the 3D room
  and the phone's room detail.
- Picking the room in the form searches our directory (games and venues) as you type, nearest first,
  with "add a new room" when nothing matches. Use the existing directory search API. If
  `src/ui/roompicker/` exists on `main`, use it; otherwise build the picker inside `src/ui/confirm/`
  so it can be swapped later.

### B. Your character, camera modes and outfits (idea 6)
Files: `src/player/**`, new `src/world/avatars/**`, new `src/ui/wardrobe/**`, new server route
`server/routes/avatar.ts`, a schema migration.
- A stylized character built from three.js primitives (no external model needed): head, body, arms,
  legs, simple walk/idle animation driven by movement speed. Customisable: skin tone, hair style and
  colour, top, bottom, shoes, hat, accessory. `src/world/avatars/Character.tsx` takes an `Outfit`
  value so the same component draws other players (workstream C).
- Camera modes: first person (today) and third person (camera behind and above the character, smooth
  follow, pulls in when a wall is in the way, mouse/touch orbits). Toggle with `V`, a HUD button, and
  a button on phones. Interaction (reticle, reach) must keep working in both modes. Remember the
  choice per device.
- Wardrobe: an overlay to change your look, saved to your account (`users.outfit` JSON or an
  `avatars` table) via `GET/PUT /api/me/avatar`. Groundwork for outfit purchases with **no real
  payments**: items have a `price` in in-game "keys" earned by logging rooms and finishing Escape of
  the Day; some items are locked until bought with keys; a catalogue in code
  (`src/world/avatars/catalog.ts`) and server-side validation that you own what you wear. No payment
  provider, no real money.

### C. Multiplayer rooms and visiting a friend's home (idea 4)
Files: new `server/realtime/**`, `server/routes/homes.ts`, new `src/net/**`, new
`src/world/avatars/RemotePlayers.tsx`, new `src/social/visit/**`.
- Realtime server on the existing Fastify app using `@fastify/websocket` (already installed), at
  `/api/realtime`. Authenticate with the session cookie. A "home" is a user's room; each socket joins
  one home. Only the owner and their accepted friends may join a home; signed-out demo visitors get no
  socket. Messages are JSON validated with zod: join, leave, state (position, yaw, pitch, camera mode,
  animation, outfit) at up to 10 Hz, emote, short chat (length-limited, rate-limited). Server
  broadcasts to the others in that home, drops idle sockets, caps players per home (e.g. 12), and
  works with a single Railway instance (in-memory hub; note in DECISIONS.md that scaling out needs
  a shared pub/sub).
- Visiting: `GET /api/homes/:handle` returns that user's room data (their visits, board, wishlist) as
  the same shape the 3D room already renders, read-only, friends only. A "Visit a friend" list in the
  HUD (and in `/settings` friends list) opens `/home/:handle`, which renders the friend's room with
  their data, read-only (no editing their board), with a "Back to my room" button. Presence: "Mia is
  in your room" toast, a small list of who is here, friend list shows who is online.
- Client: `src/net/` holds a reconnecting socket client with interpolation of remote players (buffer
  ~100 ms, lerp position, slerp yaw). Remote players are drawn with workstream B's `Character` and a
  name tag (@handle). Chat bubble above the head; emotes (wave, cheer, dance). Works on phones.
- Tests: server hub unit tests (auth, friends-only, caps, rate limits, validation), client
  interpolation tests, and an e2e with two signed-in test users in two browser contexts seeing each
  other.

### D. Escape of the Day as a playable room (idea 5)
Files: new `src/daily/room/**`, `src/daily/ui/**`, `src/gate/**` as needed, `server/routes/daily*.ts`.
- Today's Escape of the Day becomes a small 3D puzzle room you walk around in (same player controller
  and camera modes). The daily engine's challenges become physical props: a padlock with a code, a
  cipher on a wall, a sequence of lights or symbols, a hidden key under an object, and so on, mapped
  from the existing challenge types in `src/daily/engine/challenges.ts`. Hints, timer, streaks and
  the spoiler-free share stay as they are, and the result is recorded through the existing daily API
  so leaderboards keep working.
- Finishing opens the exit door; walking through it takes you into your own room (`/`), with a short
  celebration. Signed-out players finish into the demo room with a sign-in prompt.
- The 2D `/daily` page stays as a fallback (low-end devices, accessibility) with a "Play in 3D"
  button, and the door in your room still leads to today's room.
- Keep it light on phones (simple geometry, reuse the shared materials API without editing it).

## Rules for every worker

- Read `README.md`, `DECISIONS.md`, `src/contracts/README.md` and the README of every folder you touch.
- Keep `npm run check` green (typecheck, lint, vitest). Write tests next to the code.
- Do not run Playwright in parallel with another worker; the integrator runs e2e.
- Never commit secrets. No real payments. Respect the privacy promises in `public/privacy.html`.
- Add each decision you make without asking to the list below, with one line of why.

## Decisions taken without asking

- Character is procedural (primitives), not a downloaded model: no licence or download risk, small,
  easy to recolour for outfits.
- Outfit purchases use an in-game currency ("keys") earned in the app. No payment provider until
  Brennan chooses one.
- Realtime uses WebSockets on the same Railway service with an in-memory hub; one instance is enough
  for now.
- Visiting a home is friends-only, read-only.
- (A) The review form uses the shared `src/ui/roompicker` from `main` (merged into the workstream
  branch), wrapped in `src/ui/confirm/RoomSearch.tsx` with "Near me" and an exact-match "Is it ...?"
  suggestion, so both forms share one picker.
- (A) "Near me" is opt-in per press, rounded to about 1 km, sent only as search parameters and never
  stored; only on/off is remembered on the device. `public/privacy.html` now says so: location was
  not covered by the policy before.
- (A) A room picked from the directory in the 3D room's form is saved against that game: the form
  sends the game id as `room.id` and `saveEntryForUser` (`server/db/dataset.ts`, a few lines, not the
  wishlist functions) uses it, so the brand-vs-venue-name mismatch no longer creates duplicate venues.
- (A) The phone keeps its "Which room was it?" step before the form (it auto-matches the voice note
  and the existing e2e suites rely on it); the form itself gets the search-as-you-type room search,
  and a venue or "Add" opens the matcher's venue or new-venue screen.
- (A) Photos picked before saving are resized at once (thumbnails right away), held under a draft
  key, then moved onto the saved visit and uploaded one at a time; a failed one stays on the visit so
  Retry works from the review overlay or the phone's room page. Uploads use XMLHttpRequest for real
  progress. Removing a photo that already uploaded deletes it on the server.
- (A) While a phone keyboard is open the phone form's Save bar drops into the page flow instead of
  floating over the field, and the focused field is scrolled to the middle of what is still visible.
- (D) The puzzle room is its own page, `/daily/room`, with its own Canvas, not a mode of the main room:
  it stays out of the main room's bundle and state, and a full page swap is the simplest clean exit.
- (D) It is built inside the main room's 20 x 16 m player bounds with its own wall colliders, because
  the player controller always clamps to those bounds and `src/player` is not ours to change.
- (D) Play logic is shared with the 2D game through `useDailyPlay`; no server or contract changes,
  so the result, streaks and leaderboards go through the existing daily API.
- (D) Props talk to the page through the generic `interact` event with `daily:*` ids (no new event
  types in the orchestrator's contract); an open panel reuses overlay kind `gate` to freeze controls.
- (D) Search days keep the 2D rules (one look per missing target per round, rounds are guesses) so
  the share grid and scoring mean the same in 2D and 3D.
- (D) A failed day still opens the exit door (with the answer shown), so nobody is stuck in the room.
- (D) The exit goes to `/?autostart=1` (signed out: `/?demo=1&autostart=1`) to skip the main room's
  "Enter" button, arriving just inside your own daily door; phones follow the usual `/` rule and land
  on `/m` (signed out: its sign-in screen), since forcing the 3D room would change their saved
  view preference.
- (D) Small shared edits: one route line in `src/router.tsx`, one `<DailyWelcome />` mount in
  `src/App.tsx` (the "welcome home" toast), and a "Play in 3D" link in the door overlay and on `/daily`.
- (C server) Homes are addressed by @handle; strangers get 403 and a block in either direction 404, so a block never reveals the home exists.
- (C server) Poses are coalesced server-side and broadcast at 10 Hz per home with a server timestamp: one clock for client interpolation and bounded fan-out.
- (C server) A visitor sees only visits whose owner review they could already see, no transcripts, crew by public name only (guests become "Guest"), puzzle text and spoiler comments hidden unless `?spoilers=1`: keeps the existing privacy rules intact.
- (C server) Guests' access is re-checked every 60 s instead of hooking the friends routes: unfriend/block takes effect within a minute without editing workstream 31's files.
- (C server) Transport pings (20 s) decide dead sockets and a 10-minute silence decides idle ones, because background tabs throttle timers but still answer pings.
- (C server) Outfits are relayed as a small bounded record until workstream B's `Outfit` schema exists; the integrator can swap it in.
- (C server) The privacy policy now says friends can visit your room and that presence/position/chat are shared live and not stored: the old "your room: you only" line would have become untrue.
- (C server) Route contract entries use `ws: 303` (Phase 3, workstream C), since `RouteSpec.ws` is a number.
- (B) Keys are never stored as a balance: the server counts them from your visits (owner or
  accepted, 10 each) and solved Escape of the Day results (5 each), plus 20 welcome keys, minus
  what you spent. Nothing to tamper with or keep in sync; deleting a visit later can't take back
  what you bought (the balance floors at 0).
- (B) Outfits live in a new `avatars` table (one row per user) and purchases in `avatar_purchases`
  (migration `0002_avatars`), not `users.outfit`: Better Auth owns `users`, and purchases need their
  own rows anyway. Integrator: if another branch also adds a `0002_*` migration, regenerate one of them.
- (B) The avatar routes are specified in a new `src/contracts/avatar.ts` (same `RouteSpec` shape,
  called with `callApi`) instead of editing `routes.ts`, so Phase 3 teams don't collide in one file.
  Registered as one line in `server/routes/registry.ts` (ws 302).
- (B) Purchases are serialised per user with a transaction-scoped advisory lock, so two buys at
  once can't overspend. A purchase can also wear the new look in the same transaction.
- (B) First person stays the default camera (today's behaviour and every existing e2e test); the
  choice is per device in localStorage. The controls hint gained a "V" line.
- (B) Third person is over the shoulder (3.1 m back, 0.3 m up, 0.6 m right) so your head never
  covers the reticle; the interaction ray starts at the point on the view ray nearest your eyes,
  so reach is measured from the character, not the camera (2-line change in
  `src/interaction/InteractionSystem.tsx`).
- (B) Your body turns towards where you walk in third person and stays put while you only look
  around (mouse/touch orbits the camera around you), the usual third-person feel.
- (B) People who never opened the wardrobe get a deterministic free starter look from their user
  id, so a room full of friends doesn't look identical (also what remote players show).
- (B) The character HUD (camera toggle and wardrobe) is its own bottom-right cluster mounted in
  `App.tsx`, not new buttons in the top HUD row, which is already full on a 360 px phone.
- (B) The wardrobe preview is a second small canvas (low-power, lower DPR on Low quality) rather
  than re-using the room's camera; without WebGL it falls back to a text description.
- (B) Signed-out demo visitors can change and keep free looks on their device, but cannot earn or
  spend keys (the wardrobe asks them to sign in).
- (B) The account export (`/api/me/export`) now includes your saved look and purchases (an
  optional `avatar` field), to keep the privacy promise that the download holds all your data.
- (C client) Moving between rooms (`/` and `/home/:handle`) is a full page load: the 3D room boots once per page with the right data, socket home and read-only rules, the same clean swap D uses for `/daily/room`.
- (C client) Read-only is enforced in the store (`visiting`: `addEntry`, `setWishlist` and the record/confirm/wish list overlays refuse) plus small UI hides (record and wish list buttons, photo uploads), so a friend's wish list can never overwrite yours. A few lines in `src/state/store.ts`, `src/ui/shell/Hud.tsx`, `src/ui/review/ReviewOverlay.tsx`.
- (C client) The store got a pluggable data loader (`setDataLoader`) so the existing loading screen, retry and quiet refresh all work for a friend's room unchanged.
- (C client) Remote players are drawn 100 ms in the past from server-stamped poses (clock from ping/pong); poses after a pause are anchored so nobody glides, teleports snap, extrapolation stops at 150 ms: smooth at 10 Hz without rubber-banding.
- (C client) Name tags and chat bubbles are DOM (`Html`) over the canvas, not 3D text: crisp, any script, no font download; they fade with distance and are hidden behind the camera.
- (C client) The people UI is its own cluster (bottom left on desktop, round buttons on the right of phones) mounted in `App.tsx`, like B's character HUD: the top HUD row is full on a 360 px phone.
- (C client) Keys: `T`/`Enter` chat and `F` people, chosen to avoid WASD, `E`, `V` and `1`-`6`.
- (C client) Visiting needs a display name and @handle (the socket requires them): `/home/:handle` shows the onboarding step first instead of a room without people.
- (C client) "Back to my room" goes to `/?autostart=1`, so phones land on `/m` as `/` always sends them; visiting itself works on phones (the 3D room with touch controls).
- (C client) Others see your starter look until your wardrobe has loaded; looks from the network are repaired with `normalizeOutfit`, never trusted as-is.
- (C client) In a friend's room spoilers stay hidden unless you press the banner's Spoilers toggle (it reloads their room with `?spoilers=1`).
- (C client) `/home/*` pages are `noindex`, out of `robots.txt`, and their head never echoes the @handle.
- (QA fix, other) The `/daily` card sizes to its content (the footer takes the leftover height) and the start screen gets a short "How it works" (guesses, hints, scoring, streak) instead of a tall empty card; the compact door overlay in the 3D room skips it.
- (QA fix, other) Small key-hint chips (F, T, V) and the "Drag to turn" and chat captions use `text-ink` / `text-ink/80`: the pressed chip (white on white/15 over teal) measured 3.1:1; the others were 4.8-5.2:1, so they get headroom. White text on the teal and accent pills (3.9:1 and about 3:1) is an app-wide palette question and is left to Brennan.
- (QA fix, other) The 3D room's `<Canvas>` sits in a `CanvasBoundary` (`src/ui/shell`): a WebGL or scene failure shows "The room couldn't light up" with Reload and the light `/m` version, above the loader, instead of React unmounting the whole page.
- (QA fix, other) The smoke spec waits `SLOW` for the canvas and for the loader to leave: the one failure was a slow load right after the multiplayer spec on shared CPUs (it passed 3/3 alone), and the canvas is always in the DOM once the room page renders.
