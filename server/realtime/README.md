# Realtime (Phase 3, workstream C)

Multiplayer homes: friends walking around the same room, with poses, emotes, short chat and
presence. One websocket per browser tab at `/api/realtime`, served by the same Fastify process.

| File | What |
| --- | --- |
| `hub.ts` | `RealtimeHub`: the in-memory hub. Transport-agnostic (`Peer`), access rules injected (`HubAccess`), clock injected. Joins, caps, rate limits, 10 Hz state coalescing, chat, emotes, kick, presence, heartbeat, idle and revalidation. |
| `access.ts` | The one "who may be in whose home" rule (`visitAccess`: owner, accepted friend, otherwise `not_friends`; a block either way is `not_found`), `homeOwnerByHandle`, `acceptedFriendIds`. Also used by `GET /api/homes/:handle`. |
| `index.ts` | `realtimeRoutes` (the websocket route: session-cookie auth, onboarding, origin check, 426 for a plain GET, 30 upgrades per minute), `hubFor(ctx)` / `existingHub(ctx)` (one hub per server), `originAllowed`. |
| `hub.test.ts` | Hub unit tests with a fake social graph, fake peers and a fake clock. |
| `realtime.test.ts` | End to end on a real port with PGlite fixtures and Node's `WebSocket`. |

The HTTP side lives in `server/routes/homes.ts` (+ `homes.lib.ts`): `GET /api/homes/:handle` and
`GET /api/presence`. The protocol (every message, limit and close code) is
`src/contracts/realtime.ts`, shared with the client in `src/net/` (socket, interpolation) and
`src/social/visit/` (the `/home/:handle` page and the people UI in the room).

## Protocol in short

1. Open `ws(s)://<origin>/api/realtime` from the signed-in app. Signed out: 401, not onboarded:
   403 `onboarding_required`, another site's page: 403. No socket is created in those cases.
2. The server sends `hello` (`sid`, `you`, `limits`).
3. Send `{ type: 'join', home: '<handle>', state?, outfit? }`. Answers: `joined` (with everyone
   already there), or `error` with `not_found` (no such handle, or a block), `not_friends`,
   `home_full`, `rate_limited`.
4. In a home: `state` (at most 10 per second; the server broadcasts changed poses every 100 ms as
   one `states` message stamped with server time), `emote`, `chat` (cleaned, 200 characters, 8 per
   10 s; echoed to the sender too), `outfit`, `leave`, and for the owner `kick`.
5. Others' events: `player_joined`, `player_left` (with a reason), `states`, `emote`, `chat`,
   `outfit`. Friends' movements arrive as `presence` (`own_home`, `your_home`, `elsewhere`, `lobby`,
   `offline`). When someone enters your home while you are elsewhere you get `visitor`.
6. `ping` -> `pong` (with `serverTime`, for clock offset). Invalid messages get `error invalid`
   and the socket stays open; more than 40 messages a second closes it (4008); a message over 4 KB
   closes it (1009); no activity for 10 minutes (moving, chat, emotes, joins; pings don't count) closes it (4000); a peer that misses a transport ping
   is terminated after 20-40 s.

Rules worth knowing:

- One user, one place per home: a second tab joining the same home replaces the first
  (`left` reason `replaced`). At most 4 sockets per user; the oldest is closed (4001).
- The owner always gets into their own home, even when it is full (12).
- Guests are re-checked every 60 s: unfriended or blocked guests are removed (`removed`), and
  presence stops crossing that pair.
- A block between two guests of the same home hides them from each other completely: no joined
  entry, arrival, pose, chat, emote, look or departure either way, and `presence.visitors` of
  `GET /api/homes/:handle` leaves them out. A block or unblock made while both are inside applies at
  the next revalidation (`player_left` / `player_joined` to just those two).
- A guest the owner asked to leave can't rejoin that home for 10 minutes (`forbidden`, any tab);
  the cool-down is kept on the hub (owner -> guest -> until), so it holds even when the home
  empties in between, and expired entries are pruned on the heartbeat.
- Revalidation keeps going past a failed lookup, keeps friend lists only for connected users, and
  sends `friends_changed` to anyone whose friend list changed (the client refetches presence).
- Chat is never stored or logged. Server logs only say things like "closed for flooding".
- Looks are never taken from the client. At join, and whenever an `outfit` message arrives
  (meaning "I saved a new look"), the hub loads your saved look (`HubAccess.outfitFor`, which is
  `outfitForUser` from `server/routes/avatar.lib.ts`) and shows that. Ownership is checked when you
  save (`PUT /api/me/avatar`), so a modified client can't show items it never bought. If loading
  fails, the current look stays. The `outfit` field in `join`/`outfit` is only used by hubs built
  without `outfitFor` (unit tests).

## Scaling

The hub is in memory, so it works with one Railway instance (today's setup). Running several
instances needs a shared pub/sub (for example Postgres `LISTEN/NOTIFY` or Redis) so that people on
different instances can share a home, plus sticky sessions or a shared presence map.

## Tests

```sh
npx vitest run server/realtime server/routes/homes.test.ts
E2E_PORT=3203 npx playwright test e2e/realtime-server.spec.ts   # two browser contexts, real cookies
E2E_PORT=3205 npx playwright test e2e/multiplayer.spec.ts       # the 3D client: two friends see each other
```
