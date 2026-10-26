/** Public venue page /venues/:slug (workstream 17). Uses ROUTES.venuePage. STUB. */
import type { RouteProps } from '../../router'
import { Placeholder } from '../../pages/Placeholder'

export function VenuePage({ params }: RouteProps) {
  return <Placeholder title={`Venue: ${params.slug}`} ws={17} />
}
