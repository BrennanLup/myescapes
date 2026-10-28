/**
 * On the phone's "Saved!" screen (Phase 3 QA): the keys you just earned for logging the room, your
 * balance when the server says it, and the way to the wardrobe (it lives in the 3D room).
 *
 * Kept light: the wardrobe's catalogue and route contract live under src/world and
 * src/contracts/avatar.ts, which the phone bundle must not pull in, so this reads only the key
 * balance from `GET /api/me/avatar` with its own small schema. `ROOM_KEYS` must equal
 * `KEY_REWARDS.roomLogged` (keys.test.ts checks).
 */
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { callApi, type RouteSpec } from '../../contracts/routes'
import { IconHanger, IconKey } from '../../ui/wardrobe/icons'
import { DESKTOP_URL, setDesktopPreference } from '../shell/device'

/** Keys for each room you log (the server counts them; see KEY_REWARDS in src/world/avatars/catalog.ts). */
export const ROOM_KEYS = 10

/** Only the part of `GET /api/me/avatar` this screen needs. */
export const KEY_BALANCE_ROUTE = {
  method: 'GET',
  path: '/api/me/avatar',
  auth: 'optional',
  ws: 302,
  summary: 'My key balance (the phone reads only this part of the wardrobe state).',
  response: z.object({ keys: z.object({ balance: z.number().int().min(0) }).passthrough().nullable() }).passthrough(),
} as const satisfies RouteSpec

/** Your key balance, or null while loading, signed out or offline (the card then skips that line). */
export function useKeyBalance(fetchImpl?: typeof fetch): number | null {
  const opts = useMemo(() => (fetchImpl ? { fetch: fetchImpl } : {}), [fetchImpl])
  const [balance, setBalance] = useState<number | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    callApi(KEY_BALANCE_ROUTE, {}, { ...opts, signal: ctl.signal })
      .then((r) => setBalance(r.keys?.balance ?? null))
      .catch(() => {
        /* no balance line */
      })
    return () => ctl.abort()
  }, [opts])
  return balance
}

/** The 3D room on this phone (remembered, like "View on desktop"). */
export function openRoomForWardrobe() {
  setDesktopPreference(true)
  window.location.assign(DESKTOP_URL)
}

export function KeysEarned({ fetch: fetchImpl }: { fetch?: typeof fetch }) {
  const balance = useKeyBalance(fetchImpl)
  return (
    <div data-testid="log-done-keys" className="flex items-start gap-3 rounded-2xl bg-warn/20 p-3 text-left">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warn text-ink">
        <IconKey width={22} height={22} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-bold">
          +{ROOM_KEYS} keys
          {balance !== null && (
            <span data-testid="log-done-key-balance" className="font-normal text-ink-soft">
              {' '}
              · you have {balance}
            </span>
          )}
        </p>
        <p className="text-sm text-ink-soft">Spend them on new looks in the wardrobe: it's in your 3D room, behind the hanger button.</p>
        <button type="button" data-testid="log-done-wardrobe" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal underline" onClick={openRoomForWardrobe}>
          <IconHanger width={18} height={18} aria-hidden />
          Open the wardrobe in my 3D room
        </button>
      </div>
    </div>
  )
}
