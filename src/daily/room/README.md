# Escape of the Day in 3D (`src/daily/room`, Phase 3 workstream D)

Today's Escape of the Day as a small room you walk around in, at **`/daily/room`** (lazy-loaded; `/daily` and `/m` never download three.js). The 2D game at `/daily` stays as the fallback for low-end devices and accessibility, and links here with **Play in 3D**; so does the door overlay in your own room.

## How it plays

- **Entry card**: number, theme, kind and a one-line brief. "Step inside" starts the clock (like "Start" in 2D); a day in progress shows "Continue", a finished day "Look around" with the door already open. "Play in 2D instead" is always there.
- **The room** (8 x 8 m, built inside the shared player bounds and walled off with its own colliders, `layout.ts`): exit door in the north wall with a lock box to its right and a brass plaque to its left, clues on the west wall, a guess chalkboard on the east wall, a hint bell on a side table, and furniture.
- **Challenges as props** (from `src/daily/engine/challenges.ts`):
  - *combination*: one numbered clue poster per digit (counting icons, arithmetic, a clock face); dial the code on the padlock.
  - *cipher*: the encoded word painted above the door, the key (with worn-away symbols) on a parchment poster; spell the word on the letter lock.
  - *sequence*: a lit panel with the terms so far and three "?" slots (numbers or coloured shapes); set the next three on the lock.
  - *search*: little brass keys, stars or hearts hidden under real objects (cushion, books, jar, plant pot, crate, hat box, chest, rug corner, picture, vase, basket, lamp). Each round you get one look per target still missing; found ones stay out; a round is sent as one guess, exactly like the 2D taps (`search.ts`), so the share grid means the same.
- **Panels** (DOM, keyboard/touch/screen-reader friendly, Esc or × closes, focus is trapped): the lock (prompt, the clues again in a collapsible section, guess history, the same inputs as 2D), clues, hints (−150 each, give up), the result (the 2D `Finished` view: share, streak, friends leaderboard, countdown) and a menu (Play in 2D, back to my room, controls).
- **Finishing** opens the door: a solve plays the unlock sound, confetti and the result panel; a fail (out of guesses or giving up) shows the answer and opens the door anyway so nobody is stuck. Walking down the corridor past `EXIT_Z` fades to "Welcome home…" and navigates to `/?autostart=1` (signed in) or `/?demo=1&autostart=1` (signed out). You arrive a step inside your room's own daily door facing the board, and `DailyWelcome` (src/daily/ui/welcome.tsx, mounted in App) shows a toast, plus "Continue with Google" for signed-out players. Phones (the same rule that sends `/` to `/m`) go straight to `/m?from=daily` after a finished day, where `MobileDailyWelcome` (src/daily/ui/MobileWelcome.tsx, mounted by the phone shell) shows the same card and confetti, with "Sign in to keep your streak" above the sign-in button when signed out; the flag is then dropped from the address bar. Leaving early on a phone just goes to `/m`.

## Shared with the 2D game

`useDailyPlay` (src/daily/ui/DailyGame.tsx) holds the play logic for both: local progress, `POST /api/daily/start`, the result through `POST /api/daily/results` (so streaks and leaderboards work), and `window.__ESCAPE_DAILY__`. No server changes.

## Files

| File | What |
| --- | --- |
| `index.tsx` | `DailyRoomPage` (route), loading and error states |
| `DailyRoom.tsx` | Canvas + DOM layer; boots the shared player state, maps `interact` events (`daily:*` ids) to panels and search looks, publishes the play snapshot, leaving |
| `layout.ts` | Pure layout: room size, colliders (door closed/open), exit line, prop positions |
| `search.ts` | Pure: hiding spots, day-seeded target assignment, look/round logic |
| `Shell.tsx` | Floor, walls, corridor and its glow, exit door, lights, `ExitWatcher` |
| `PuzzleProps.tsx` | Lock box, clue posters/banner/panel/sign, chalkboard, hint bell, plaque |
| `Furniture.tsx` | Furniture and hiding spots (lift animation, found tokens) and their colliders |
| `textures.ts` | Canvas drawings (redrawn once the web fonts load) |
| `RoomUi.tsx` | Entry card, HUD, panels, toast, confetti, leaving fade |
| `playStore.ts`, `uiStore.ts` | Small zustand stores: what the 3D props draw; which panel is open |
| `exit.ts` | Where the exit leads (main room, demo room or `/m?from=daily` on phones) and the hand-over |

Reuses as-is: `PlayerController`, `MobileControls` (src/player), `LocalAvatar` (src/world/avatars), `PerfMonitor` (src/ui/shell), `InteractionSystem`, `Reticle` (src/interaction), `AudioSystem`, shared materials via `getMaterial` (no edits). An open panel sets the shared store's overlay to `{ kind: 'gate' }`, which freezes the controls, hides the reticle and touch controls and releases pointer lock.

## Test hooks

`window.__ESCAPE_DAILY_ROOM__`: `spots()` (spot id -> target id), `round()`, `leave()`. Test ids: `daily-room`, `daily-room-entry`, `daily-room-enter`, `daily-room-lock`, `daily-room-clues`, `daily-room-hints`, `daily-room-result-panel`, `daily-room-walk`, `daily-room-home`, `daily-room-menu`, `daily-room-looks`, `daily-room-toast`, `daily-room-leaving`, `camera-toggle`; in the main room and on `/m?from=daily` `daily-welcome`, `daily-welcome-line`, `daily-welcome-signin`; on /daily and the door overlay `daily-play-3d`.

Tests: `layout.test.ts` (walks the real movement code from the spawn through the door), `search.test.ts`, `exit.test.ts`, `DailyRoom.test.tsx` (DOM layer with the Canvas stubbed), `src/daily/ui/welcome.test.tsx`, `src/daily/ui/MobileWelcome.test.tsx`, and `e2e/daily-room.spec.ts` (desktop and phone, signed out; desktop signed in).

## Camera modes, character and performance

The room mounts the standard `PlayerController` (no `firstPersonOnly`) and your `LocalAvatar`, so `V` or the bottom-right **camera toggle** (`CameraToggle` in `RoomUi.tsx`, test id `camera-toggle`, the camera half of the main room's character HUD) switches between first person and the over-the-shoulder third person; the choice is shared with your own room (per device). The room loads your look from the wardrobe store (`GET /api/me/avatar`, or this device when signed out); the wardrobe itself stays in your own room. The 8 x 8 m room's walls are colliders, so the third-person camera pulls in rather than clipping through them.

`PerfMonitor` (src/ui/shell) runs in the room's Canvas too: the automatic one-step quality drop on slow phones (said in the room's toast, since this page has no shell toast) and the `?debug=1` frame-rate readout.
