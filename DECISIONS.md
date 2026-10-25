# Decisions

Defaults picked during the build when the brief left room.

## Architecture
- **Single repo, single process.** Vite + React + TypeScript client, Fastify server in `server/` serving `dist/` and `/api/*` on `process.env.PORT` (default 3000). The server runs TypeScript directly with `tsx`, so `npm start` needs only Node.
- **Contracts first.** `src/contracts/` holds every shared shape: data schemas (`types.ts`), HTTP API and typed client (`api.ts`), world layout and anchors (`scene.ts`), event bus (`events.ts`), colliders (`colliders.ts`), interactables (`interaction.ts`), material ids (`materials.ts`), style tokens (`style.ts`), assets (`assets.ts`), per-frame runtime state (`runtime.ts`).
- **Each workstream exports fixed component names** from its folder's `index.tsx`. `src/world/World.tsx` and `src/App.tsx` already import them, so workstreams never edit shared files.
- **State:** one Zustand store (`src/state/store.ts`) for reactive state, the event bus for one-shot signals, and `src/state/bridge.ts` to map UI events to overlay changes. Per-frame data (player pose, pin positions, fps, joystick) lives in the non-reactive `runtime` object.
- **Collision uses simple AABB colliders** (`colliders.ts`) instead of Rapier. The room is a box full of box-shaped furniture. Circle-vs-AABB in 2D is cheap, deterministic and testable, and it avoids a roughly 2 MB WASM physics engine.
- **Room size is 20 m x 16 m x 4 m.** From the centre that is 12.9 steps (0.75 m each) east/west and 10.2 steps north/south, after subtracting the player radius.
- **Layout:** the bulletin board is on the north wall (you face it at spawn), the wish-list chalkboard is on the east wall, the desk terminal is on the west wall, the gate door is on the south wall (behind spawn), the living area is centre-east, and the trophy shelf/calendar is on the west wall.
- **Geometry and textures are procedural** (low-poly primitives and canvas textures) to keep the initial load small and licences clean. Any CC0 file used is listed in CREDITS.md.
- **Wishlist `done` flag** added beyond the brief so items can be marked done.
- **API shape:** `GET /api/data` returns the whole dataset (rooms, reviews, wishlist, crew), `POST /api/entries` saves a room and its review together, and `PUT /api/wishlist` replaces the list. The data is small, so simple semantics win.
- **Test hooks:** `window.__ESCAPE__` exposes the store, the bus and a teleport helper for Playwright QA.
- **Versions:** React 19.2, R3F 9, drei 10, three 0.186, Vite 8, Tailwind 4, Zod 4, TypeScript 5.9 (typescript-eslint does not support TS 7 yet), ESLint 9, Vitest 5, and Playwright 1.63.0, pinned to match the preinstalled Chromium.

## Integration
- **Spawn moved from z=5.5 to z=3.5** (still facing north, gate door behind you) so the bulletin board, the hero of the room, reads bigger on arrival. The living-area path tests still pass.
- **Room textures tile at real-world scale.** The room shell uses world-planar UVs (0.5 UV units per metre), while the shared materials' default repeats assume 0..1 UVs, which made the floor look like a noisy carpet. The room now uses `getTiledMaterial` clones sized per surface (floor tile 2.5 m x 1.25 m = honey planks ~0.31 m wide). The plank texture draws the seams, so the separate groove mesh was dropped.
- **Lighter, warmer ceiling.** `LIGHT.hemiGround` is now `#b07a5e` (warm bounce off the floor) and the lighting rig reads it from the style contract. Beams use honey `woodLight` instead of `woodDark`. The board spot and the north LED spill were toned down so the top of the board isn't blown out.
- **Stacking order:** touch controls z 5 < reticle z 20 < HUD z 30 < overlays z 40-50 < toast z 60 < loading screen z 80. The HUD and the touch controls hide while an overlay is open.
- **One toast system:** the confirm screen's "Pinned to the board!" goes through the shell toast slot.
- **Draft-level flags are notes, not fields:** `extraction.fallback` shows as an info note at the top of the confirm screen; only `room.*` / `review.*` flags become "Check this" chips.
- **Audio waits for a real user activation** (`navigator.userActivation.hasBeenActive`). The automation autostart of the loading screen is not treated as a gesture, so headless runs don't log AudioContext warnings.
- **e2e isolation:** `playwright.config.ts` gives every run a fresh temp `DATA_DIR` and blanks the API/Sheet keys, so tests always run in mock + seed mode and never touch `.data/`. It does not reuse an already running server unless `E2E_REUSE_SERVER` is set.
- **Walkable from the exact centre (QA #4).** From (0, 0) you can walk at least 10 steps (7.5 m) north, south, east and west, and along the diagonals. The floor lamp moved off the z = 0 line to just behind the couch's north arm (`LAMPS.floorLamp` = [6.75, 1.75, 0.7]; the light follows because lighting reads `LAMPS`). The gate door now opens a right angle so the leaf stands against its hinge side, its doorway collider hugs the wall (0.12 m deep instead of 1 m), and a narrow `gate:door-leaf` box covers the open leaf off the centre line. Board, chalkboard, wrap-shelf and gate colliders moved into small pure `colliders.ts` files, so `src/player/reach.test.ts` registers every real collider and walks from the centre. North and south reach is 7.51 m (board and doorway slabs are 0.12 m deep), east/west 9.65 m.
- **Precompressed static assets (QA #3).** No compression dependency: `server/precompress.ts` (node:zlib) writes `.br` and `.gz` siblings after `vite build` and at server startup when missing or stale, and `@fastify/static` `preCompressed` serves them by `Accept-Encoding` with `Vary: accept-encoding`. Precompressing at build time lets brotli run at quality 11 once instead of on every request.

## Deploy fixes
- **Node floor is 20.19+ / 22.12+**, matching Vite 8's `engines`. `package.json` engines and the `npm start` preflight both enforce it, so an older Node fails with a clear message instead of a confusing build error.
- **Railway build command is just `npm run build`.** Railpack already runs `npm ci` in its install step, and running `npm ci` again in the build step can fail with `EBUSY` on the builder's `node_modules/.cache` mount.
