# Contracts

Shared shapes every workstream builds against. Owned by the orchestrator. Request changes; don't edit.

| File | What |
| --- | --- |
| `types.ts` | Zod schemas: Room, Review, Puzzle, WishlistItem, CrewMember, Dataset, Entry, ReviewDraft, SortKey |
| `api.ts` | HTTP routes (`API`), request/response schemas, `apiClient` |
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
| `server/routes/sheet.ts` | `sheetRoutes`, `storageMode` |
| `server/index.ts` | `buildServer` |

Dev helper: `node scripts/screenshot.mjs <url> <out.png> [w] [h] [waitMs] [js]` takes a screenshot with the preinstalled Chromium (software WebGL).
