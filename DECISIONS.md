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
