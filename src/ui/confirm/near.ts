/**
 * "Near me" for the room search (Phase 3, workstream A). Opt-in: nothing is asked of the browser
 * until the user presses the button. The position is rounded to about 1 km, sent only as the
 * search's `lat`/`lng` to sort rooms nearest first, and never stored. Only the on/off choice is
 * remembered on this device.
 */
import { useCallback, useEffect, useState } from 'react'

const KEY = 'myescapes.nearMe'

export type NearStatus = 'off' | 'locating' | 'on' | 'denied' | 'unavailable'

/** Two decimals: ~1.1 km of latitude, plenty to sort venues and too coarse to find a house. */
export function roundCoord(n: number): number {
  return Math.round(n * 100) / 100
}

function readPref(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
function writePref(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode */
  }
}

export interface NearMe {
  near: { lat: number; lng: number } | null
  status: NearStatus
  supported: boolean
  toggle(): void
}

export function useNearMe(geo: Geolocation | undefined = typeof navigator !== 'undefined' ? navigator.geolocation : undefined): NearMe {
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null)
  const [status, setStatus] = useState<NearStatus>('off')

  const locate = useCallback(() => {
    if (!geo) {
      setStatus('unavailable')
      return
    }
    setStatus('locating')
    geo.getCurrentPosition(
      (pos) => {
        setNear({ lat: roundCoord(pos.coords.latitude), lng: roundCoord(pos.coords.longitude) })
        setStatus('on')
        writePref(true)
      },
      (err) => {
        setNear(null)
        setStatus(err.code === 1 ? 'denied' : 'unavailable')
        if (err.code === 1) writePref(false)
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 10_000 },
    )
  }, [geo])

  // Turned on before on this device: locate again (the browser remembers the permission).
  useEffect(() => {
    if (readPref()) locate()
  }, [locate])

  const toggle = useCallback(() => {
    if (status === 'on' || status === 'locating') {
      setNear(null)
      setStatus('off')
      writePref(false)
    } else locate()
  }, [status, locate])

  return { near, status, supported: !!geo, toggle }
}

export function nearLabel(s: NearStatus): string {
  switch (s) {
    case 'on':
      return 'Nearest first'
    case 'locating':
      return 'Finding you…'
    case 'denied':
      return 'Location is blocked'
    case 'unavailable':
      return "Couldn't find you"
    default:
      return 'Near me'
  }
}
