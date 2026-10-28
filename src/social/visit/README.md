# Visiting friends and people in the room (Phase 3, workstream C)

| File | What |
| --- | --- |
| `HomeVisitPage.tsx` | The `/home/:handle` route. Signed out: the sign-in card (back to this room after). Not onboarded: the name and @handle step (friends see you by them). Then `GET /api/homes/:handle`: a friendly page for "only friends can come in" (403), "no room called @x" (404) or a network error, each with **Back to my room**; your own handle goes to `/`; a friend's room opens the 3D room. |
| `state.ts` | `installVisit(handle)` (called by `src/desktop.tsx`): the room's data loader becomes the friend's home and `store.visiting` is set, so the store refuses edits (logging a room, the wish list) and the review overlay offers no photo uploads. `preloadHome` (the route's access check is reused as the first load), spoilers on/off (`?spoilers=1`), `visitProblem`. |
| `urls.ts` | `visitUrl`, `homeUrl`, `visitHandleFromPath`, `pageNav` (full page loads). Dependency-free. |
| `PeopleHud.tsx` | In the 3D room (mounted by `App.tsx`): the visiting banner (whose room, a spoilers toggle, **Back to my room**), the people dock (People, Chat, emotes), the people panel (who is here, with "Ask to leave" for the host; "Visit a friend" with online dots, online first), the chat box and log. Touch: round buttons on the right, sheets for people (bottom) and chat (top, clear of the keyboard), and the newest line under the HUD. |
| `notices.ts` | In a friend's room, says why the wish list and "log a room" don't open. |
| `presence.tsx` | Light (no three.js, no socket): `useFriendPresence` polls `GET /api/presence` every 30 s while visible; `PresenceDot`, `presenceText`, `VisitRoomLink`. Used by the friends list in `/settings` (and the phone's friends panel). |

## Rules

- Moving between rooms is a full page load: the 3D room boots once per page for one home (data,
  socket home, read-only rules). `DesktopApp` reloads if it is ever shown for a different home.
- Visiting is read-only: board sorting, reading reviews, the year wrap and your own wardrobe and
  Escape of the Day still work; logging, the wish list and photo uploads don't (the server refuses
  them too). The HUD hides the record and wish list buttons.
- Back to my room goes to `/?autostart=1`; phones land on `/m`, as `/` always does for them.

## Keys (desktop)

`T` or `Enter` opens the chat box (`Enter` sends, `Esc` closes), `F` opens the people panel.

## Tests

`visit.test.tsx`: addresses, the read-only store, the notices, the route's sign-in, error and own-room
cases, and the people HUD on desktop and touch. End to end: `e2e/multiplayer.spec.ts`.
