# Visiting friends and people in the room (Phase 3, workstream C)

| File | What |
| --- | --- |
| `HomeVisitPage.tsx` | The `/home/:handle` route. Signed out: the sign-in card (back to this room after). Not onboarded: the name and @handle step (friends see you by them). Then `GET /api/homes/:handle`: a friendly page for "only friends can come in" (403), "no room called @x" (404) or a network error, each with **Back to my room**; your own handle goes to `/`; a friend's room opens the 3D room, with the boot splash saying "Heading to Vera's room…" until the room's loader (same tagline) takes over. If the visit ends while you are inside (unfriended, blocked, or the owner's **Ask to leave**, including a refused rejoin), the room is swapped for the same page: "You can no longer visit Robin's room" or "Robin asked you to leave" (with the minutes until you may come back), focus on its heading. |
| `state.ts` | `installVisit(handle)` (called by `src/desktop.tsx`): the room's data loader becomes the friend's home and `store.visiting` is set, so the store refuses edits (logging a room, the wish list) and the review overlay offers no photo uploads. `preloadHome` (the route's access check is reused as the first load; a failed one is not cached, so Try again refetches), `VISITOR_SPAWN` (visitors start 1.3 m left of the owner's usual spot), spoilers on/off (`?spoilers=1`), `visitProblem`. `endVisit` / `useVisitEnded` (called by `src/net/session.ts`): ends the visit once, then forgets the friend's rooms, reviews, wish list, crew and open overlay, makes the data loader refuse (no quiet refresh brings it back) and releases the pointer lock. |
| `urls.ts` | `visitUrl`, `homeUrl`, `visitHandleFromPath`, `pageNav` (full page loads). Dependency-free. |
| `PeopleHud.tsx` | In the 3D room (mounted by `App.tsx`): the visiting banner (whose room, a spoilers toggle, **Back to my room**), the people dock (People, Chat, emotes), the people panel (who is here, with "Ask to leave" for the host; "Visit a friend" with online dots, online first, leaving out friends already listed under "Here now" ("Here with you" only for one still on the way in), and "In their room" / "In their room with 2 friends"), an emote chip by the dock (`EmoteEcho.tsx`: "You waved · Mia sees it", or "nobody else is here to see it"; in third person, where you see your own character, only the second), the chat box and log, and a connection chip (Reconnecting..., Away, Open in another tab). On phones the banner reads "Robin's room" and "My room" so it fits at 360 px. Touch: round buttons on the right, sheets for people (bottom) and chat (top, clear of the keyboard), and the newest line under the HUD. |
| `FriendsOnline.tsx` | The phone home's (`/m`) "Friends online" row: online friends (at home first, up to 4, then "and N more online" to `/settings#friends`) with presence text and a **Visit** button to `/home/:handle`; a friend in your room gets **Join** (the shell's "View on desktop"). Hidden while nobody is online. Light: presence polling only. |
| `notices.ts` | In a friend's room, says why the wish list, "log a room" and the trophy (Wrapped) don't open, and `visitorPromptLabel` turns their hover prompts into "Robin's desk (look only)", "Robin's wish list (look only)" and "Robin's trophy shelf (look only)" (used by `src/interaction/Reticle.tsx`). |
| `EmoteEcho.tsx` | The emote chip above (`emoteEchoText` is the pure wording). |
| `presence.tsx` | Light (no three.js, no socket): `useFriendPresence` polls `GET /api/presence` every 30 s while visible; `PresenceDot`, `presenceText`, `VisitRoomLink`. Used by the friends list in `/settings` (and the phone's friends panel) and the "Friends online" row on the `/m` home (`FriendsOnline.tsx`). |

## Rules

- Moving between rooms is a full page load: the 3D room boots once per page for one home (data,
  socket home, read-only rules). `DesktopApp` reloads if it is ever shown for a different home.
- Visiting is read-only: board sorting, reading reviews and your own wardrobe and Escape of the
  Day still work; logging, the wish list and photo uploads don't (the server refuses them too).
  The year wrap (Wrapped) stays closed too: it speaks to its owner ("Your year...") about their
  rooms. The HUD hides the record, wish list and trophy buttons, and the banner says "look-only".
  An empty board reads "Robin hasn't pinned any escapes yet!" instead of asking you to log one.
- If the owner changes @handle during your visit, the room follows it (`followVisitHandle`, from
  the realtime `joined`): reloads use the new handle and the address bar shows it.
- Back to my room goes to `/?autostart=1`; phones land on `/m`, as `/` always does for them.
- A visit that ends while you are inside (removed or asked to leave) never leaves the room
  explorable: the page shows the error card and the friend's data is dropped from the store.

The dock button and the panel are both called **People**. While a panel is open the room's
"Click to look around" pill stays hidden (`useShell().hudPanelOpen`); in a friend's room the HUD
title reads "Robin's escapes" and the phone controls hint and toasts sit below the banner.

## Keys (desktop)

`T` or `Enter` opens the chat box (`Enter` sends, `Esc` closes), `F` opens the people panel.

## Tests

`FriendsOnline.test.tsx`: the phone row. `visit.test.tsx`: addresses, the read-only store, the notices, the route's sign-in, error and own-room
cases (and the room closing when you are removed or asked to leave), and the people HUD on desktop and touch. End to end: `e2e/multiplayer.spec.ts` and `e2e/multiplayer-leave.spec.ts` (the phone's Friends online row, Ask to leave closing the room and holding after the home empties).
