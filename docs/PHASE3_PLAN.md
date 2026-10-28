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
- (A, QA r1) An unset score shows an empty dashed track with "Tap to rate" over a see-through
  slider (`src/ui/confirm/ScoreSlider.tsx`, both forms): a thumb parked at 50 read as "already 50".
- (A, QA r1) Genre is optional on the desktop form too ("Not sure", saved as `other` because the 3D
  room's `Room` needs a genre): one rule on both forms, and it shouldn't block a review.
- (A, QA r1) Room search ranks the draft's city first via a new optional, soft `city` on
  `directorySearch` (+0.35 rank boost: wins ties, not much better names); ties ignore leading
  punctuation. A few lines in `src/contracts/routes.ts` and `server/routes/directory.queries.ts`,
  since a client-only rerank can't reach same-city rooms among thousands of tied "escape" names.
- (A, QA r1) Removing an uploaded photo gets a 5 s inline "Photo removed · Undo" (the DELETE waits)
  rather than a confirm dialog: one tap stays one tap, and a mis-tap is recoverable.
- (A, QA r1) Finished uploads are kept in the photo queue only while something shows them
  (`watchTarget`), instead of a fixed cap: the photos are on the server and every list refetches.
- (A, QA r1) A phone keyboard that shrinks the layout viewport counts as open when a text field has
  focus and the page is >120 px shorter than the tallest seen at that width (touch screens only).
- (A, QA r2) The desktop form shows a field's error only after the field is left or Save is pressed; Save is `aria-disabled` (looks disabled, still clickable) so pressing it can reveal every error and jump to the first, as the phone's "Fix the highlighted fields first" does.
- (A, QA r2) The four features get "Not sure" on the desktop form and are no longer required; Not sure is saved as `null`, so `Review.visibleTimer/multiRoom/flashlights/liveActors` became nullable (`src/contracts/types.ts`) and the 3D room's dataset stops turning a phone's unknown into "no" (4 lines in `server/db/dataset.ts`, outside the wishlist functions). Saving it as `false` (like genre's `other`) would have written a wrong "no" to the visit that the phone and public pages then show.
- (A, QA r2) "Escaped?" stays a required yes/no on the desktop (the phone keeps Not sure): the board label, the stamp, the wrap stats and crew tallies all read it as a boolean, and making it nullable reaches far past the form.
- (A, QA r2) One shared `Lightbox` in `src/ui/photos` for every photo thumbnail (both forms, review overlay, phone room page, the review polaroid) instead of a library: small, no dependency, swipe/arrows/Esc. Overlays with their own capture-phase key listeners check `isLightboxOpen()` and stand aside.
- (A, QA r2) In read views (review overlay, phone room page) the × on saved photos sits behind an "Edit photos" toggle; uploads in progress or failed keep their × so they can still be cancelled or dropped. The forms and the phone's "Saved!" screen keep the × visible, since you are editing there.
- (QA1 character) The realtime hub never relays a look a client sends: it loads your saved look (`outfitForUser`, through `HubAccess.outfitFor`) at join and treats an `outfit` message as "reload mine", because ownership is only checked when saving and a modified client could otherwise show priced items to everyone.
- (QA1 character) Third person narrows the look pitch to 55 degrees down / 50 up, and the camera's orbit stops before it would drop 0.3 m below the head or reach the ceiling margin (it tilts from there): no worm's-eye view, no camera pulled into the head. Your character hides below 0.9 m camera distance.
- (QA1 character) Phones use a centred third-person rig (no side offset, 0.4 m further back, a little higher) so the character stands mid-screen, clear of the joystick; folding emotes into the people sheet was left to the people UI's owners.
- (QA1 character) Closing the wardrobe with an unsaved look asks "Discard this look?" (Keep trying on / Discard), the same pattern as the review form, rather than silently keeping a draft.
- (QA1 character) Other players cast real shadows only on High quality with a mouse; elsewhere they get a one-quad blob shadow. Past 8 m their face details are skipped. Merging each outfit into one mesh was not done: the animated joints make it a large change for a smaller gain than these two.
- (C fix r1) A block between two guests of a shared friend's home hides them from each other (filtered broadcasts, joined lists and `presence.visitors`) rather than refusing the second join: refusing would tell the blocked person the other is there, and the host keeps both guests.
- (C fix r1) An owner's "Ask to leave" keeps that guest out of the home for 10 minutes (any tab), forgotten when the home empties: long enough to stop a reload straight back in, short enough not to need an "unkick" button.
- (C fix r1) Idle means no activity (pings don't count); an idle-closed tab pauses ("Away" chip) and reconnects on the next key, tap or tab switch instead of reconnecting at once, so AFK visitors free their place.
- (C fix r1) Chat allows 8 lines per 10 s (was 5): friends send "hi" "hey" "look!" in a row; a refused line comes back to the chat box with chat-specific wording.
- (C fix r1) Remote players are cleared the moment the socket is not open (a small "Reconnecting..." chip shows), and `joined` refills them: better an empty room for a second than frozen statues.
- (C fix r1) Join errors `unavailable` (and `rate_limited`) are retried with backoff (2-20 s); only answers that won't change stop the client.
- (C fix r1) A new `friends_changed` server message makes the client refetch presence when a friendship changes, instead of waiting for the 60 s poll.
- (C fix r1) Sounds reuse existing cues through the `sfx` bus (sound toggle respected): arrival `string`, chat from someone else `click`, your emote `pin`. Wardrobe and photo sounds are left to their owners.
- (C fix r1) Remote characters get a faint emissive of their own colours (0.2 on Low, 0.1 otherwise) on shared, cached material copies, so dark looks read under the warm lamps; your own character is unchanged.
- (C fix r1) Visitors spawn 1.3 m left of the usual spot, and a remote player whose spot your camera is inside is hidden: the "brown screen" was the host standing on the shared spawn.
- (C fix r1) Small shared edits: `src/ui/shell/Hud.tsx` (title "Robin's escapes" in a friend's room; phone hint and toasts below the visit banner), `src/ui/shell/shellStore.ts` (`hudPanelOpen`), `src/interaction/Reticle.tsx` (the look pill hides after the first pointer lock and while a HUD panel is open).
- (D fix) The puzzle room now has the camera modes and your character (`LocalAvatar`), with only the camera half of the character HUD: the wardrobe stays in your own room, since this page is a short visit and would otherwise pull the wardrobe overlay and its preview canvas into its bundle.
- (D fix) Phones that finish the puzzle room go straight to `/m?from=daily` (the router's own phone rule for `/`) and see the same "Welcome home" card there; the card and the note moved to store-free files (`WelcomeCard.tsx`, `welcomeNote.ts`) so the phone bundle stays free of the 3D room's store. Leaving early on a phone goes to plain `/m`. Two lines in `src/mobile/shell/index.tsx` mount it.
- (D fix) `PerfMonitor` runs in the puzzle room too; its "switched quality" message is forwarded to the room's own toast, because that page doesn't draw the shell's toast.
- (QA fix, other) The `/daily` card sizes to its content (the footer takes the leftover height) and the start screen gets a short "How it works" (guesses, hints, scoring, streak) instead of a tall empty card; the compact door overlay in the 3D room skips it.
- (QA fix, other) Small key-hint chips (F, T, V) and the "Drag to turn" and chat captions use `text-ink` / `text-ink/80`: the pressed chip (white on white/15 over teal) measured 3.1:1; the others were 4.8-5.2:1, so they get headroom. White text on the teal and accent pills (3.9:1 and about 3:1) is an app-wide palette question and is left to Brennan.
- (QA fix, other) The 3D room's `<Canvas>` sits in a `CanvasBoundary` (`src/ui/shell`): a WebGL or scene failure shows "The room couldn't light up" with Reload and the light `/m` version, above the loader, instead of React unmounting the whole page.
- (Integration, QA r1) The puzzle room's `<Canvas>` (`/daily/room`) is wrapped in the same `CanvasBoundary`, imported straight from its file: one line, and that page could otherwise go blank on a WebGL failure too.
- (QA fix, other) The smoke spec waits `SLOW` for the canvas and for the loader to leave: the one failure was a slow load right after the multiplayer spec on shared CPUs (it passed 3/3 alone), and the canvas is always in the DOM once the room page renders.
- (QA2 character) Characters are merged at runtime, not hand-written as merged geometry: `bakeCharacter` turns the readable JSX parts into one vertex-coloured mesh per joint and finish (matte, satin, metal) after each new look, so outfits stay easy to edit and each character costs ~12 draws instead of ~42. Glows keep their own material; roughness/metalness are rounded to the three finishes (the eye shine and gold trims barely change).
- (QA2 character) Far-away detail is a second baked head without the face details rather than hidden groups: one draw cheaper far away, no extra draws near.
- (QA2 character) The phone camera looks about 10 degrees below your look pitch from 1.45 m above the head (3.6 m back) instead of a "default pitch" you would have to fight: the character sits in the lower third whatever you do, the reticle and interaction ray follow the camera, and the existing e2e aiming still hits (the tilt and the height offset roughly cancel at a few metres).
- (QA2 character) Your character fades to 40% when the centre view ray or the line to another player passes through it (an upright capsule test, eased at 10/s), not whenever someone is anywhere behind you: it stays solid most of the time.
- (QA2 character) On touch in third person the Tap button moves bottom right, 12 px above the highest round button on the right (measured from the DOM, so it follows the people dock in portrait and landscape), with its label above; first person keeps it under the reticle. A few lines in `src/interaction/Reticle.tsx`.
- (QA2 character) The puzzle room's shell and static furniture are merged per material by a small `MergeStatic` wrapper (`src/daily/room`), measured 38 draws on the phone profile after stepping inside (the finding measured 95). Hiding spots and anything interactable stay separate, so interaction is unchanged.
- (C fix r2) "Ask to leave" cool-downs live on the hub (owner -> guest -> until), not on the in-memory home, so a guest can't walk back in once the owner leaves; the old r1 "forgotten when the home empties" rule is replaced. Expired ones are pruned on the 20 s heartbeat; a restart still forgets them (single instance, in memory).
- (C fix r2) Being removed from a friend's room (unfriend, block) or asked to leave swaps the room for the visit error page in place ("You can no longer visit Robin's room" / "Robin asked you to leave", focus on the heading) and drops their data, rather than redirecting after a toast: no timer to miss, it reads on screen readers, and Back to my room / Friends and invites are right there. A refused rejoin while inside (`not_friends`, `not_found`, `forbidden`) does the same; a full room (`home_full`) stays open to look around. `not_found` (a block) gets the "no longer visit" wording too, the same as `removed`, so a block reads like an unfriend.
- (C fix r2) The phone home (`/m`) shows a "Friends online" row (hidden when nobody is online) under the log button, from the same `GET /api/presence` polling as `/settings`: at-home friends first, at most 4 rows, a 44 px **Visit** button to `/home/:handle`, and **Join** (the existing "View on desktop") for a friend who is in your room. Two lines in `src/mobile/shell/index.tsx` mount it.
- (D fix r2) Arriving home from the puzzle room puts you 3.3 m inside the daily door (was 1.5 m), so the third-person camera keeps its full 3.1 m instead of filling a third of the frame with the door; the main room's automatic first "How to play" card is skipped on that arrival (a flag the exit sets, closed by `DailyWelcome`, no `Hud.tsx` edit). The help button still opens it.
- (D fix r2) The puzzle room spawns 2.6 m from the south wall (was 1.4 m) and passes its own third-person rigs (`rigs` prop on `PlayerController`, a few lines in `src/player`): phones 2.5 m back, 0.8 m up (looks over your head, so you stand low in the frame); desktop 2.4 m back. Fading the character up close was not needed once the camera keeps its distance.
- (D fix r2) The pendant lamp moved off the room's centre line (x -1.7) and hangs 0.25 m higher, so it never hides the cipher banner above the door. (It lives in `Shell.tsx`, not `Furniture.tsx`.)
- (Integration, QA r2) The puzzle room's own rigs (`ROOM_RIGS`) keep `tilt: 0`: the new phone rig's downward tilt was tuned for the bigger main room, while the puzzle room's 2.5 m / 0.8 m phone rig was tuned by screenshot without it; `PlayerController` uses the room's rig for both the tilt and the orbit.
- (QA r2, other; superseded at integration) The phone home (`/m`) shows a "Friends online" card (`src/mobile/shell/friends.tsx`) only when at least one friend with a handle is online: friends in their own room first, at most three, "See all" to `/settings#friends`, and "Visit in 3D" to `/home/:handle` (the same full-page visit as settings). An empty card on every visit would be noise.
- (QA r2, other) The phone's "Saved!" screen shows "+10 keys" with your balance (`src/mobile/log/keys.tsx`). It reads only the balance from `GET /api/me/avatar` with its own small schema, because the wardrobe's route contract imports the catalogue under `src/world`, which the phone bundle must not reach; a test keeps its 10 equal to `KEY_REWARDS.roomLogged`.
- (QA r2, other) "Open the wardrobe in my 3D room" on the Saved screen does what "View on desktop" does (remember the 3D room on this phone, open `/?desktop=1`) and says the wardrobe is behind the hanger button: there is no one-off way into your own 3D room on a phone, and a `?wardrobe=1` deep link would mean editing the character team's `App.tsx`/wardrobe files.
- (Integration, QA r2) Two branches built a "Friends online" card for `/m`; only the multiplayer one (`src/social/visit/FriendsOnline.tsx`) is kept, because it also has **Join** for a friend already in your room and an e2e spec; the duplicate `src/mobile/shell/friends.tsx` was dropped so the home shows one card.
- (QA r3, multiplayer) A friend's Wrapped stays closed while visiting (trophy button hidden, the shelf says "Robin's trophy shelf (look only)", pressing it says why): every card speaks to its owner ("Your year", "You stepped into"), so retitling only the first card would still mislead; hiding it matches the hidden record and wish list buttons.
- (QA r3, multiplayer) "Visit a friend" leaves out friends already listed under "Here now" (and says "All your friends are here with you." when that empties it); "Here with you" stays only for a friend on the way in who is not in the list yet.
- (QA r3, multiplayer) A friend at home reads "In their room", and "In their room with 2 friends" only when others are there (the shared `presenceText`, same wording as `/settings` and `/m`), instead of "· 1 in their room".
- (QA r3, multiplayer) Emotes get a chip by the dock ("You waved · Mia sees it" / "nobody else is here to see it") rather than a camera peek: no camera code from the character team is touched, and it also answers "did anyone see it". In third person it shows only when alone, since you see your character.
- (QA r3, multiplayer) A flood close reports `disconnected`, not a new `flood` reason: the contract's reason list stays the same for old clients, and the client already reconnects on 4008.
- (QA r3, multiplayer) An owner's @handle change mid-visit: open homes refresh handle and owner on each join, and a join by a stale handle resolves through an open home that still goes by it (looked up by owner id), so a guest's reconnect keeps working; once the home is empty the old handle is not found, like any other renamed address. The visit page follows the new handle in its URL and data loader.
- (QA r3, multiplayer) The desktop toast sits below the sort chips (112 px from the top) so a long one covers neither the visit banner nor a chip; links and the Visit button in the people panel use a darker teal (#1f6b67, 5.9:1 on the panel) instead of the 3.45:1 brand teal.
