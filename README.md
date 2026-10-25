# My Escapes

A cozy first-person 3D room that holds every escape room your crew has done.

You walk around a warm, low-poly gaming bedroom. The north wall has a cork board with a polaroid for each escape room, linked by red string. Click a photo to read its review. To log a new room, record a voice note at the desk terminal. It is turned into a structured review (by Claude, or by a built-in mock extractor when there is no API key), which you check and fix on an editable form before it gets pinned to the board. A small daily memory puzzle on the door greets you when you arrive. There is also a wish-list chalkboard and a "Year in Escape Rooms" wrap.

It works with no configuration at all: it ships with 12 sample rooms and stores new entries locally.

## Run it

You only need [Node.js 20+](https://nodejs.org/).

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
| `GOOGLE_SHEET_ID` | Seed mode: `seed/reviews.json` plus your own entries in `DATA_DIR`. | Rooms, reviews, puzzles, wish list and crew live in that Google Sheet (needs `GOOGLE_SERVICE_ACCOUNT_JSON` too). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | (as above) | The service-account key, either the raw JSON or a path to the key file. |
| `PORT` | `3000` | Port the server listens on. |
| `DATA_DIR` | `.data/` in the repo (gitignored) | Where seed mode writes new entries and wish-list changes. |

If the Sheet can't be reached at startup (bad key, no access, no network), the server logs a warning and runs in seed mode instead of crashing.

### Google Sheet setup

1. Create a Google Cloud project and enable the **Google Sheets API**.
2. Create a **service account** (IAM & Admin > Service Accounts) and add a JSON key. Download it.
3. Create an empty Google Sheet. Copy its id from the URL: `https://docs.google.com/spreadsheets/d/<THIS PART>/edit`.
4. Share the sheet with the service account's `client_email` (from the key file) as an **Editor**.
5. In `.env`, set `GOOGLE_SHEET_ID=<the id>` and `GOOGLE_SERVICE_ACCOUNT_JSON=./path/to/key.json` (or paste the JSON on one line).
6. Restart. On startup the app creates the `Rooms`, `Reviews`, `Puzzles`, `Wishlist` and `Crew` tabs with header rows if they are missing. Columns are matched by header name, so you can reorder them or add your own. The full column layout is in [`src/data/README.md`](src/data/README.md).

The sheet starts empty. Add rooms through the app, or paste rows by hand.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Install if needed, build, serve on `PORT`, open the browser. |
| `npm run dev` + `npm run dev:server` | Development: Vite with hot reload on <http://localhost:5173> (proxies `/api` to the server) and the API server with file watching. Run them in two terminals. |
| `npm run build` | Production build into `dist/`. |
| `npm run serve` | Start the server only (expects `dist/`). |
| `npm test` | Unit and component tests (Vitest). |
| `npm run test:e2e` | End-to-end tests (Playwright, desktop 1440x900 and mobile 390x844). Builds the app and serves it on `E2E_PORT` (default 3100) with a throwaway `DATA_DIR`, so your data is never touched. Needs a Playwright Chromium (`npx playwright install chromium` once). |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript, no emit. |
| `npm run check` | Typecheck, lint and unit tests. |

## Project structure

```
server/                 Fastify server: static app, /health, /api/status
  extract/              Claude extractor, mock extractor, prompt
  routes/               /api/extract, /api/data, /api/entries, /api/wishlist
src/
  contracts/            Shared types (zod), API client, scene layout, events, style tokens
  state/                Zustand store and the event-bus bridge
  data/                 Storage: seed repository, Google Sheet repository, mapping
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
2. Railway builds with `npm ci && npm run build` and starts with `npm run serve`, health-checking `/health`. It sets `PORT` itself.
3. Add any variables you want in the service's **Variables** tab (`ANTHROPIC_API_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` as raw JSON).
4. Seed mode writes to the container's disk, which Railway resets on every deploy. Use the Google Sheet for data that should last, or mount a volume and point `DATA_DIR` at it.
