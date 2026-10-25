# Server (workstream 20: Local Run)

One Fastify process serves the API and the built app.

## Run it

```sh
npm start              # install if needed, build, start, open the browser
npm start -- --no-build   # skip the build when dist/ is newer than the sources
PORT=3001 npm start    # another port
NO_OPEN=1 npm start    # don't open a browser (also skipped when CI is set)
npm run serve          # just the server (expects dist/ to exist)
```

`scripts/start.mjs` uses only Node built-ins, so a Mac with only Node (20.19+ or 22.12+, the range Vite 8 supports) installed is enough:

1. Checks Node >= 20 (`.nvmrc` pins 22).
2. Runs `npm install` when `node_modules` is missing, or when `package-lock.json` is newer than `node_modules/.package-lock.json` **and** asks for different package versions (a git checkout bumps mtimes, so mtime alone would reinstall every time).
3. Runs `npm run build` (unless `--no-build` and dist is fresh).
4. Starts `tsx server/index.ts` as a child, forwards SIGINT/SIGTERM/SIGHUP, waits for `/health`, then opens `http://localhost:<PORT>` (`open` / `xdg-open` / `start`).

## Files

| File | What |
| --- | --- |
| `index.ts` | `buildServer({ distDir?, logger? })` and the CLI entry (listen, banner, graceful shutdown, port-in-use message) |
| `env.ts` | Loads `.env` quietly (imported first), `appVersion()` from package.json, `resolvePort()`, `startupBanner()` |
| `static.ts` | Static serving of `dist/`, caching, br/gzip variants, SPA fallback, JSON 404s, "run npm run build" page |
| `precompress.ts` | `precompressDist(dir)`: writes `.br`/`.gz` siblings for text assets (post-build step and at startup) |
| `routes/extract.ts`, `routes/sheet.ts` | API routes (owned by other workstreams) |

## Routes and behaviour

- `GET /health` -> `{ ok: true }`
- `GET /api/status` -> `{ extraction: 'claude' | 'mock', storage: 'google-sheet' | 'seed', version }`
- Everything in `routes/*` (`/api/data`, `/api/extract`, ...).
- Unknown `/api/*` (any method) -> `404 { "error": "not found: ..." }`.
- `/assets/*` (Vite hashed files): `Cache-Control: public, max-age=31536000, immutable`. A missing asset is a plain 404, never HTML.
- `index.html` (and the SPA fallback for any other GET): `Cache-Control: no-cache`.
- Other files in `dist/` (favicon etc.): `public, max-age=3600`.
- Compression: text files in `dist/` (`.js .css .svg .html .json ...`, 512 bytes or more) get precompressed `.br` (quality 11) and `.gz` (level 9) siblings. `npm run build` writes them (`tsx server/precompress.ts` after `vite build`), and startup rewrites any that are missing or older than their source. When `Accept-Encoding` allows, the server sends the compressed sibling with `Content-Encoding: br|gzip`, the original `Content-Type`, the same `Cache-Control` as the plain file, and `Vary: accept-encoding`. Images and clients without `Accept-Encoding` get the plain file. The 1.63 MB bundle goes out as about 360 KB of brotli (456 KB gzip).
- No `dist/` at startup: GETs get a small 503 page saying to run `npm run build`; the API still works. The check happens once at startup, so restart after building.

On start the server prints which features are real or mock and which env vars switch them (names only, never values). Ctrl+C / SIGTERM closes the server gracefully (forced exit after 5 s). If the port is taken it prints `Try another port: PORT=3001 npm start` and exits 1.

## Environment variables

All optional; see `.env.example`.

| Var | Effect |
| --- | --- |
| `PORT` | Listen port (default 3000). Host is always `0.0.0.0`. |
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`) | Real Claude extraction instead of the mock extractor |
| `GOOGLE_SHEET_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Sheet storage instead of the seed/local store |
| `NO_OPEN=1`, `CI` | `npm start` doesn't open a browser |

## Railway

`railway.json` uses the Railpack builder, installs dependencies itself and builds with `npm run build` (re-running `npm ci` in the build step can fail on the builder's cache mount), starts with `npm run serve`, health-checks `/health` and restarts on failure (up to 5 retries). Railway injects `PORT`; set the API/Sheet variables in the service's Variables tab. `tsx` and `vite` are regular dependencies, so the install step provides everything the build and the server need. Not deployed from here.
