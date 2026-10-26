/**
 * Mobile app shell (workstream 13): routing inside /m, home screen (big "Log an escape room"
 * button, pending tags, the rooms table), onboarding gate, "View on desktop", add-to-home-screen.
 * STUB. Must never import three.js or anything under src/world.
 */
import type { RouteProps } from '../../router'
import { Placeholder } from '../../pages/Placeholder'

export function MobileApp({ rest }: RouteProps) {
  return <Placeholder title="My Escapes" ws={13}><p className="mt-2 text-sm opacity-60">{rest}</p></Placeholder>
}
