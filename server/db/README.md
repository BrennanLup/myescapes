# Database (workstream 2)

PostgreSQL through Drizzle ORM. `DATABASE_URL` selects node-postgres (Railway); without it the server runs PGlite (WebAssembly Postgres, in-process) in `DATA_DIR/pglite`. Tests use PGlite in memory, so nothing external is needed.

| File | What |
| --- | --- |
| `schema.ts` | Every table: Better Auth (`users`, `sessions`, `accounts`, `verifications`), directory (`cities`, `venues`, `games`, `sources`), visits (`visits`, `visit_participants`, `reviews`, `visit_puzzles`, `visit_photos`, `visit_edits`), social (`friendships`, `invites`, `notifications`), `wishlist_items`, Escape of the Day (`daily_puzzles`, `daily_results`), `reports`, `usage_counters`, characters (`avatars`: one saved outfit per user; `avatar_purchases`: wardrobe items bought with keys, unique per user and item) |
| `migrations/` | SQL migrations from `npm run db:generate`. `0000_extensions.sql` enables `pg_trgm`. Never edit one that has shipped |
| `client.ts` | `createDb()`, `createPostgres(url)`, `createPglite(dir)`; `Db`, `Tx`, `DbHandle` types |
| `migrate.ts` | `runMigrations(handle, { timeoutMs })` and the `npm run db:migrate` CLI |
| `usage.ts` | Spending caps: `reserveUsage`, `releaseUsage`, `usageSummary`, `spendingCapError`, `capsFromEnv` |
| `dataset.ts` | Phase 1 mapping for the 3D room: `datasetForUser`, `saveEntryForUser`, wish list get/put |
| `util.ts` | `slugify`, `citySlug`, `uniqueSlug`, `toPublicUser`, `isUniqueViolation`, `haversineKm`, `googleMapsUrl` |
| `seed.ts` | `npm run db:seed`: the 12 invented Phase 1 rooms as a local demo directory (refuses in production) |
| `testing.ts` | `createTestDb()`, `resetDb()`, `ALL_TABLES` |
| `fixtures.ts` | `loadFixtures(db)` and the fixed ids in `FX` (people, friendships, directory, visits for every permission case) |
| `test-global-setup.ts` | Vitest global setup: one migrated PGlite template per run |

Conventions: text ids (`newId('vis')` -> `vis_...`; Better Auth makes its own for users), `timestamptz` timestamps, `date` columns as `YYYY-MM-DD` strings, `friendships` stored once per pair with `user_a < user_b`. Account deletion: first copy the person's display name into `visit_participants.guest_name` for their tags, then delete the user; foreign keys cascade their reviews, photos, friendships, invites, wish list, results and notifications, and null their other references.

Migrations run on deploy (`preDeployCommand` in `railway.json`) and again on every server start, under a Postgres advisory lock. Both are no-ops when up to date.
