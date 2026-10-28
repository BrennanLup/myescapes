# Realtime client (Phase 3, workstream C)

The browser side of friends sharing a room: one websocket to `/api/realtime` (protocol in
`src/contracts/realtime.ts`, server in `server/realtime/`), smooth movement for other people, and the
stores the people UI (`src/social/visit`) and `RemotePlayers` (`src/world/avatars`) read.

| File | What |
| --- | --- |
| `client.ts` | `RealtimeClient`: reconnecting socket (1 s, 2 s, 4 s ... 30 s with jitter; 60 s after three attempts that never opened, e.g. signed out), re-joins its home after a reconnect, validates every server message with `ServerMessageSchema`, throttles poses to 10 Hz (the newest always goes out), keeps chat and emotes under the server's limits (`WindowLimiter`), retries a rate-limited join after the server's wait, pings every 20 s. Stops for good on close code 4001 (another tab took over). Transport and timers are injectable. |
| `clock.ts` | `ServerClock`: server time from `ping`/`pong` round trips (the fastest of the last 8 wins), seeded from `hello`. |
| `interpolation.ts` | `PoseBuffer`: per-player pose history sampled 100 ms in the past; lerps position, takes yaw the short way round, snaps on teleports (> 3 m), anchors a pose after a pause so nobody glides across it, extrapolates at most 150 ms while moving. Pure. |
| `store.ts` | `useRealtime` (status, me, home, players with repaired outfits, chat, bubbles, emotes, unread, friends' presence) and `poses` (the non-reactive buffers, by connection id). |
| `session.ts` | `installRealtime()` (called once by `src/desktop.tsx`): signed-in and onboarded only; joins your room or the friend's you are visiting; shares your pose (feet, body yaw, pitch, camera mode, idle/walk/run/emote, speed) when it changes and your look when the wardrobe changes it; turns server messages into store updates and toasts (`applyMessage`); refreshes `GET /api/presence`; retries when the network returns or the tab is shown. Also `sendChat`, `sendEmote`, `kickPlayer`, `activeLocalEmote` (your own character plays it in third person). |

## Behaviour worth knowing

- Signed-out demo visitors never open a socket (the server would answer 401 anyway).
- Your pose is only sent once the world is entered, and only when it changed (1 cm, 0.01 rad,
  animation or camera mode). The server holds the last pose, so standing still costs nothing.
- Outfits from the network are repaired with `normalizeOutfit`; a missing one is the person's
  deterministic starter look (`starterOutfit(userId)`), the same look the wardrobe gives them.
- Toasts: "Sam is in your room" (host), "Robin is home" / "Sam came in" (guests), "Sam left", and
  "Mia is in your room" when someone visits while you are elsewhere. A second tab of the same
  person makes no new toast.
- Chat is never stored: the log lives in memory for this page only (last 40 lines).
- Test hook: `window.__ESCAPE_NET__` (`client()`, `store`, `poses`, `localState`).

## Tests

`interpolation.test.ts`, `clock.test.ts`, `client.test.ts` (fake socket and timers: join after hello,
reconnect and re-join, backoff, rate limits, refused joins, replaced tabs), `session.test.ts`
(messages into stores and toasts, local pose). End to end: `e2e/multiplayer.spec.ts`.
