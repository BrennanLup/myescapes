# Realtime client (Phase 3, workstream C)

The browser side of friends sharing a room: one websocket to `/api/realtime` (protocol in
`src/contracts/realtime.ts`, server in `server/realtime/`), smooth movement for other people, and the
stores the people UI (`src/social/visit`) and `RemotePlayers` (`src/world/avatars`) read.

| File | What |
| --- | --- |
| `client.ts` | `RealtimeClient`: reconnecting socket (1 s, 2 s, 4 s ... 30 s with jitter; 60 s after three attempts that never opened, e.g. signed out), re-joins its home after a reconnect, validates every server message with `ServerMessageSchema`, throttles poses to 10 Hz (the newest always goes out), keeps chat and emotes under the server's limits (`WindowLimiter`), retries a join the server could not answer now (`rate_limited` after the server's wait, `unavailable` after 2, 3.5, 5, 10, 20 s, e.g. a cold database right after a deploy) and gives up only on answers that won't change (`not_found`, `not_friends`, `forbidden`, `home_full`), pings every 20 s. Stops for good on close code 4001 (another tab took over); after 4000 (idle) it waits as `paused` until `reconnectNow()`. Transport and timers are injectable. |
| `clock.ts` | `ServerClock`: server time from `ping`/`pong` round trips (the fastest of the last 8 wins), seeded from `hello`. |
| `interpolation.ts` | `PoseBuffer`: per-player pose history sampled 100 ms in the past; lerps position, takes yaw the short way round, snaps on teleports (> 3 m), anchors a pose after a pause so nobody glides across it, extrapolates at most 150 ms while moving. Pure. |
| `store.ts` | `useRealtime` (status, me, home, players with repaired outfits, chat, bubbles, emotes, unread, friends' presence) and `poses` (the non-reactive buffers, by connection id). |
| `session.ts` | `installRealtime()` (called once by `src/desktop.tsx`): signed-in and onboarded only; joins your room or the friend's you are visiting; shares your pose (feet, body yaw, pitch, camera mode, idle/walk/run/emote, speed) when it changes and your look when the wardrobe changes it; turns server messages into store updates and toasts (`applyMessage`; in a friend's room, `left` `removed`/`kicked` and a refused rejoin (`not_friends`, `not_found`, `forbidden`) call `endVisit`, so the room closes instead of staying explorable; elsewhere `removed` reads "You can no longer visit Robin's room"); refreshes `GET /api/presence` (also at once on `friends_changed`); clears everyone in the room the moment the status leaves `open` (no frozen statues while reconnecting or after giving up; `joined` refills it); hands chat lines the server refused for speed back to the chat box (`chatReturned`); plays soft `sfx` cues (an arrival: `string`, a chat line from someone else: `click`, your own emote: `pin`); retries when the network returns, the tab is shown, or after an idle close on any key or tap. Also `sendChat`, `sendEmote`, `kickPlayer`, `activeLocalEmote` (your own character plays it in third person). |

## Behaviour worth knowing

- Signed-out demo visitors never open a socket (the server would answer 401 anyway).
- Your pose is only sent once the world is entered, and only when it changed (1 cm, 0.01 rad,
  animation or camera mode). The server holds the last pose, so standing still costs nothing.
- Outfits from the network are repaired with `normalizeOutfit`; a missing one is the person's
  deterministic starter look (`starterOutfit(userId)`), the same look the wardrobe gives them.
- Toasts: "Sam is in your room" (host), "Robin is home" / "Sam came in" (guests), "Sam left", and
  "Mia is in your room" when someone visits while you are elsewhere. A second tab of the same
  person makes no new toast.
- Chat is never stored: the log lives in memory for this page only (last 40 lines). Up to 8 lines
  per 10 s; a refused line comes back to the box with "You're sending messages quickly. Wait N s".
- Sounds go through the app's `sfx` bus, so the sound toggle and volume apply.
- Test hook: `window.__ESCAPE_NET__` (`client()`, `store`, `poses`, `localState`).

## Tests

`interpolation.test.ts`, `clock.test.ts`, `client.test.ts` (fake socket and timers: join after hello,
reconnect and re-join, backoff, rate limits, refused and retried joins, replaced tabs, idle pause), `session.test.ts`
(messages into stores, toasts and sounds, clearing the room on disconnect, refused chat coming back, local pose). End to end: `e2e/multiplayer.spec.ts`.
