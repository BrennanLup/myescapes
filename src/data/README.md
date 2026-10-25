# Data layer (workstream 14)

Storage for rooms, reviews, puzzles, wishlist and crew, the `/api/data`, `/api/entries` and `/api/wishlist` routes, and the 12-room seed.

## Files

| Path | What |
| --- | --- |
| `src/data/index.ts` | Client helpers: `roomsForSort(rooms, reviews, key)` (board order + group labels), `groupFor`, `ratingBucket`, `escapeTimeBucket`, `formatEscapeTime` |
| `src/data/server/repository.ts` | The `Repository` interface (`mode`, `getDataset`, `saveEntry`, `getWishlist`, `putWishlist`), `createRepository()` and shared helpers (`normalizeEntry`, `mergeCrew`, `upsertById`) |
| `src/data/server/seedRepository.ts` | Seed adapter: `seed/reviews.json` plus a writable overlay |
| `src/data/server/sheetRepository.ts` | Google Sheet adapter |
| `src/data/server/sheetsApi.ts` | Small Sheets REST v4 client over `fetch`, plus service-account JWT auth (`google-auth-library`) |
| `src/data/server/sheetMapping.ts` | Pure row-to-entity mapping in both directions (unit-tested) |
| `server/routes/sheet.ts` | `sheetRoutes(app, { repository? })` and `storageMode()` |
| `seed/reviews.json` | 12 rooms (6 San Francisco, 6 Toronto), 12 reviews, 5 crew, 6 wishlist items |
| `seed/generate-photos.ts` | Builds the polaroid SVGs in `public/seed/photos/` (`npx tsx seed/generate-photos.ts`) |

Browser code must only import `src/data/index.ts`. The `server/` subfolder uses Node APIs.

## Choosing the storage backend

- **Seed (default).** The seed file is read-only. Writes go to `<DATA_DIR>/store.json`, where `DATA_DIR` defaults to `.data/` (gitignored, created on first write). The file is an overlay, `{ entries: Entry[], wishlist: WishlistItem[] | null }`, merged over the seed: entries are upserted by room id and review id, and a saved wishlist replaces the seed wishlist. Data survives restarts. Delete `.data/store.json` to reset. Writes are serialized and atomic (written to a temp file, then renamed).
- **Google Sheet.** Used when both `GOOGLE_SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON` are set. `GOOGLE_SERVICE_ACCOUNT_JSON` takes either the raw key JSON or a path to the key file. Share the sheet with the service account's `client_email` as an editor. On startup the adapter adds any missing tabs and header rows, then does a test read. If any of that fails (bad key, no access, network), the server logs a `[data] WARNING ... Falling back to seed storage` line and runs in seed mode. It never crashes.

`storageMode()` (shown in `/api/status`) reports the adapter that is actually active.

## Routes

- `GET /api/data` returns the `Dataset`. `crew` also includes any review crew names that are missing from the crew list.
- `POST /api/entries` takes an `Entry`. It validates against `EntrySchema` (400 with the list of issues on failure), then upserts the room and review by id. It sets `review.roomId` and each `puzzle.reviewId` to match, and returns the saved entry.
- `GET /api/wishlist` returns the wishlist. `PUT /api/wishlist` validates against `WishlistPutSchema` and replaces the whole list.
- Storage errors after startup return 502 `{ error }`.

## Sheet layout

Each tab has a header row. Columns are matched **by header name**, so you can reorder them or add your own extra columns (the app ignores them). Values are written RAW: numbers and booleans as real values, everything else as text.

| Tab | Columns |
| --- | --- |
| `Rooms` | id, name, company, city, genre, address, website, photos |
| `Reviews` | id, roomId, date, crew, overall, overallComment, puzzles, puzzlesComment, setting, settingComment, storyline, storylineComment, difficulty, difficultyComment, escaped, escapeTimeMinutes, visibleTimer, multiRoom, flashlights, liveActors, toolsUsed, voiceTranscript, photos |
| `Puzzles` | id, reviewId, description, type, memorable |
| `Wishlist` | id, name, city, link, addedBy, priority, done |
| `Crew` | id, name, userId, email |

How nested fields are stored:
- **Ratings** are flat: a score column (1-100) and a `<key>Comment` column for each rating.
- **crew and toolsUsed** are JSON arrays (`["Maya","Theo"]`). On read, a plain `Maya, Theo` cell also works.
- **photos** is a JSON array of `{url, caption}`. On read, one URL per line also works. Inline `data:` photos are dropped if they would go over the 50,000-character limit for a Sheets cell.
- **Puzzles** are their own rows, linked by `reviewId`.

Reading hand-edited rows is lenient: `TRUE`/`yes`/`1`/`x` count as true, real date cells (serial numbers) and `2024-3-5` become ISO dates, and an unknown genre becomes `other`. Rows that are still invalid (for example a missing score) are skipped, with a warning naming the tab and row.

Writes:
- Saving an entry upserts its Rooms and Reviews rows by id (the row is updated if the id exists, appended if not).
- Puzzles that were removed from a re-saved review are cleared.
- New crew names get a row in Crew.
- `PUT /api/wishlist` clears the Wishlist tab and rewrites it.

## Seed

12 invented rooms from 6 companies. Fog City Escapes, Lockbox Social and Maple & Key each run several rooms, and Lockbox Social runs rooms in both cities. The seed covers all 10 genres and all 6 puzzle types, with dates from 2023 to 2026. Three escapes failed and one escape time is unknown. Every boolean is used both ways, `toolsUsed` varies, and 7 reviews have a voice transcript. All addresses and websites are fake (`*.example.com`).

Photos are 18 SVG polaroids of about 3.5-10 KB each, made from simple shapes in the `style.ts` palette:
- `<roomId>-1.svg` is a scene for the room's genre: lighthouse, vault door, rocket, haunted house with a friendly ghost, saloon, pickle circus tent, castle with dragon, jungle temple, steam train, lab with hamster, attic, or jazz club.
- `<roomId>-2.svg`, where it exists, is a crew photo holding an "ESCAPED 49:00" or "SO CLOSE!" sign.

Room photos go in `room.photos`. Seed `review.photos` are empty. The caption font falls back to the browser's cursive font, because an SVG loaded as an `<img>` cannot use page web fonts.

## Tests

`npx vitest run src/data server/routes` covers:
- the seed contents and the photo files on disk
- the seed repository: save round trip, upsert, concurrent saves and wishlist, all in a temp `DATA_DIR`
- falling back to seed mode
- the routes, through `fastify.inject`
- sheet mapping round trips for the whole seed, header reordering and lenient cells
- `SheetRepository` against an in-memory fake of the Sheets API

## Simplifications

- The adapter never ran against a live Google Sheet, because no credentials were available. Its HTTP traffic is covered only by the in-memory fake.
- The sheet adapter does not fill an empty sheet from the seed. A new sheet starts empty, and the app handles 0 rooms.
- Every request reads the whole sheet. There is no caching, which is fine for a friend group's dataset.
