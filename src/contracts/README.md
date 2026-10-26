# Contracts

Shared shapes every workstream builds against. Owned by the orchestrator (Phase 2: workstream 1). Request changes; don't edit.

| File | What |
| --- | --- |
| `types.ts` | Phase 1 Zod schemas: Room, Review, Puzzle, WishlistItem, CrewMember, Dataset (`source: postgres \| seed`), Entry, ReviewDraft, SortKey |
| `api.ts` | Phase 1 HTTP routes (`API`) and `apiClient`, still used by the 3D room |
| `models.ts` | **Phase 2** domain schemas: Me/PublicUser/handles, City/Venue/Game (+ summaries, matches, attribution), VisitFacts/VisitDetail/Participant/CrewTag/VisitEdit/LogRow, ReviewV2/ReviewInput (visibility, spoiler flag, copied-score flag), PublicReview/Aggregate/PuzzleHighlight, Game/Venue/City pages, Friend/Invite/Notification, WishlistItemV2, Escape of the Day (DailyPuzzle, DailyResult, DailyToday with `serverDay`, Streak, Leaderboard), Report, UsageSummary, AccountExport |
| `routes.ts` | **Phase 2** route list `ROUTES`: method, path, auth level (`public`/`optional`/`user`/`admin`/`test`), owning workstream, params/query/body/response schemas. `callApi(ROUTES.x, { params, query, body })` is the typed client |
| `errors.ts` | `ApiError` (`{ error, code?, details?, cap?, fallback? }`), `ERROR_CODES` and their HTTP statuses, `SpendingCapError` (429 `spending_cap`, `fallback: typing \| mock`), `ApiCallError` |
| `scene.ts` | Units, room size, `ANCHORS`, `LAMPS`, `LED_STRIPS`, `WINDOWS`, `anchorToWorld` |
| `events.ts` | Typed bus: `bus.emit('review:open', { roomId })`, `bus.on(...)` |
| `colliders.ts` | AABB registry + `useColliders` |
| `interaction.ts` | `interactable({ id, kind, label, event })` spread onto any mesh/group |
| `materials.ts` | Material ids; the implementation `getMaterial(id)` lives in `src/world/materials` |
| `style.ts` | Palette, light colours, fonts, UI tokens (Tailwind: `bg-panel`, `text-ink`, `bg-accent`, `font-display`, ...) |
| `assets.ts` | Asset manifest + budget |
| `runtime.ts` | Non-reactive per-frame state: player pose, teleport, pin positions, fps, joystick |
| `testing.ts` | `window.__ESCAPE__` hooks |

Module exports each workstream must keep (imported by `World.tsx` / `App.tsx`):

| Folder | Exports |
| --- | --- |
| `src/world/room` | `Room` |
| `src/world/lighting` | `Lighting` |
| `src/world/materials` | `getMaterial(id)` |
| `src/world/props/living` | `LivingProps` |
| `src/world/props/desk` | `DeskProps` |
| `src/world/board` | `BulletinBoard` |
| `src/world/string` | `RedString` |
| `src/world/wishlist` | `WishlistBoard`, `WishlistOverlay` |
| `src/player` | `PlayerController`, `MobileControls` |
| `src/interaction` | `InteractionSystem`, `Reticle` |
| `src/ui/review` | `ReviewOverlay({ roomId })` |
| `src/ui/record` | `RecordOverlay` |
| `src/ui/confirm` | `ConfirmOverlay({ draft })` |
| `src/gate` | `GateDoor`, `GateOverlay`, `useGateAutoOpen` |
| `src/audio` | `AudioSystem`, `VolumeToggle` |
| `src/ui/wrap` | `WrapTrophy`, `WrapOverlay` |
| `src/ui/shell` | `LoadingScreen`, `Hud`, `SettingsOverlay`, `PerfMonitor` |
| `server/routes/extract.ts` | `extractRoutes`, `extractionMode` |
| `server/index.ts` | `buildServer`, `prepareDatabase` |

## Phase 2

**Rules for every route.** Register it with `defineRoute(app, ctx, ROUTES.x, handler)` (server/http.ts). That enforces the route's auth level, validates params/query/body with the schemas here (400 `invalid`), and parses the return value with the response schema, which strips any field the contract doesn't list. Throw `httpError(code, message)` for failures. Never put an email in a public shape, never return another user's `transcript` (it is `null` unless the viewer is the author), and treat a hidden or not-allowed thing as 404.

