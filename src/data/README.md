# Data layer (workstream 14)

Board sorting helpers, the 12-room seed and the signed-out seed demo repository. Signed-in users' data lives in Postgres (`server/db`; Phase 1 mapping in `server/db/dataset.ts`). The Google Sheet adapter was removed in Phase 2.

## Files

| Path | What |
| --- | --- |
| `src/data/index.ts` | Client helpers: `roomsForSort(rooms, reviews, key)` (board order + group labels), `groupFor`, `ratingBucket`, `escapeTimeBucket`, `formatEscapeTime` |
| `src/data/server/repository.ts` | The `Repository` interface (`mode`, `getDataset`, `saveEntry`, `getWishlist`, `putWishlist`), `seedRepositoryFor(dataDir)` (one shared instance per folder) and shared helpers (`normalizeEntry`, `mergeCrew`, `upsertById`) |
| `src/data/server/seedRepository.ts` | Seed adapter: `seed/reviews.json` plus a writable overlay |
| `server/routes/logs.phase1.ts`, `server/routes/wishlist.ts` | `/api/data`, `/api/entries`, `/api/wishlist`: Postgres when signed in, this seed demo when signed out |
| `seed/reviews.json` | 12 rooms (6 San Francisco, 6 Toronto), 12 reviews, 5 crew, 6 wishlist items |
| `seed/generate-photos.ts` | Builds the seed photo SVGs in `public/seed/photos/` (`npx tsx seed/generate-photos.ts`) |

Browser code must only import `src/data/index.ts`. The `server/` subfolder uses Node APIs.

## Seed demo storage

The seed file is read-only. Writes from signed-out visitors go to `<DATA_DIR>/store.json` (default `.data/`, gitignored), an overlay `{ entries: Entry[], wishlist: WishlistItem[] | null }` merged over the seed. Writes are serialized and atomic (temp file, then rename).

## Routes

Signed out (seed demo):
- `GET /api/data` returns the `Dataset` (`source: 'seed'`). `crew` also includes any review crew names that are missing from the crew list.
- `POST /api/entries` takes an `Entry` (400 `invalid` with the issues on failure), upserts the room and review by id, sets `review.roomId` and each `puzzle.reviewId` to match, and returns the saved entry.
- `GET /api/wishlist` returns the wishlist. `PUT /api/wishlist` replaces the whole list.

Signed in, the same routes read and write the user's Postgres rows (`source: 'postgres'`), see `server/db/dataset.ts`.

## Seed

12 invented rooms from 6 companies. Fog City Escapes, Lockbox Social and Maple & Key each run several rooms, and Lockbox Social runs rooms in both cities. The seed covers all 10 genres and all 6 puzzle types, with dates from 2023 to 2026. Three escapes failed and one escape time is unknown. Every boolean is used both ways, `toolsUsed` varies, and 7 reviews have a voice transcript. All addresses and websites are fake (`*.example.com`).

Photos are 18 bare SVG photo scenes (356x330, no frame or caption: the board, gallery, gate and wrap draw their own polaroid frame and handwritten caption) of about 3-10 KB each, made from simple shapes in the `style.ts` palette:
- `<roomId>-1.svg` is a scene for the room's genre: lighthouse, vault door, rocket, haunted house with a friendly ghost, saloon, pickle circus tent, castle with dragon, jungle temple, steam train, lab with hamster, attic, or jazz club.
- `<roomId>-2.svg`, where it exists, is a crew photo holding an "ESCAPED 49:00" or "SO CLOSE!" sign.

Room photos go in `room.photos`. Seed `review.photos` are empty.

## Tests

`npx vitest run src/data server/routes` covers:
- the seed contents and the photo files on disk
- the seed repository: save round trip, upsert, concurrent saves and wishlist, all in a temp `DATA_DIR`
- the routes, through `fastify.inject`
