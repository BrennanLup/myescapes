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