**Privacy-policy promises baked into the contract:** `deleteMe` and `exportMe` exist; transcription answers `audioDeleted: true` (the audio is never stored); `PublicUser` has no email; `LeaderboardEntry` has no streak (a streak is visible only to its owner).

**Escape of the Day day rule:** `DailyToday.serverDay` is the user's day as the server recorded it at the first play (time zone fixed then); `dailySubmit` rejects any other `day` with 400 `wrong_day`.

**Spending caps:** over a cap, `/api/transcribe` answers 429 `spending_cap` with `fallback: 'typing'`; `/api/extract` answers 200 with `mode: 'mock'` and a `notice`. Use `reserveUsage`/`spendingCapError` from `server/db/usage.ts`.

Server modules (registered by `server/routes/registry.ts`; each workstream edits only its own file):

| WS | File | Export |
| --- | --- | --- |
| 3 | `server/auth/index.ts` | `authRoutes`, `resolveUser`, `authMode` |
| 4 | `server/routes/logs.ts`, `logs.phase1.ts`, `wishlist.ts` | `logsRoutes`, `phase1Routes`, `wishlistRoutes` |
| 5 | `server/routes/directory.ts` | `directoryRoutes` |
| 10 | `server/routes/transcribe.ts` | `transcribeRoutes`, `transcriptionMode` |
| 11 | `server/routes/extract.ts`, `server/extract/` | `extractRoutes`, `extractionMode` |
| 23 | `server/routes/daily.ts` | `dailyRoutes` |
| 24 | `server/routes/photos.ts` | `photosRoutes` |
| 25 | `server/routes/admin.ts` | `adminRoutes` |
| 26 | `server/seo/index.ts` | `seoRoutes`, `headTagsFor` |
| 31 | `server/routes/friends.ts` | `friendsRoutes` (friends, invites, notifications) |
| 32 | `server/routes/visits.ts` | `visitsRoutes` |
| 33 | `server/routes/reviews.ts` | `reviewsRoutes` |
| 34 | `server/routes/claims.ts` | `claimsRoutes` |

Client modules (lazy-loaded by `src/router.tsx`; pages take `RouteProps` `{ params, rest }`):

| WS | Folder | Exports |
| --- | --- | --- |
| 3 | `src/auth` | `useSession`, `signInWithGoogle`, `signOut` |
| 12 | `src/mobile/match` | `VenueGameMatcher` |
| 13 | `src/mobile/shell` | `MobileApp` (route `/m/*`); `device.ts`: `shouldRedirectToMobile` |
| 14 | `src/mobile/log` | `LogFlow` |
| 15 | `src/mobile/list` | `RoomsTable`, `ReviewDetail` |
| 16 | `src/public/game` | `GamePage` (`/games/:slug`) |
| 17 | `src/public/venue`, `src/public/city` | `VenuePage` (`/venues/:slug`), `CityPage` (`/cities/:slug`) |
| 18 | `src/public/reviews` | `ReviewList`, `ReviewCard`, `AuthorCard`, `ReportButton`, `AggregateScores` |
| 19 | `src/public/landing` | `Landing` (`/welcome`), `SignInScreen` |
| 21 | `src/daily/engine` | `generateDaily`, `localDay`, `dailyNumber` |
| 22 | `src/daily/ui` | `DailyPage` (`/daily`), `DailyCard` |
| 24 | `src/ui/photos` | `PhotoUploader`, `resizeImage` |
| 35 | `src/social`, `src/social/settings` | `InvitePage` (`/invite/:code`), `FriendsPanel`, `Inbox`, `NotificationsBadge`; `SettingsPage` (`/settings`) |
| 36 | `src/mobile/log/crew` | `CrewPicker` |

The 3D room (`/`) is `src/desktop.tsx` -> `App`. Nothing under `/m` or the public pages may import `src/world`, `three` or `@react-three/*`.

Tests: `createTestDb()` / `resetDb()` (server/db/testing.ts), `loadFixtures()` + `FX` ids (server/db/fixtures.ts), `buildTestApp({ fixtures: true })` with `inject({ as: FX.users.alice })` (server/testing.ts).

Dev helper: `node scripts/screenshot.mjs <url> <out.png> [w] [h] [waitMs] [js]` takes a screenshot with the preinstalled Chromium (software WebGL).
