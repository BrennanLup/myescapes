# My Escapes

A cozy first-person 3D room that holds every escape room your crew has done.

You walk around a warm, low-poly gaming bedroom. The north wall has a cork board with a polaroid for each escape room, linked by red string. Click a photo to read its review. To log a new room, record a voice note at the desk terminal. It is turned into a structured review (by Claude, or by a built-in mock extractor when there is no API key), which you check and fix on an editable form before it gets pinned to the board. A small daily memory puzzle on the door greets you when you arrive. There is also a wish-list chalkboard and a "Year in Escape Rooms" wrap.

It works with no configuration at all: it ships with 12 sample rooms and stores new entries locally.

## Run it

You only need [Node.js](https://nodejs.org/) 22.12+ (or 20.19+), the range Vite 8 supports. Check with `node -v`.

```sh
git clone https://github.com/BrennanLup/myescapes && cd myescapes && npm start
```

`npm start` installs dependencies (first run only), builds the app, starts the server and opens <http://localhost:3000>. Press Ctrl+C to stop it.

- Another port: `PORT=3001 npm start`
- Don't open a browser: `NO_OPEN=1 npm start`
- Skip the build when nothing changed: `npm start -- --no-build`

## Controls

| | Desktop | Phone / tablet |
| --- | --- | --- |
| Walk | `W` `A` `S` `D` (or arrow keys), `Shift` to run | Left-thumb joystick |
| Look | Click the room to lock the mouse, then move it. `Esc` releases it | Drag anywhere |
| Interact | Aim the centre dot at something and click or press `E` | Aim at it, then press the big **Tap** button (or tap the thing) |
| Sort the board | Keys `1`-`6`, the sort chips at the top right, or the tabs on the board itself | Sort button at the top right, or the tabs on the board |
| Close a panel | `Esc` or the × button | The × button |

The round buttons at the top right open the wish list, the year wrap, the voice recorder, settings (sensitivity, invert Y, quality, head bob), sound and the controls help.

## Features

- **The board**: one polaroid per room, grouped and sorted by city, brand, genre, date, rating or escape time. The red string re-ties itself when the sort changes. New entries fly in from the desk and pin themselves.
- **Reviews**: ratings (overall, puzzles, setting, storyline, difficulty, 1-100), crew, puzzles, tools, escape time, room features and a photo gallery. Flip between rooms with the arrows.
- **Voice logging**: record at the desk terminal (browser speech recognition where available), upload a `.txt` transcript, type, or use the sample transcript. The transcript goes to `/api/extract`, and the confirm screen shows what was understood. Fields the extractor was unsure about are marked "Check this", and missing required fields are listed next to the save button with a "Show me" link.
- **Daily gate**: a short memory puzzle (combination lock, cipher, sequence, hidden-object search or "which room was this?") inspired by a puzzle from one of your past rooms. It appears once a day.
- **Wish list**: a chalkboard of rooms to try next. Add, reorder, mark done, undo.
- **Year in Escape Rooms**: a story-style wrap with your stats, best room, fastest escape, cities and favourite puzzle types.
- Synthesized ambient sound and effects, quality presets, and a layout that works from 390 px phones to large desktops.

## Configuration

Everything is optional. Copy `.env.example` to `.env` and fill in what you want. The server prints which features are real and which are mocked when it starts, and the HUD shows a "Demo mode" badge while anything is mocked.

| Variable | Without it | With it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Voice notes use the offline rule-based mock extractor. | Transcripts are turned into reviews by Claude, server-side. If a call fails, the app falls back to the mock extractor and the confirm screen says so. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | The Claude model used for extraction. |
| `DATABASE_URL` | An in-process Postgres (PGlite) stored in `DATA_DIR/pglite`. | Postgres (Railway). Migrations run on every start. |
| `OPENAI_API_KEY` | Voice recordings aren't transcribed server-side (type or use live captions). | Server-side transcription of recordings. |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | The OpenAI model used for transcription. |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `BETTER_AUTH_SECRET` | Google sign-in is off. | "Continue with Google". |
| `PUBLIC_URL` | Links (invites) use the request's host. | The public origin for absolute links, e.g. `https://bubbly-hope-production.up.railway.app`. |
| `CAP_TRANSCRIBE_SECONDS_PER_USER`, `CAP_EXTRACT_CALLS_PER_USER`, `CAP_TRANSCRIBE_SECONDS_GLOBAL`, `CAP_EXTRACT_CALLS_GLOBAL` | 1200 s, 30 calls, 21600 s, 1000 calls per UTC day. | Daily spending caps. |
| `PORT` | `3000` | Port the server listens on. |
| `DATA_DIR` | `.data/` in the repo (gitignored) | Where the local database and the signed-out demo's entries live. |

If the database can't be reached or migrated at startup, the server still starts: `/health`, the static pages and the signed-out demo keep working, database routes answer 503, and it retries every 30 seconds.

### Database

Phase 2 stores everything in PostgreSQL through Drizzle ORM (`server/db`). Locally, with no `DATABASE_URL`, the server runs PGlite, a WebAssembly Postgres, in `DATA_DIR/pglite`, so nothing needs installing. `npm run db:migrate` applies migrations, `npm run db:seed` adds the 12 invented demo rooms to a local directory, and `npm run db:generate` writes a new migration after a schema change. The Google Sheet storage from Phase 1 has been removed.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Install if needed, build, serve on `PORT`, open the browser. |
| `npm run dev` + `npm run dev:server` | Development: Vite with hot reload on <http://localhost:5173> (proxies `/api` to the server) and the API server with file watching. Run them in two terminals. |
| `npm run build` | Production build into `dist/`. |
| `npm run serve` | Start the server only (expects `dist/`). |
| `npm test` | Unit and component tests (Vitest). |
| `npm run test:e2e` | End-to-end tests (Playwright, desktop 1440x900 and mobile 390x844), including the full morning test (`e2e/morning.spec.ts`). Builds the app and serves it on `E2E_PORT` (default 3100) under `NODE_ENV=test` (test-only login, mock transcription and extraction) with a throwaway `DATA_DIR`, so your data is never touched. Set `E2E_DATABASE_URL` to a local Postgres database whose name contains `e2e` to run against real Postgres (it is dropped and recreated each run); otherwise PGlite. Needs a Playwright Chromium (`npx playwright install chromium` once). |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript, no emit. |
| `npm run db:migrate` / `db:seed` / `db:generate` | Apply migrations, seed the local demo directory, generate a migration from `server/db/schema.ts`. |
| `npm run check` | Typecheck, lint and unit tests. |

## Project structure

```
server/                 Fastify server: static app, /health, /api/status
  db/                   Drizzle schema, migrations, PGlite test harness, fixtures
  auth/                 Google sign-in (Better Auth)
  extract/              Claude extractor, mock extractor, prompt
  routes/               One module per workstream, listed in routes/registry.ts
src/
  contracts/            Shared types (zod), API client, scene layout, events, style tokens
  state/                Zustand store and the event-bus bridge
  data/                 Board sorting helpers and the signed-out seed demo repository
  world/                The 3D room
    room/ lighting/ materials/    Shell, light rig and post, procedural materials
    board/ string/                Bulletin board with polaroids, red string
    props/living/ props/desk/     Furniture, desk terminal
    wishlist/                     Chalkboard and its overlay
  player/               First-person controller, collisions, touch controls
  interaction/          Centre-screen raycast, hover outline, reticle and prompts
  gate/                 Daily memory puzzle (door + overlay)
  ui/                   Overlays: review, record, confirm, wrap, shell (loading, HUD, settings)
  audio/                Synthesized ambience and sound effects
seed/                   12 sample rooms and generated SVG photos
e2e/                    Playwright tests
scripts/                start.mjs (one-command run), screenshot helper
```

Each folder has its own README with details. Design choices are listed in [`DECISIONS.md`](DECISIONS.md), and asset and library credits in [`CREDITS.md`](CREDITS.md).

## Deploying to Railway

The repo includes `railway.json`. It has not been deployed from here.

1. Create a Railway project from this GitHub repo.
2. Railway installs dependencies, runs `npm run build` and starts with `npm run serve`, health-checking `/health`. It sets `PORT` itself.
3. Add a PostgreSQL service and reference its `DATABASE_URL` from the app service. Set the other variables in the service's **Variables** tab.
4. `railway.json` runs `npm run db:migrate` as the pre-deploy command, and the server migrates again on start (a no-op when up to date).
